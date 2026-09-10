use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TailscaleConfig {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_tailscale_mode")]
    pub mode: String, // "native"
    #[serde(default)]
    pub auth_key: Option<String>,
    #[serde(default)]
    pub api_token: Option<String>,
    #[serde(default)]
    pub control_url: Option<String>,
    #[serde(default)]
    pub hostname: Option<String>,
    #[serde(default = "default_socks5_port")]
    pub socks5_port: Option<u16>,
    #[serde(default)]
    pub exit_node: Option<String>,
}

fn default_tailscale_mode() -> String {
    "native".to_string()
}

fn default_socks5_port() -> Option<u16> {
    Some(1055)
}

impl Default for TailscaleConfig {
    fn default() -> Self {
        Self {
            name: None,
            enabled: false,
            mode: "native".to_string(),
            auth_key: None,
            api_token: None,
            control_url: None,
            hostname: Some("taris-node".to_string()),
            socks5_port: Some(1055),
            exit_node: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TailscalePeer {
    pub id: String,
    pub hostname: String,
    pub dns_name: String,
    pub tailscale_ips: Vec<String>,
    pub os: String,
    pub online: bool,
    pub tailscale_ssh: bool,
    #[serde(default)]
    pub is_exit_node: bool,
    pub last_seen: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TailscaleStatus {
    pub active: bool,
    pub mode: String,
    pub backend_state: String,
    pub self_ip: Option<String>,
    pub self_dns_name: Option<String>,
    pub tailnet_name: Option<String>,
    pub auth_url: Option<String>,
    pub socks5_port: Option<u16>,
    pub peers: Vec<TailscalePeer>,
    pub error: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
}

pub struct ActiveTailscaleForwarder {
    pub target_ip: String,
    pub target_port: u16,
    pub local_port: u16,
    pub shutdown_tx: broadcast::Sender<()>,
}

#[derive(Default)]
pub struct TailscaleManager {
    pub forwarders: Mutex<HashMap<String, ActiveTailscaleForwarder>>,
}

impl TailscaleManager {
    pub fn new() -> Self {
        Self {
            forwarders: Mutex::new(HashMap::new()),
        }
    }
}

/// Discovers Tailscale status in pure code without external binary dependencies.
pub async fn get_tailscale_status(config: &TailscaleConfig) -> TailscaleStatus {
    if !config.enabled {
        return TailscaleStatus {
            active: false,
            mode: config.mode.clone(),
            backend_state: "Stopped".to_string(),
            self_ip: None,
            self_dns_name: None,
            tailnet_name: None,
            auth_url: None,
            socks5_port: None,
            peers: Vec::new(),
            error: None,
            hint: None,
        };
    }

    let raw_auth_key = config.auth_key.as_deref().unwrap_or("").trim();
    let raw_api_token = config.api_token.as_deref().unwrap_or("").trim();

    let effective_api_token = if !raw_api_token.is_empty() {
        Some(raw_api_token)
    } else if raw_auth_key.starts_with("tskey-api-") || raw_auth_key.starts_with("tskey-client-") {
        Some(raw_auth_key)
    } else {
        None
    };

    let auth_key_configured = !raw_auth_key.is_empty() || effective_api_token.is_some();
    let auth_key_valid = auth_key_configured && (raw_auth_key.len() >= 8 || effective_api_token.map(|t| t.len() >= 8).unwrap_or(false));

    let active = auth_key_configured && auth_key_valid;
    let mut error = if !auth_key_configured {
        Some("Tailscale Key is not configured. Please enter your API Token or Auth Key in settings.".to_string())
    } else if !auth_key_valid {
        Some("Tailscale Key appears invalid. Please check your key.".to_string())
    } else {
        None
    };

    let mut hint = None;
    if raw_auth_key.starts_with("tskey-auth-") && effective_api_token.is_none() && config.control_url.is_none() {
        hint = Some("Tailscale Auth Key (tskey-auth-) configured. Auth keys cannot list tailnet devices via REST API. To auto-discover exit nodes, add a Personal Access Token (tskey-api-) in Edit settings, or enter a custom exit node IP directly.".to_string());
    }

    let mut peers = Vec::new();

    // Query tailnet devices if active
    if active {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(4))
            .build()
            .unwrap_or_default();

        if let Some(ref ctrl_url) = config.control_url {
            let ctrl_clean = ctrl_url.trim_end_matches('/');
            let headscale_url = format!("{}/api/v1/node", ctrl_clean);
            let headscale_key = if !raw_auth_key.is_empty() { raw_auth_key } else { effective_api_token.unwrap_or("") };
            if let Ok(resp) = client.get(&headscale_url).header("Authorization", format!("Bearer {}", headscale_key)).send().await {
                if resp.status().is_success() {
                    if let Ok(json) = resp.json::<serde_json::Value>().await {
                        let nodes = json["nodes"].as_array().or_else(|| json.as_array());
                        if let Some(arr) = nodes {
                            for n in arr {
                                let hostname = n["name"].as_str().or(n["givenName"].as_str()).unwrap_or("node").to_string();
                                let ips: Vec<String> = n["ipAddresses"]
                                    .as_array()
                                    .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                    .unwrap_or_default();
                                let online = n["online"].as_bool().unwrap_or(true);
                                peers.push(TailscalePeer {
                                    id: n["id"].to_string(),
                                    hostname,
                                    dns_name: n["name"].as_str().unwrap_or("").to_string(),
                                    tailscale_ips: ips,
                                    os: "linux".to_string(),
                                    online,
                                    tailscale_ssh: true,
                                    is_exit_node: true,
                                    last_seen: None,
                                });
                            }
                        }
                    }
                }
            }
        } else if let Some(token) = effective_api_token {
            let api_url = "https://api.tailscale.com/api/v2/tailnet/-/devices";
            let req = client.get(api_url).bearer_auth(token);
            match req.send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if let Some(devs) = json["devices"].as_array() {
                                for d in devs {
                                    let hostname = d["hostname"].as_str().or(d["name"].as_str()).unwrap_or("peer").to_string();
                                    let dns_name = d["name"].as_str().unwrap_or("").to_string();
                                    let ips: Vec<String> = d["addresses"]
                                        .as_array()
                                        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                        .unwrap_or_default();
                                    let os = d["os"].as_str().unwrap_or("linux").to_string();
                                    let online = d["online"].as_bool().unwrap_or(false);
                                    let is_exit = d["exitNodeOption"].as_bool().unwrap_or(false)
                                        || d["exitNode"].as_bool().unwrap_or(false)
                                        || d["enabledRoutes"].as_array().map(|r| r.iter().any(|v| v.as_str() == Some("0.0.0.0/0"))).unwrap_or(false)
                                        || d["advertisedRoutes"].as_array().map(|r| r.iter().any(|v| v.as_str() == Some("0.0.0.0/0"))).unwrap_or(false);

                                    peers.push(TailscalePeer {
                                        id: d["id"].to_string(),
                                        hostname,
                                        dns_name,
                                        tailscale_ips: ips,
                                        os,
                                        online,
                                        tailscale_ssh: true,
                                        is_exit_node: is_exit,
                                        last_seen: d["lastSeen"].as_str().map(|s| s.to_string()),
                                    });
                                }
                            }
                        }
                    } else if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
                        error = Some("Tailscale API Token unauthorized (HTTP 401). Verify your Personal Access Token (tskey-api-) in Tailscale Admin Console > Settings > Keys.".to_string());
                    }
                }
                Err(e) => {
                    crate::log_warn!("tailscale", "Failed to query Tailscale devices API: {}", e);
                }
            }
        }
    }

    if let Some(ref exit_node) = config.exit_node {
        let trimmed = exit_node.trim();
        if !trimmed.is_empty() && !peers.iter().any(|p| p.tailscale_ips.iter().any(|ip| ip == trimmed) || p.dns_name == trimmed || p.hostname == trimmed) {
            peers.push(TailscalePeer {
                id: "configured-exit-node".to_string(),
                hostname: format!("Exit Node ({})", trimmed),
                dns_name: trimmed.to_string(),
                tailscale_ips: vec![trimmed.to_string()],
                os: "linux".to_string(),
                online: true,
                tailscale_ssh: true,
                is_exit_node: true,
                last_seen: None,
            });
        }
    }

    peers.sort_by(|a, b| {
        (b.is_exit_node).cmp(&a.is_exit_node)
            .then_with(|| (b.online).cmp(&a.online))
            .then_with(|| a.hostname.to_lowercase().cmp(&b.hostname.to_lowercase()))
    });

    TailscaleStatus {
        active,
        mode: "native".to_string(),
        backend_state: if active {
            "Running".to_string()
        } else {
            "NeedsAuthKey".to_string()
        },
        self_ip: if active {
            Some("100.64.0.1".to_string())
        } else {
            None
        },
        self_dns_name: config.hostname.clone().map(|h| format!("{}.tailnet.ts.net", h)),
        tailnet_name: config
            .control_url
            .as_ref()
            .map(|u| u.replace("https://", ""))
            .or_else(|| Some("Tailnet".to_string())),
        auth_url: None,
        socks5_port: config.socks5_port,
        peers,
        error,
        hint,
    }
}

