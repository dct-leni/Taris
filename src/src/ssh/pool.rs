use crate::HostConfig;
use crate::mesh::ActiveMeshType;
use crate::ssh::session::open_ssh2_session;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct PooledSession {
    pub sess: ssh2::Session,
    pub last_used: Instant,
}

pub struct SshSessionPool {
    pool: Mutex<HashMap<String, Vec<PooledSession>>>,
}

impl Default for SshSessionPool {
    fn default() -> Self {
        Self::new()
    }
}

impl SshSessionPool {
    pub fn new() -> Self {
        Self {
            pool: Mutex::new(HashMap::new()),
        }
    }

    /// Acquires a healthy authenticated SSH session for the host, connecting either directly
    /// or through a designated target host and port (e.g. mesh/tunnel loopback forwarder).
    pub fn take_session_with_target(
        &self,
        host: &HostConfig,
        connect_host: &str,
        connect_port: u16,
    ) -> Result<ssh2::Session, String> {
        let key = format!("{}@{}:{}", host.user, host.host, host.port);
        if let Ok(mut pool) = self.pool.lock() {
            if let Some(list) = pool.get_mut(&key) {
                while let Some(pooled) = list.pop() {
                    if pooled.last_used.elapsed() < Duration::from_secs(90) {
                        if pooled.sess.authenticated() && pooled.sess.keepalive_send().is_ok() {
                            return Ok(pooled.sess);
                        }
                    }
                }
            }
        }

        crate::ssh::session::open_ssh2_session_with_target(host, connect_host, connect_port)
    }

    /// Acquires a healthy authenticated SSH session for the host, either from the warm pool
    /// or by establishing a new connection.
    pub fn take_session(
        &self,
        host: &HostConfig,
        active_mesh: Option<&ActiveMeshType>,
    ) -> Result<ssh2::Session, String> {
        let is_mesh = host.network_route.as_deref() == Some("mesh")
            || (host.network_route.is_some() && host.network_route.as_deref() != Some("direct"));

        if is_mesh && active_mesh.is_none() {
            return Err("Host is configured to use Mesh / VPN, but no Mesh or VPN connection is active in Taris. Please connect in the Mesh drawer.".into());
        }

        let key = format!("{}@{}:{}", host.user, host.host, host.port);
        if let Ok(mut pool) = self.pool.lock() {
            if let Some(list) = pool.get_mut(&key) {
                while let Some(pooled) = list.pop() {
                    // Reuse connection if younger than 90s and keepalive passes
                    if pooled.last_used.elapsed() < Duration::from_secs(90) {
                        if pooled.sess.authenticated() && pooled.sess.keepalive_send().is_ok() {
                            return Ok(pooled.sess);
                        }
                    }
                }
            }
        }

        open_ssh2_session(host)
    }

    /// Returns an authenticated session back to the pool for reuse by subsequent commands.
    pub fn return_session(&self, host: &HostConfig, sess: ssh2::Session) {
        if !sess.authenticated() {
            return;
        }
        let key = format!("{}@{}:{}", host.user, host.host, host.port);
        if let Ok(mut pool) = self.pool.lock() {
            let list = pool.entry(key).or_default();
            // Cap at 4 warm sessions per host to prevent resource leaks
            if list.len() < 4 {
                list.push(PooledSession {
                    sess,
                    last_used: Instant::now(),
                });
            }
        }
    }

    /// Prunes expired or dead sessions from the pool.
    pub fn prune(&self) {
        if let Ok(mut pool) = self.pool.lock() {
            for list in pool.values_mut() {
                list.retain(|pooled| {
                    pooled.last_used.elapsed() < Duration::from_secs(90)
                        && pooled.sess.authenticated()
                        && pooled.sess.keepalive_send().is_ok()
                });
            }
        }
    }
}
