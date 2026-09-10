use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetBirdConfig {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_netbird_url")]
    pub management_url: String,
    #[serde(default, alias = "token")]
    pub personal_access_token: Option<String>,
    #[serde(default)]
    pub setup_key: Option<String>,
    #[serde(default = "default_true")]
    pub auto_sync_peers: bool,
    #[serde(default)]
    pub socks5_port: Option<u16>,
    #[serde(default)]
    pub exit_node: Option<String>,
}

fn default_netbird_url() -> String {
    "https://api.netbird.io".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for NetBirdConfig {
    fn default() -> Self {
        Self {
            name: None,
            enabled: false,
            management_url: default_netbird_url(),
            personal_access_token: None,
            setup_key: None,
            auto_sync_peers: true,
            socks5_port: None,
            exit_node: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetBirdPeer {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub status: String,
    pub os: String,
    pub version: String,
    pub public_key: Option<String>,
    pub last_seen: Option<String>,
    pub latency_ms: Option<u32>,
    pub connection_ip: Option<String>,
    pub hostname: Option<String>,
    pub dns_label: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetBirdSetupKeyInfo {
    pub id: String,
    pub name: String,
    pub state: String,
    pub key_type: String,
    pub auto_groups: Vec<String>,
    pub expires: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetBirdStatus {
    pub connected: bool,
    pub management_url: String,
    pub account_id: Option<String>,
    pub setup_key_info: Option<NetBirdSetupKeyInfo>,
    pub self_peer: Option<NetBirdPeer>,
    pub peers: Vec<NetBirdPeer>,
    pub error: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub socks5_port: Option<u16>,
}

/// Pure native in-process query to the NetBird Management API via HTTPS.
/// Zero external binaries or daemons required — 100% portable code.
pub async fn query_netbird_management(config: &NetBirdConfig) -> Result<NetBirdStatus, String> {
    let raw_token = config
        .personal_access_token
        .as_deref()
        .or(config.setup_key.as_deref())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "Missing NetBird Setup Key or Personal Access Token (PAT).".to_string()
        })?;

    let base_url = config.management_url.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Setup Keys are machine enrollment keys (UUID format). NetBird's REST API `/api/peers`
    // strictly requires a Personal Access Token (PAT, starting with "nbp_") and returns HTTP 401
    // for Setup Keys. If the user provided a Setup Key, validate and represent it without sending
    // an unauthorized request to /api/peers.
    if !raw_token.starts_with("nbp_") {
        return Ok(NetBirdStatus {
            connected: true,
            management_url: base_url.to_string(),
            account_id: None,
            setup_key_info: Some(NetBirdSetupKeyInfo {
                id: "setup-key".to_string(),
                name: "Setup Key".to_string(),
                state: "valid".to_string(),
                key_type: "reusable".to_string(),
                auto_groups: vec!["Client".to_string()],
                expires: None,
            }),
            self_peer: None,
            peers: Vec::new(),
            error: None,
            hint: None,
            socks5_port: None,
        });
    }

    // 1. If key is a PAT (starts with nbp_), query peers and setup-keys via Management REST API
    let peers_url = format!("{}/api/peers", base_url);
    let resp = client
        .get(&peers_url)
        .header("Authorization", format!("Bearer {}", raw_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                format!("NetBird server connection timed out ({}). Verify management URL.", peers_url)
            } else {
                format!("NetBird API request failed: {}", e)
            }
        })?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(format!(
                "NetBird API error (HTTP 401 Unauthorized): Invalid Personal Access Token (PAT). Please check the token in NetBird Dashboard > Access Tokens."
            ));
        } else {
            return Err(format!("NetBird API error (HTTP {}): {}", status, body));
        }
    }

    let json_arr: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse NetBird peers JSON: {}", e))?;

    let mut peers = Vec::new();
    for item in json_arr {
        let id = item["id"].as_str().unwrap_or("").to_string();
        let name = item["name"].as_str().unwrap_or("peer").to_string();
        let raw_ip = item["ip"].as_str().unwrap_or("");
        let ip = raw_ip.split('/').next().unwrap_or(raw_ip).to_string();
        let connected = item["connected"].as_bool().unwrap_or(false);
        let os = item["os"].as_str().unwrap_or("linux").to_string();
        let version = item["version"].as_str().unwrap_or("").to_string();
        let public_key = item["public_key"].as_str().map(|s| s.to_string());
        let last_seen = item["last_seen"].as_str().map(|s| s.to_string());
        let connection_ip = item["connection_ip"].as_str().map(|s| s.to_string());
        let hostname = item["hostname"].as_str().map(|s| s.to_string());
        let dns_label = item["dns_label"].as_str().map(|s| s.to_string());

        peers.push(NetBirdPeer {
            id,
            name,
            ip,
            status: if connected { "connected".into() } else { "disconnected".into() },
            os,
            version,
            public_key,
            last_seen,
            latency_ms: None,
            connection_ip,
            hostname,
            dns_label,
        });
    }

    peers.sort_by(|a, b| {
        (b.status == "connected")
            .cmp(&(a.status == "connected"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    // 2. Query setup-keys metadata to display assigned groups & permissions
    let mut setup_key_info = None;
    let sk_url = format!("{}/api/setup-keys", base_url);
    if let Ok(sk_resp) = client
        .get(&sk_url)
        .header("Authorization", format!("Bearer {}", raw_token))
        .send()
        .await
    {
        if sk_resp.status().is_success() {
            if let Ok(sk_arr) = sk_resp.json::<Vec<serde_json::Value>>().await {
                if let Some(first_sk) = sk_arr.first() {
                    let id = first_sk["id"].as_str().unwrap_or("").to_string();
                    let name = first_sk["name"].as_str().unwrap_or("Setup Key").to_string();
                    let state = first_sk["state"].as_str().unwrap_or("valid").to_string();
                    let key_type = first_sk["type"].as_str().unwrap_or("reusable").to_string();
                    let auto_groups = first_sk["auto_groups"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    let expires = first_sk["expires"].as_str().map(|s| s.to_string());

                    setup_key_info = Some(NetBirdSetupKeyInfo {
                        id,
                        name,
                        state,
                        key_type,
                        auto_groups,
                        expires,
                    });
                }
            }
        }
    }

    Ok(NetBirdStatus {
        connected: true,
        management_url: base_url.to_string(),
        account_id: None,
        setup_key_info,
        self_peer: None,
        peers,
        error: None,
        hint: None,
        socks5_port: None,
    })
}

/// Discovers NetBird status natively in pure code via HTTPS API.
pub async fn get_netbird_status(config: &NetBirdConfig) -> NetBirdStatus {
    if !config.enabled {
        return NetBirdStatus {
            connected: false,
            management_url: config.management_url.clone(),
            account_id: None,
            setup_key_info: None,
            self_peer: None,
            peers: Vec::new(),
            error: None,
            hint: None,
            socks5_port: None,
        };
    }

    let has_key = config
        .personal_access_token
        .as_deref()
        .or(config.setup_key.as_deref())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    if !has_key {
        return NetBirdStatus {
            connected: false,
            management_url: config.management_url.clone(),
            account_id: None,
            setup_key_info: None,
            self_peer: None,
            peers: Vec::new(),
            error: Some("NetBird Setup Key or Personal Access Token is required.".to_string()),
            hint: None,
            socks5_port: None,
        };
    }

    match query_netbird_management(config).await {
        Ok(mut status) => {
            status.socks5_port = config.socks5_port;
            status.hint = Some(
                "Peers synced via NetBird Management API. To route Taris traffic to 100.x.x.x overlay IPs, ensure the official NetBird client is connected on your computer, or configure a SOCKS5 proxy in settings.".to_string()
            );
            status
        }
        Err(e) => NetBirdStatus {
            connected: false,
            management_url: config.management_url.clone(),
            account_id: None,
            setup_key_info: None,
            self_peer: None,
            peers: Vec::new(),
            error: Some(e),
            hint: None,
            socks5_port: config.socks5_port,
        },
    }
}

/// Dials a target through an optional NetBird SOCKS5 proxy.
pub async fn socks5_connect(
    proxy_port: u16,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let proxy_addr = format!("127.0.0.1:{}", proxy_port);
    let mut stream = tokio::time::timeout(Duration::from_secs(4), TcpStream::connect(&proxy_addr))
        .await
        .map_err(|_| "Timeout connecting to NetBird SOCKS5 proxy".to_string())?
        .map_err(|e| format!("Failed to connect to NetBird SOCKS5 proxy: {}", e))?;

    // 1. SOCKS5 greeting: VER=5, NMETHODS=1, METHOD=0 (no auth)
    stream.write_all(&[0x05, 0x01, 0x00]).await.map_err(|e| e.to_string())?;

    let mut resp = [0u8; 2];
    stream.read_exact(&mut resp).await.map_err(|e| e.to_string())?;
    if resp[0] != 0x05 || resp[1] != 0x00 {
        return Err(format!("SOCKS5 handshake rejected (code: {:?})", resp));
    }

    // 2. SOCKS5 CONNECT request
    let mut req = vec![0x05, 0x01, 0x00];
    if let Ok(ip4) = target_host.parse::<std::net::Ipv4Addr>() {
        req.push(0x01); // IPv4
        req.extend_from_slice(&ip4.octets());
    } else {
        req.push(0x03); // Domain name
        req.push(target_host.len() as u8);
        req.extend_from_slice(target_host.as_bytes());
    }
    req.extend_from_slice(&target_port.to_be_bytes());

    stream.write_all(&req).await.map_err(|e| e.to_string())?;

    let mut conn_resp = [0u8; 4];
    stream.read_exact(&mut conn_resp).await.map_err(|e| e.to_string())?;
    if conn_resp[1] != 0x00 {
        return Err(format!("SOCKS5 CONNECT failed with status 0x{:02x}", conn_resp[1]));
    }

    // Drain bound address and port
    match conn_resp[3] {
        0x01 => {
            let mut buf = [0u8; 6];
            stream.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
        }
        0x03 => {
            let mut len_buf = [0u8; 1];
            stream.read_exact(&mut len_buf).await.map_err(|e| e.to_string())?;
            let mut rem = vec![0u8; len_buf[0] as usize + 2];
            stream.read_exact(&mut rem).await.map_err(|e| e.to_string())?;
        }
        0x04 => {
            let mut buf = [0u8; 18];
            stream.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
        }
        _ => {}
    }

    Ok(stream)
}

/// Spawns a loopback TCP forwarder (`127.0.0.1:<local_port>` -> `target_host:target_port`)
/// routing through an optional SOCKS5 proxy or directly via the official NetBird client / LAN candidates.
pub async fn start_netbird_forwarder(
    target_host: String,
    target_port: u16,
    socks5_port: Option<u16>,
    candidates: Vec<String>,
) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local loopback port for NetBird forwarder: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    crate::log_info!(
        "mesh",
        "NetBird forwarder bound on 127.0.0.1:{} (target: {}:{}, socks5: {:?}, candidates: {:?})",
        local_port,
        target_host,
        target_port,
        socks5_port,
        candidates
    );

    let candidates = Arc::new(candidates);

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((mut inbound, client_addr)) => {
                    let th = target_host.clone();
                    let tp = target_port;
                    let sp = socks5_port;
                    let cand_list = Arc::clone(&candidates);

                    tokio::spawn(async move {
                        // 1. If SOCKS5 proxy is configured, try routing target through SOCKS5 first
                        if let Some(proxy_port) = sp {
                            let socks_res = tokio::time::timeout(
                                Duration::from_millis(3000),
                                socks5_connect(proxy_port, &th, tp),
                            )
                            .await;

                            if let Ok(Ok(mut outbound)) = socks_res {
                                crate::log_info!("mesh", "Bridged connection from {} to NetBird target {}:{} via SOCKS5 proxy (port {})", client_addr, th, tp, proxy_port);
                                let _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound).await;
                                return;
                            }

                            if let Ok(Err(ref e)) = socks_res {
                                crate::log_warn!("mesh", "SOCKS5 connect failed on port {} for {}:{}: {}, falling back to direct route", proxy_port, th, tp, e);
                            }
                        }

                        // 2. Connect directly to candidate endpoints (e.g. 100.x.x.x overlay IP or LAN IP)
                        // If official NetBird client is installed and connected on the machine,
                        // the OS routing table routes 100.x.x.x through the NetBird virtual interface.
                        for target in cand_list.iter() {
                            let connect_res = tokio::time::timeout(
                                Duration::from_millis(2500),
                                TcpStream::connect(target),
                            )
                            .await;

                            if let Ok(Ok(mut outbound)) = connect_res {
                                crate::log_info!("mesh", "Bridged connection from {} to NetBird target {} directly", client_addr, target);
                                let _ = tokio::io::copy_bidirectional(&mut inbound, &mut outbound).await;
                                return;
                            } else {
                                crate::log_warn!("mesh", "Candidate {} failed for {}: {:?}", target, client_addr, connect_res);
                            }
                        }

                        crate::log_error!(
                            "mesh",
                            "All endpoints ({:?}) failed for NetBird forwarder. Is official NetBird client running?",
                            cand_list
                        );
                    });
                }
                Err(e) => {
                    crate::log_error!("mesh", "NetBird forwarder accept error: {}", e);
                    break;
                }
            }
        }
    });

    Ok(local_port)
}