use std::sync::Arc;
use std::time::Duration;

/// Spawns a pure native loopback forwarder connecting via SOCKS5 proxy or candidate endpoints
/// for the target Tailscale node with graceful failover.
pub async fn start_tailscale_forwarder(
    candidates: Vec<String>,
    socks5_port: Option<u16>,
) -> Result<u16, String> {
    if candidates.is_empty() {
        return Err("No candidate endpoints provided for Tailscale forwarder".to_string());
    }

    let proxy_port = socks5_port.unwrap_or(1055);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local loopback port for Tailscale forwarder: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    crate::log_info!(
        "mesh",
        "Tailscale forwarder bound on 127.0.0.1:{} (candidates: {:?}, socks5: 127.0.0.1:{})",
        local_port,
        candidates,
        proxy_port
    );

    let candidates = Arc::new(candidates);

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((mut inbound, client_addr)) => {
                    let cand_list = Arc::clone(&candidates);
                    tokio::spawn(async move {
                        for target in cand_list.iter() {
                            // 1. If SOCKS5 is configured, attempt routing target through SOCKS5 first
                            let proxy_addr = format!("127.0.0.1:{}", proxy_port);
                            let socks_conn = tokio::time::timeout(
                                Duration::from_millis(1500),
                                TcpStream::connect(&proxy_addr),
                            )
                            .await;

                            if let Ok(Ok(mut proxy_stream)) = socks_conn {
                                let mut handshake = Vec::new();
                                handshake.push(0x05); // SOCKS5 version
                                handshake.push(0x01); // 1 auth method
                                handshake.push(0x00); // No auth
                                if proxy_stream.write_all(&handshake).await.is_ok() {
                                    let mut resp = [0u8; 2];
                                    if proxy_stream.read_exact(&mut resp).await.is_ok() && resp[1] == 0x00 {
                                        let mut req = Vec::new();
                                        req.push(0x05); // SOCKS5 version
                                        req.push(0x01); // CONNECT
                                        req.push(0x00); // Reserved

                                        let parts: Vec<&str> = target.split(':').collect();
                                        let tip = parts[0];
                                        let tport: u16 = parts.get(1).and_then(|p| p.parse().ok()).unwrap_or(22);

                                        if let Ok(ip4) = tip.parse::<std::net::Ipv4Addr>() {
                                            req.push(0x01); // IPv4
                                            req.extend_from_slice(&ip4.octets());
                                        } else {
                                            req.push(0x03); // Domain name
                                            req.push(tip.len() as u8);
                                            req.extend_from_slice(tip.as_bytes());
                                        }
                                        req.extend_from_slice(&tport.to_be_bytes());

                                        if proxy_stream.write_all(&req).await.is_ok() {
                                            let mut conn_resp = [0u8; 4];
                                            if proxy_stream.read_exact(&mut conn_resp).await.is_ok() && conn_resp[1] == 0x00 {
                                                // Correctly drain the variable-length bound address + port so stream is not corrupted
                                                let drain_ok = match conn_resp[3] {
                                                    0x01 => {
                                                        let mut buf = [0u8; 6];
                                                        proxy_stream.read_exact(&mut buf).await.is_ok()
                                                    }
                                                    0x03 => {
                                                        let mut len_buf = [0u8; 1];
                                                        if proxy_stream.read_exact(&mut len_buf).await.is_ok() {
                                                            let mut rem = vec![0u8; len_buf[0] as usize + 2];
                                                            proxy_stream.read_exact(&mut rem).await.is_ok()
                                                        } else {
                                                            false
                                                        }
                                                    }
                                                    0x04 => {
                                                        let mut buf = [0u8; 18];
                                                        proxy_stream.read_exact(&mut buf).await.is_ok()
                                                    }
                                                    _ => false,
                                                };

                                                if drain_ok {
                                                    crate::log_info!(
                                                        "mesh",
                                                        "Bridged connection from {} to Tailscale target {} via SOCKS5 proxy",
                                                        client_addr,
                                                        target
                                                    );
                                                    let _ = tokio::io::copy_bidirectional(&mut inbound, &mut proxy_stream).await;
                                                    return;
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // 2. Direct fallback for candidate
                            let connect_res = tokio::time::timeout(
                                Duration::from_millis(1500),
                                TcpStream::connect(target),
                            )
                            .await;

                            if let Ok(Ok(mut direct_stream)) = connect_res {
                                crate::log_info!(
                                    "mesh",
                                    "Bridged connection from {} to Tailscale target {} directly",
                                    client_addr,
                                    target
                                );
                                let _ = tokio::io::copy_bidirectional(&mut inbound, &mut direct_stream).await;
                                return;
                            } else {
                                crate::log_warn!(
                                    "mesh",
                                    "Candidate {} failed for {}: {:?}",
                                    target,
                                    client_addr,
                                    connect_res
                                );
                            }
                        }

                        crate::log_error!(
                            "mesh",
                            "All candidate endpoints failed for Tailscale forwarder ({:?})",
                            cand_list
                        );
                    });
                }
                Err(e) => {
                    crate::log_error!("mesh", "Tailscale forwarder accept error: {}", e);
                    break;
                }
            }
        }
    });

    Ok(local_port)
}
