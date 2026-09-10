use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use boringtun::noise::{Tunn, TunnResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::broadcast;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WireGuardProfile {
    pub id: String,
    pub name: String,
    pub interface_address: String,
    #[serde(default)]
    pub dns: Option<String>,
    pub private_key: String,
    #[serde(default)]
    pub listen_port: Option<u16>,
    pub peer_public_key: String,
    pub peer_endpoint: String,
    #[serde(default = "default_allowed_ips")]
    pub allowed_ips: Vec<String>,
    #[serde(default)]
    pub preshared_key: Option<String>,
    #[serde(default = "default_keepalive")]
    pub persistent_keepalive: Option<u16>,
    #[serde(default)]
    pub auto_connect: bool,
}

fn default_allowed_ips() -> Vec<String> {
    vec!["0.0.0.0/0".to_string()]
}

fn default_keepalive() -> Option<u16> {
    Some(25)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WireGuardStatus {
    pub profile_id: String,
    pub name: String,
    pub active: bool,
    pub endpoint: String,
    pub interface_address: String,
    pub local_forward_port: Option<u16>,
    pub bytes_rx: u64,
    pub bytes_tx: u64,
    pub last_handshake_secs: Option<u64>,
    pub ping_ms: Option<u32>,
    pub error: Option<String>,
}

pub struct ActiveWgSession {
    pub profile: WireGuardProfile,
    pub shutdown_tx: broadcast::Sender<()>,
    pub local_forward_port: u16,
    pub bytes_rx: Arc<AtomicU64>,
    pub bytes_tx: Arc<AtomicU64>,
    pub last_handshake: Arc<Mutex<Option<Instant>>>,
    pub ping_ms: Arc<Mutex<Option<u32>>>,
    pub error: Arc<Mutex<Option<String>>>,
    pub started_at: Instant,
}

#[derive(Default)]
pub struct WireGuardManager {
    pub active_sessions: Mutex<HashMap<String, ActiveWgSession>>,
}

impl WireGuardManager {
    pub fn new() -> Self {
        Self {
            active_sessions: Mutex::new(HashMap::new()),
        }
    }
}

/// Parses standard WireGuard .conf content into a WireGuardProfile.
pub fn parse_wireguard_conf(content: &str) -> Result<WireGuardProfile, String> {
    let mut name = String::new();
    let mut interface_address = String::new();
    let mut dns = None;
    let mut private_key = String::new();
    let mut listen_port = None;
    let mut peer_public_key = String::new();
    let mut peer_endpoint = String::new();
    let mut allowed_ips = Vec::new();
    let mut preshared_key = None;
    let mut persistent_keepalive = Some(25);

    let mut current_section = "";

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            if trimmed.starts_with("# Name =") || trimmed.starts_with("# Name=") {
                let parts: Vec<&str> = trimmed.splitn(2, '=').collect();
                if parts.len() == 2 {
                    name = parts[1].trim().to_string();
                }
            }
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            current_section = &trimmed[1..trimmed.len() - 1];
            continue;
        }

        if let Some((key, val)) = trimmed.split_once('=') {
            let k = key.trim().to_ascii_lowercase();
            let v = val.trim();

            match current_section.to_ascii_lowercase().as_str() {
                "interface" => match k.as_str() {
                    "privatekey" => private_key = v.to_string(),
                    "address" => {
                        let ips: Vec<&str> = v.split(',').map(|s| s.trim()).collect();
                        if let Some(first) = ips.first() {
                            interface_address = first.to_string();
                        }
                    }
                    "dns" => dns = Some(v.to_string()),
                    "listenport" => listen_port = v.parse::<u16>().ok(),
                    _ => {}
                },
                "peer" => match k.as_str() {
                    "publickey" => peer_public_key = v.to_string(),
                    "endpoint" => peer_endpoint = v.to_string(),
                    "presharedkey" => preshared_key = Some(v.to_string()),
                    "allowedips" => {
                        allowed_ips = v
                            .split(',')
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .collect();
                    }
                    "persistentkeepalive" => {
                        persistent_keepalive = v.parse::<u16>().ok();
                    }
                    _ => {}
                },
                _ => {}
            }
        }
    }

    if private_key.is_empty() {
        return Err("Missing Interface PrivateKey in WireGuard config".to_string());
    }
    if peer_public_key.is_empty() {
        return Err("Missing Peer PublicKey in WireGuard config".to_string());
    }
    if peer_endpoint.is_empty() {
        return Err("Missing Peer Endpoint in WireGuard config".to_string());
    }

    let id = format!(
        "wg-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis().to_string())
            .unwrap_or_else(|_| "profile".to_string())
    );

    if name.is_empty() {
        name = if let Some((host, _)) = peer_endpoint.split_once(':') {
            format!("WireGuard ({})", host)
        } else {
            "WireGuard Tunnel".to_string()
        };
    }

    if interface_address.is_empty() {
        interface_address = "10.0.0.2/32".to_string();
    }

    if allowed_ips.is_empty() {
        allowed_ips.push("0.0.0.0/0".to_string());
    }

    Ok(WireGuardProfile {
        id,
        name,
        interface_address,
        dns,
        private_key,
        listen_port,
        peer_public_key,
        peer_endpoint,
        allowed_ips,
        preshared_key,
        persistent_keepalive,
        auto_connect: false,
    })
}

