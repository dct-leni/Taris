use crate::HostConfig;
use crate::mesh::ActiveMeshType;
use crate::ssh::client::TarisSshHandler;
use crate::ssh::session::open_russh_session;
use russh::client::Handle;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct SshSessionPool {
    pool: Arc<Mutex<HashMap<String, Arc<Handle<TarisSshHandler>>>>>,
}

impl Default for SshSessionPool {
    fn default() -> Self {
        Self::new()
    }
}

impl SshSessionPool {
    pub fn new() -> Self {
        Self {
            pool: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Acquires an active authenticated async russh session for the host, connecting either directly
    /// or through a designated target host and port (e.g. mesh/tunnel loopback forwarder).
    pub async fn take_session_with_target(
        &self,
        host: &HostConfig,
        connect_host: &str,
        connect_port: u16,
    ) -> Result<Arc<Handle<TarisSshHandler>>, String> {
        let port = if host.port == 0 { 22 } else { host.port };
        let key = format!("{}@{}:{}", host.user, host.host, port);
        let mut pool = self.pool.lock().await;
        if let Some(handle) = pool.get(&key) {
            if !handle.is_closed() {
                return Ok(Arc::clone(handle));
            }
        }

        let new_handle = crate::ssh::session::open_russh_session_with_target(host, connect_host, connect_port).await?;
        pool.insert(key, Arc::clone(&new_handle));
        Ok(new_handle)
    }

    /// Acquires an active authenticated async russh session for the host, either reusing the warm connection
    /// or establishing a new connection.
    pub async fn take_session(
        &self,
        host: &HostConfig,
        active_mesh: Option<&ActiveMeshType>,
    ) -> Result<Arc<Handle<TarisSshHandler>>, String> {
        let is_mesh = host.network_route.as_deref() == Some("mesh")
            || (host.network_route.is_some() && host.network_route.as_deref() != Some("direct"));

        if is_mesh && active_mesh.is_none() {
            return Err("Host is configured to use Mesh / VPN, but no Mesh or VPN connection is active in Taris. Please connect in the Mesh drawer.".into());
        }

        let port = if host.port == 0 { 22 } else { host.port };
        let key = format!("{}@{}:{}", host.user, host.host, port);
        let mut pool = self.pool.lock().await;
        if let Some(handle) = pool.get(&key) {
            if !handle.is_closed() {
                return Ok(Arc::clone(handle));
            }
        }

        let new_handle = open_russh_session(host).await?;
        pool.insert(key, Arc::clone(&new_handle));
        Ok(new_handle)
    }

    /// Removes and cleanly disconnects a session from the pool.
    pub async fn remove_session(&self, host: &HostConfig) {
        let port = if host.port == 0 { 22 } else { host.port };
        let key = format!("{}@{}:{}", host.user, host.host, port);
        let mut pool = self.pool.lock().await;
        if let Some(handle) = pool.remove(&key) {
            let _ = handle.disconnect(russh::Disconnect::ByApplication, "Host disconnected", "en").await;
        }
    }

    /// Disconnects all active pooled SSH sessions.
    pub async fn disconnect_all(&self) {
        let mut pool = self.pool.lock().await;
        for (_, handle) in pool.drain() {
            let _ = handle.disconnect(russh::Disconnect::ByApplication, "Application shutdown", "en").await;
        }
    }
}
