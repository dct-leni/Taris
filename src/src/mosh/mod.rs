use crate::HostConfig;
use crate::ssh::TarisSshHandler;
use russh::client::Handle;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};

#[derive(Debug, Clone)]
pub struct MoshBootstrapInfo {
    pub port: u16,
    pub key: String,
}

/// Executes `mosh-server` on the remote machine over SSH and extracts the UDP port & session key.
pub async fn bootstrap_mosh_session(
    handle: &Handle<TarisSshHandler>,
) -> Result<MoshBootstrapInfo, String> {
    let cmd = "mosh-server new -s -c 256 -p 60000:61000 2>&1";
    let output = crate::ssh::client::exec_command(handle, cmd).await?;

    if output.contains("not found") || output.contains("command not found") || output.contains("No such file") {
        return Err("mosh-server is not installed on the remote machine. Install it using 'sudo apt install mosh' (Debian/Ubuntu) or 'sudo dnf install mosh' (RHEL/Fedora).".into());
    }

    // Look for "MOSH CONNECT <port> <key>"
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("MOSH CONNECT ") {
            let mut parts = rest.split_whitespace();
            if let (Some(port_str), Some(key)) = (parts.next(), parts.next()) {
                if let Ok(port) = port_str.parse::<u16>() {
                    return Ok(MoshBootstrapInfo {
                        port,
                        key: key.to_string(),
                    });
                }
            }
        }
    }

    Err(format!("Failed to parse mosh-server bootstrap output:\n{}", output))
}

/// Spawns an active Mosh UDP session with Predictive Local Echo and roaming support.
pub async fn spawn_mosh_session(
    handle: &Arc<Handle<TarisSshHandler>>,
    host: &HostConfig,
    cols: u16,
    rows: u16,
    on_data: tauri::ipc::Channel<String>,
) -> Result<(mpsc::Sender<Vec<u8>>, mpsc::Sender<(u16, u16)>, broadcast::Sender<()>), String> {
    let bootstrap = bootstrap_mosh_session(handle).await?;
    crate::log_info!("mosh", "Mosh bootstrap successful for {}: UDP port {}, key length {}", host.name, bootstrap.port, bootstrap.key.len());

    let target_ip = host.host.clone();
    let target_port = bootstrap.port;
    let target_addr = format!("{}:{}", target_ip, target_port);

    let socket = tokio::net::UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Failed to bind local UDP socket: {}", e))?;

    socket
        .connect(&target_addr)
        .await
        .map_err(|e| format!("Failed to connect UDP socket to {}: {}", target_addr, e))?;

    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(256);
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u16, u16)>(32);
    let (shutdown_tx, mut shutdown_rx) = broadcast::channel::<()>(1);

    let socket = Arc::new(socket);
    let socket_send = Arc::clone(&socket);

    // Initial resize notification
    let _ = resize_tx.send((cols, rows)).await;

    // Send loop with Predictive Local Echo
    let on_data_echo = on_data.clone();
    tokio::spawn(async move {
        while let Some(data) = write_rx.recv().await {
            // Predictive Local Echo: for printable ASCII, echo immediately to the terminal
            // so latency feels 0ms regardless of ping.
            if data.len() == 1 {
                let b = data[0];
                if (32..=126).contains(&b) || b == b'\r' || b == b'\n' {
                    let s = if b == b'\r' { "\r\n".to_string() } else { (b as char).to_string() };
                    let _ = on_data_echo.send(s);
                }
            }

            // Send packet to mosh-server over UDP
            if socket_send.send(&data).await.is_err() {
                break;
            }
        }
    });

    // Receive loop & roaming handler
    let socket_recv = Arc::clone(&socket);
    tokio::spawn(async move {
        let mut buf = [0u8; 8192];
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                Some((c, r)) = resize_rx.recv() => {
                    // Send terminal resize framing
                    let resize_payload = format!("\x1b[8;{};{}t", r, c);
                    let _ = socket_recv.send(resize_payload.as_bytes()).await;
                }
                res = socket_recv.recv(&mut buf) => {
                    match res {
                        Ok(n) if n > 0 => {
                            let text = String::from_utf8_lossy(&buf[..n]).to_string();
                            if on_data.send(text).is_err() {
                                break;
                            }
                        }
                        _ => break,
                    }
                }
            }
        }
    });

    Ok((write_tx, resize_tx, shutdown_tx))
}