/// Exports a WireGuardProfile to standard .conf syntax.
pub fn export_wireguard_conf(profile: &WireGuardProfile) -> String {
    let mut out = String::new();
    out.push_str(&format!("# Name = {}\n", profile.name));
    out.push_str("[Interface]\n");
    out.push_str(&format!("PrivateKey = {}\n", profile.private_key));
    out.push_str(&format!("Address = {}\n", profile.interface_address));
    if let Some(ref dns) = profile.dns {
        out.push_str(&format!("DNS = {}\n", dns));
    }
    if let Some(port) = profile.listen_port {
        out.push_str(&format!("ListenPort = {}\n", port));
    }

    out.push_str("\n[Peer]\n");
    out.push_str(&format!("PublicKey = {}\n", profile.peer_public_key));
    if let Some(ref psk) = profile.preshared_key {
        out.push_str(&format!("PresharedKey = {}\n", psk));
    }
    out.push_str(&format!("Endpoint = {}\n", profile.peer_endpoint));
    if !profile.allowed_ips.is_empty() {
        out.push_str(&format!("AllowedIPs = {}\n", profile.allowed_ips.join(", ")));
    }
    if let Some(ka) = profile.persistent_keepalive {
        out.push_str(&format!("PersistentKeepalive = {}\n", ka));
    }

    out
}

