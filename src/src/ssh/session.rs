use crate::HostConfig;
use crate::ssh::keys::resolve_ssh_key_path;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

/// Establishes an optimized SSH2 session using the configured host and port.
pub fn open_ssh2_session(host: &HostConfig) -> Result<ssh2::Session, String> {
    let target_port = if host.port == 0 { 22 } else { host.port };
    open_ssh2_session_with_target(host, &host.host, target_port)
}

/// Establishes an optimized SSH2 session connecting to a specific target host and port
/// (e.g. when connecting through a local loopback forwarder, mesh tunnel, or cloud proxy).
pub fn open_ssh2_session_with_target(
    host: &HostConfig,
    connect_host: &str,
    connect_port: u16,
) -> Result<ssh2::Session, String> {
    crate::log_info!("ssh", "Connecting to {} ({}:{})", host.name, connect_host, connect_port);
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

    let timeout = Duration::from_secs(5);
    let tcp = TcpStream::connect_timeout(&socket_addr, timeout)
        .map_err(|e| {
            let msg = format!("TCP connection timed out to {}: {}", addr_str, e);
            crate::log_warn!("ssh", "{}", msg);
            msg
        })?;

    let _ = tcp.set_nodelay(true);
    tcp.set_read_timeout(Some(Duration::from_secs(6))).map_err(|e| e.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(6))).map_err(|e| e.to_string())?;

    let mut sess = ssh2::Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.set_timeout(5000);
    sess.handshake().map_err(|e| {
        let msg = format!("SSH handshake failed on {}: {}", addr_str, e);
        crate::log_error!("ssh", "{}", msg);
        msg
    })?;

    // Authenticate
    if host.auth_type == "key" {
        if let Some(ref kp) = host.key_path {
            let full_key_path = resolve_ssh_key_path(kp);
            if full_key_path.exists() {
                sess.userauth_pubkey_file(&host.user, None, &full_key_path, None)
                    .map_err(|e| {
                        let msg = format!("SSH key authentication failed for user '{}' on {}: {}", host.user, host.name, e);
                        crate::log_error!("ssh", "{}", msg);
                        msg
                    })?;
            } else {
                let msg = format!("Private key file not found at: {}", full_key_path.display());
                crate::log_error!("ssh", "{}", msg);
                return Err(msg);
            }
        } else {
            sess.userauth_agent(&host.user)
                .map_err(|e| {
                    let msg = format!("SSH agent authentication failed for user '{}': {}", host.user, e);
                    crate::log_error!("ssh", "{}", msg);
                    msg
                })?;
        }
    } else if host.auth_type == "password" {
        let pw = host.password.as_deref().unwrap_or("");
        sess.userauth_password(&host.user, pw)
            .map_err(|e| {
                let msg = format!("SSH password authentication failed for user '{}' on {}: {}", host.user, host.name, e);
                crate::log_error!("ssh", "{}", msg);
                msg
            })?;
    } else {
        let msg = format!("Unsupported authentication method '{}'", host.auth_type);
        crate::log_error!("ssh", "{}", msg);
        return Err(msg);
    }

    if !sess.authenticated() {
        let msg = format!("SSH authentication incomplete for {}", host.name);
        crate::log_error!("ssh", "{}", msg);
        return Err(msg);
    }

    crate::log_info!("ssh", "SSH session established and authenticated for {} ({})", host.name, addr_str);
    Ok(sess)
}
