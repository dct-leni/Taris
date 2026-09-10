use crate::HostConfig;
use crate::ssh::client::TarisSshHandler;
use crate::ssh::keys::resolve_ssh_key_path;
use russh::client::{self, Handle};
use russh::keys::{self, PrivateKeyWithHashAlg};
use std::net::ToSocketAddrs;
use std::sync::Arc;
use std::time::Duration;

/// Establishes an authenticated async russh session using the configured host and port.
pub async fn open_russh_session(host: &HostConfig) -> Result<Arc<Handle<TarisSshHandler>>, String> {
    let target_port = if host.port == 0 { 22 } else { host.port };
    open_russh_session_with_target(host, &host.host, target_port).await
}

/// Establishes an authenticated async russh session connecting to a specific target host and port
/// (e.g. when connecting directly, via local loopback forwarder, mesh tunnel, or cloud proxy).
pub async fn open_russh_session_with_target(
    host: &HostConfig,
    connect_host: &str,
    connect_port: u16,
) -> Result<Arc<Handle<TarisSshHandler>>, String> {
    open_russh_session_with_handler(host, connect_host, connect_port, TarisSshHandler::new(&host.name)).await
}

/// Establishes an authenticated async russh session with a customized TarisSshHandler
/// (e.g. to receive interactive pre-auth banners).
pub async fn open_russh_session_with_handler(
    host: &HostConfig,
    connect_host: &str,
    connect_port: u16,
    handler: TarisSshHandler,
) -> Result<Arc<Handle<TarisSshHandler>>, String> {
    crate::log_info!("ssh", "Connecting async russh to {} ({}:{})", host.name, connect_host, connect_port);
    let addr_str = format!("{}:{}", connect_host, connect_port);
    let socket_addr = if let Ok(sock) = addr_str.parse::<std::net::SocketAddr>() {
        sock
    } else {
        addr_str
            .to_socket_addrs()
            .map_err(|e| {
                let msg = format!("DNS resolution failed for {}: {}", addr_str, e);
                crate::log_error!("ssh", "{}", msg);
                msg
            })?
            .next()
            .ok_or_else(|| {
                let msg = format!("Could not resolve target address '{}'", addr_str);
                crate::log_error!("ssh", "{}", msg);
                msg
            })?
    };

    let mut config = client::Config::default();
    config.keepalive_interval = Some(Duration::from_secs(15));
    let config = Arc::new(config);

    let mut handle = match tokio::time::timeout(Duration::from_secs(10), client::connect(config, socket_addr, handler)).await {
        Ok(res) => res.map_err(|e| {
            let msg = format!("SSH transport connection failed to {}: {}", addr_str, e);
            crate::log_error!("ssh", "{}", msg);
            msg
        })?,
        Err(_) => {
            let msg = format!("SSH transport connection timed out to {}", addr_str);
            crate::log_error!("ssh", "{}", msg);
            return Err(msg);
        }
    };

    // Authenticate
    if host.auth_type == "key" {
        if let Some(ref kp) = host.key_path {
            let full_key_path = resolve_ssh_key_path(kp);
            if full_key_path.exists() {
                let key = keys::load_secret_key(&full_key_path, None)
                    .map_err(|e| {
                        let msg = format!("Failed to load private key from '{}': {}", full_key_path.display(), e);
                        crate::log_error!("ssh", "{}", msg);
                        msg
                    })?;
                let key_with_alg = PrivateKeyWithHashAlg::new(Arc::new(key), None);
                let auth_res = handle.authenticate_publickey(&host.user, key_with_alg)
                    .await
                    .map_err(|e| {
                        let msg = format!("SSH key authentication failed for user '{}' on {}: {}", host.user, host.name, e);
                        crate::log_error!("ssh", "{}", msg);
                        msg
                    })?;
                if !auth_res.success() {
                    let msg = format!("SSH key authentication rejected for user '{}' on {}", host.user, host.name);
                    crate::log_error!("ssh", "{}", msg);
                    return Err(msg);
                }
            } else {
                let msg = format!("Private key file not found at: {}", full_key_path.display());
                crate::log_error!("ssh", "{}", msg);
                return Err(msg);
            }
        } else {
            let msg = format!("No SSH key file specified for host '{}'", host.name);
            crate::log_error!("ssh", "{}", msg);
            return Err(msg);
        }
    } else if host.auth_type == "password" {
        let pw = host.password.as_deref().unwrap_or("");
        let auth_res = handle.authenticate_password(&host.user, pw)
            .await
            .map_err(|e| {
                let msg = format!("SSH password authentication failed for user '{}' on {}: {}", host.user, host.name, e);
                crate::log_error!("ssh", "{}", msg);
                msg
            })?;
        if !auth_res.success() {
            let msg = format!("SSH password authentication rejected for user '{}' on {}", host.user, host.name);
            crate::log_error!("ssh", "{}", msg);
            return Err(msg);
        }
    } else {
        let msg = format!("Unsupported authentication method '{}'", host.auth_type);
        crate::log_error!("ssh", "{}", msg);
        return Err(msg);
    }

    crate::log_info!("ssh", "Async russh session established and authenticated for {} ({})", host.name, addr_str);
    Ok(Arc::new(handle))
}