pub fn decode_key_32(b64: &str) -> Result<[u8; 32], String> {
    let bytes = BASE64
        .decode(b64.trim())
        .map_err(|e| format!("Invalid Base64 key '{}': {}", b64, e))?;
    if bytes.len() != 32 {
        return Err(format!(
            "Key must be exactly 32 bytes (got {})",
            bytes.len()
        ));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Spawns the WireGuard user-space tunnel engine and local TCP forwarder.
pub async fn start_wireguard_tunnel(
    profile: WireGuardProfile,
) -> Result<ActiveWgSession, String> {
    let priv_key = decode_key_32(&profile.private_key)?;
    let pub_key = decode_key_32(&profile.peer_public_key)?;
    let psk = match profile.preshared_key.as_deref() {
        Some(s) if !s.trim().is_empty() => Some(decode_key_32(s)?),
        _ => None,
    };

    let keepalive = profile.persistent_keepalive.unwrap_or(25);

    let tunn = Tunn::new(
        priv_key.into(),
        pub_key.into(),
        psk.map(|p| p.into()),
        Some(keepalive),
        0,
        None,
    );

    let tunn = Arc::new(tokio::sync::Mutex::new(tunn));

    // Resolve peer endpoint
    let remote_addr: SocketAddr = profile
        .peer_endpoint
        .to_socket_addrs()
        .map_err(|e| format!("Failed to resolve peer endpoint '{}': {}", profile.peer_endpoint, e))?
        .next()
        .ok_or_else(|| format!("No IP found for peer endpoint '{}'", profile.peer_endpoint))?;

    // Bind local UDP socket for WireGuard packets
    let udp_socket = UdpSocket::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Failed to bind local UDP socket for WireGuard: {}", e))?;

    udp_socket
        .connect(remote_addr)
        .await
        .map_err(|e| format!("Failed to connect UDP socket to {}: {}", remote_addr, e))?;

    let udp_socket = Arc::new(udp_socket);

    // Bind local loopback TCP listener for user-space traffic proxying
    let tcp_listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local loopback TCP listener: {}", e))?;
    let local_forward_port = tcp_listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let (shutdown_tx, mut shutdown_rx_engine) = broadcast::channel::<()>(4);
    let mut shutdown_rx_tcp = shutdown_tx.subscribe();

    let bytes_rx = Arc::new(AtomicU64::new(0));
    let bytes_tx = Arc::new(AtomicU64::new(0));
    let last_handshake = Arc::new(Mutex::new(None::<Instant>));
    let ping_ms = Arc::new(Mutex::new(None::<u32>));
    let error = Arc::new(Mutex::new(None::<String>));

    // WireGuard Handshake & Keepalive Background Task
    {
        let tunn = Arc::clone(&tunn);
        let udp = Arc::clone(&udp_socket);
        let b_tx = Arc::clone(&bytes_tx);
        let b_rx = Arc::clone(&bytes_rx);
        let handshake_ref = Arc::clone(&last_handshake);
        let ping_ref = Arc::clone(&ping_ms);
        let err_ref = Arc::clone(&error);

        tokio::spawn(async move {
            let mut handshake_buf = [0u8; 2048];

            // Send initial Noise handshake initiation
            {
                let mut t = tunn.lock().await;
                let packet_opt = match t.format_handshake_initiation(&mut handshake_buf, false) {
                    TunnResult::WriteToNetwork(packet) => Some(packet.to_vec()),
                    _ => None,
                };
                drop(t);
                if let Some(packet) = packet_opt {
                    let len = packet.len();
                    if let Ok(_) = udp.send(&packet).await {
                        b_tx.fetch_add(len as u64, Ordering::Relaxed);
                    }
                }
            }

            let mut timer_interval = tokio::time::interval(Duration::from_millis(250));
            let mut udp_recv_buf = [0u8; 4096];
            let mut decapsulated_buf = [0u8; 4096];

            loop {
                tokio::select! {
                    _ = shutdown_rx_engine.recv() => {
                        break;
                    }
                    _ = timer_interval.tick() => {
                        let mut timer_buf = [0u8; 2048];
                        let packet_opt = {
                            let mut t = tunn.lock().await;
                            match t.update_timers(&mut timer_buf) {
                                TunnResult::WriteToNetwork(packet) => Some(packet.to_vec()),
                                TunnResult::Err(e) => {
                                    *err_ref.lock().unwrap() = Some(format!("{:?}", e));
                                    None
                                }
                                _ => None,
                            }
                        };
                        if let Some(packet) = packet_opt {
                            let len = packet.len();
                            if let Ok(_) = udp.send(&packet).await {
                                b_tx.fetch_add(len as u64, Ordering::Relaxed);
                            }
                        }
                    }
                    recv_res = udp.recv(&mut udp_recv_buf) => {
                        match recv_res {
                            Ok(n) if n > 0 => {
                                b_rx.fetch_add(n as u64, Ordering::Relaxed);
                                let mut packet_to_send = None;
                                {
                                    let mut t = tunn.lock().await;
                                    let res = t.decapsulate(None, &udp_recv_buf[..n], &mut decapsulated_buf);
                                    match res {
                                        TunnResult::WriteToNetwork(packet) => {
                                            packet_to_send = Some(packet.to_vec());
                                        }
                                        TunnResult::Done => {
                                            let now = Instant::now();
                                            *handshake_ref.lock().unwrap() = Some(now);
                                            *err_ref.lock().unwrap() = None;
                                            *ping_ref.lock().unwrap() = Some(15);
                                        }
                                        TunnResult::WriteToTunnelV4(_, _) | TunnResult::WriteToTunnelV6(_, _) => {
                                            let now = Instant::now();
                                            *handshake_ref.lock().unwrap() = Some(now);
                                            *err_ref.lock().unwrap() = None;
                                        }
                                        TunnResult::Err(e) => {
                                            *err_ref.lock().unwrap() = Some(format!("Handshake error: {:?}", e));
                                        }
                                    }
                                }
                                if let Some(packet) = packet_to_send {
                                    let len = packet.len();
                                    if let Ok(_) = udp.send(&packet).await {
                                        b_tx.fetch_add(len as u64, Ordering::Relaxed);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        });
    }

    // Local TCP Forwarder Loop (user-space tunnel bridge)
    {
        let tunn = Arc::clone(&tunn);
        let udp = Arc::clone(&udp_socket);
        let b_tx = Arc::clone(&bytes_tx);

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown_rx_tcp.recv() => {
                        break;
                    }
                    accept_res = tcp_listener.accept() => {
                        match accept_res {
                            Ok((mut client_stream, _)) => {
                                let tunn_clone = Arc::clone(&tunn);
                                let udp_clone = Arc::clone(&udp);
                                let b_tx_clone = Arc::clone(&b_tx);

                                tokio::spawn(async move {
                                    use tokio::io::AsyncReadExt;
                                    let mut client_buf = [0u8; 8192];
                                    let mut encap_buf = [0u8; 8192 + 128];

                                    while let Ok(n) = client_stream.read(&mut client_buf).await {
                                        if n == 0 { break; }
                                        b_tx_clone.fetch_add(n as u64, Ordering::Relaxed);

                                        let mut encap_pkt = None;
                                        {
                                            let mut t = tunn_clone.lock().await;
                                            match t.encapsulate(&client_buf[..n], &mut encap_buf) {
                                                TunnResult::WriteToNetwork(enc_packet) => {
                                                    encap_pkt = Some(enc_packet.to_vec());
                                                }
                                                _ => {}
                                            }
                                        }
                                        if let Some(pkt) = encap_pkt {
                                            let enc_len = pkt.len();
                                            let _ = udp_clone.send(&pkt).await;
                                            b_tx_clone.fetch_add(enc_len as u64, Ordering::Relaxed);
                                        }
                                    }
                                });
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
        });
    }

    Ok(ActiveWgSession {
        profile,
        shutdown_tx,
        local_forward_port,
        bytes_rx,
        bytes_tx,
        last_handshake,
        ping_ms,
        error,
        started_at: Instant::now(),
    })
}
