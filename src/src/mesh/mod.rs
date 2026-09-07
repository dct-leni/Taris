pub mod netbird;
pub mod tailscale;
pub mod wireguard;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;

pub use netbird::{NetBirdConfig, NetBirdPeer, NetBirdStatus};
pub use tailscale::{TailscaleConfig, TailscalePeer, TailscaleStatus};
pub use wireguard::{WireGuardProfile, WireGuardStatus};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NetworkEndpointResult {
    pub host: String,
    pub port: u16,
    pub route_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type")]
pub enum ActiveMeshType {
    WireGuard { profile_id: String, name: String },
    Tailscale,
    NetBird,
}

#[derive(Clone)]
pub struct MeshState {
    pub wireguard: Arc<wireguard::WireGuardManager>,
    pub tailscale: Arc<tailscale::TailscaleManager>,
    pub active_session: Arc<std::sync::Mutex<Option<ActiveMeshType>>>,
}

impl Default for MeshState {
    fn default() -> Self {
        Self {
            wireguard: Arc::new(wireguard::WireGuardManager::new()),
            tailscale: Arc::new(tailscale::TailscaleManager::new()),
            active_session: Arc::new(std::sync::Mutex::new(None)),
        }
    }
}

impl MeshState {
    pub fn disconnect_all(&self) {
        if let Ok(mut map) = self.wireguard.active_sessions.lock() {
            for (_, sess) in map.drain() {
                let _ = sess.shutdown_tx.send(());
            }
        }
        if let Ok(mut cur) = self.active_session.lock() {
            *cur = None;
        }
    }
}


// ── WireGuard Tauri Commands ──

#[tauri::command]
pub fn parse_wireguard_config_text(text: String) -> Result<WireGuardProfile, String> {
    wireguard::parse_wireguard_conf(&text)
}

#[tauri::command]
pub fn export_wireguard_config_text(profile: WireGuardProfile) -> String {
    wireguard::export_wireguard_conf(&profile)
}

#[tauri::command]
pub fn pick_wireguard_conf_file() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .add_filter("WireGuard Config (*.conf)", &["conf"])
        .add_filter("All Files (*.*)", &["*"])
        .set_title("Select WireGuard Configuration File")
        .pick_file();

    if let Some(path) = file {
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read selected file: {}", e))?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn toggle_wireguard_profile_session(
    mesh: tauri::State<'_, MeshState>,
    profile: WireGuardProfile,
    active: bool,
) -> Result<bool, String> {
    let profile_id = profile.id.clone();
    if !active {
        if let Ok(mut map) = mesh.wireguard.active_sessions.lock() {
            if let Some(sess) = map.remove(&profile_id) {
                let _ = sess.shutdown_tx.send(());
            }
        }
        if let Ok(mut cur) = mesh.active_session.lock() {
            if let Some(ActiveMeshType::WireGuard { profile_id: ref id, .. }) = *cur {
                if id == &profile_id {
                    *cur = None;
                }
            }
        }
        return Ok(false);
    }

    // Mutual exclusion: disconnect any other active mesh/VPN first!
    mesh.disconnect_all();

    let name = profile.name.clone();
    let session = wireguard::start_wireguard_tunnel(profile).await?;

    // Give handshake a brief moment (300ms) to detect immediate network or socket failure
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    if let Some(e) = session.error.lock().unwrap().clone() {
        return Err(format!("WireGuard connection error: {}", e));
    }

    if let Ok(mut map) = mesh.wireguard.active_sessions.lock() {
        map.insert(profile_id.clone(), session);
    }
    if let Ok(mut cur) = mesh.active_session.lock() {
        *cur = Some(ActiveMeshType::WireGuard { profile_id, name });
    }
    Ok(true)
}

#[tauri::command]
pub fn get_wireguard_runtime_statuses(
    mesh: tauri::State<'_, MeshState>,
    profiles: Vec<WireGuardProfile>,
) -> Vec<WireGuardStatus> {
    let map = mesh.wireguard.active_sessions.lock().unwrap();
    let mut list = Vec::new();

    for p in profiles {
        if let Some(act) = map.get(&p.id) {
            let rx = act.bytes_rx.load(std::sync::atomic::Ordering::Relaxed);
            let tx = act.bytes_tx.load(std::sync::atomic::Ordering::Relaxed);
            let handshake_secs = act
                .last_handshake
                .lock()
                .unwrap()
                .map(|t| Instant::now().duration_since(t).as_secs());
            let ping = *act.ping_ms.lock().unwrap();
            let mut err = act.error.lock().unwrap().clone();

            // If tunnel has been running for > 4 seconds and still no packet received or handshake completed
            if err.is_none() && handshake_secs.is_none() && act.started_at.elapsed() > std::time::Duration::from_secs(4) {
                err = Some(format!(
                    "Handshake timed out (endpoint '{}' unreachable)",
                    p.peer_endpoint
                ));
            }

            list.push(WireGuardStatus {
                profile_id: p.id.clone(),
                name: p.name.clone(),
                active: true,
                endpoint: p.peer_endpoint.clone(),
                interface_address: p.interface_address.clone(),
                local_forward_port: Some(act.local_forward_port),
                bytes_rx: rx,
                bytes_tx: tx,
                last_handshake_secs: handshake_secs,
                ping_ms: ping,
                error: err,
            });
        } else {
            list.push(WireGuardStatus {
                profile_id: p.id.clone(),
                name: p.name.clone(),
                active: false,
                endpoint: p.peer_endpoint.clone(),
                interface_address: p.interface_address.clone(),
                local_forward_port: None,
                bytes_rx: 0,
                bytes_tx: 0,
                last_handshake_secs: None,
                ping_ms: None,
                error: None,
            });
        }
    }

    list
}

// ── Tailscale Tauri Commands ──

#[tauri::command]
pub fn get_tailscale_runtime_status(config: Option<TailscaleConfig>) -> TailscaleStatus {
    match config {
        Some(cfg) => tailscale::get_tailscale_status(&cfg),
        None => TailscaleStatus {
            active: false,
            mode: "none".to_string(),
            backend_state: "NotConfigured".to_string(),
            self_ip: None,
            self_dns_name: None,
            tailnet_name: None,
            auth_url: None,
            socks5_port: None,
            peers: Vec::new(),
            error: None,
        },
    }
}

#[tauri::command]
pub async fn get_tailscale_endpoint(
    target_ip: String,
    target_port: u16,
    socks5_port: Option<u16>,
) -> Result<u16, String> {
    tailscale::start_tailscale_forwarder(target_ip, target_port, socks5_port).await
}

// ── NetBird Tauri Commands ──

#[tauri::command]
pub async fn get_netbird_runtime_status(config: Option<NetBirdConfig>) -> NetBirdStatus {
    match config {
        Some(cfg) => netbird::get_netbird_status(&cfg).await,
        None => NetBirdStatus {
            connected: false,
            management_url: "https://api.netbird.io".to_string(),
            account_id: None,
            setup_key_info: None,
            self_peer: None,
            peers: Vec::new(),
            error: None,
        },
    }
}

#[tauri::command]
pub async fn get_netbird_endpoint(
    target_ip: String,
    target_port: u16,
) -> Result<u16, String> {
    netbird::start_netbird_forwarder(vec![format!("{}:{}", target_ip, target_port)]).await
}

pub fn launch_url_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("Failed to launch browser: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to launch browser: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to launch browser: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn toggle_tailscale_session(
    mesh: tauri::State<'_, MeshState>,
    config: Option<TailscaleConfig>,
    active: Option<bool>,
    enabled: Option<bool>,
) -> Result<bool, String> {
    let is_active = active.or(enabled).unwrap_or(true);
    if is_active {
        let cfg = config.ok_or_else(|| "Tailscale is not configured. Please enter your Auth Key in settings.".to_string())?;

        let status = tailscale::get_tailscale_status(&cfg);
        if !status.active {
            let err = status.error.unwrap_or_else(|| "Tailscale is not configured. Please enter your key.".to_string());
            return Err(format!("Tailscale connection failed: {}", err));
        }

        mesh.disconnect_all();
        if let Ok(mut cur) = mesh.active_session.lock() {
            *cur = Some(ActiveMeshType::Tailscale);
        }
        Ok(true)
    } else {
        if let Ok(mut cur) = mesh.active_session.lock() {
            if let Some(ActiveMeshType::Tailscale) = *cur {
                *cur = None;
            }
        }
        Ok(false)
    }
}

#[tauri::command]
pub async fn toggle_netbird_session(
    mesh: tauri::State<'_, MeshState>,
    config: Option<NetBirdConfig>,
    active: Option<bool>,
    enabled: Option<bool>,
) -> Result<bool, String> {
    let is_active = active.or(enabled).unwrap_or(true);
    if is_active {
        let cfg = config.ok_or_else(|| "NetBird is not configured. Please enter your Setup Key or Access Token in settings.".to_string())?;

        let has_key = cfg
            .personal_access_token
            .as_deref()
            .or(cfg.setup_key.as_deref())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);

        if !has_key {
            return Err("Missing NetBird Setup Key or Personal Access Token (PAT). Please enter your key or token in settings.".to_string());
        }

        let status = netbird::get_netbird_status(&cfg).await;
        if !status.connected {
            let err = status.error.unwrap_or_else(|| "Failed to connect to NetBird Management API".to_string());
            return Err(format!("NetBird connection failed: {}", err));
        }

        mesh.disconnect_all();
        if let Ok(mut cur) = mesh.active_session.lock() {
            *cur = Some(ActiveMeshType::NetBird);
        }
        Ok(true)
    } else {
        if let Ok(mut cur) = mesh.active_session.lock() {
            if let Some(ActiveMeshType::NetBird) = *cur {
                *cur = None;
            }
        }
        Ok(false)
    }
}

#[tauri::command]
pub fn get_active_mesh_session(
    mesh: tauri::State<'_, MeshState>,
) -> Option<ActiveMeshType> {
    mesh.active_session.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn disconnect_all_mesh_sessions(
    mesh: tauri::State<'_, MeshState>,
) -> bool {
    mesh.disconnect_all();
    true
}

#[tauri::command]
pub fn open_mesh_auth_portal(
    provider: String,
    base_url: Option<String>,
    _page_type: Option<String>,
) -> Result<String, String> {
    let url = match provider.to_lowercase().as_str() {
        "tailscale" => {
            let base = base_url.as_deref().unwrap_or("").trim();
            if !base.is_empty() && !base.contains("tailscale.com") {
                base.to_string()
            } else {
                "https://login.tailscale.com/admin/settings/keys".to_string()
            }
        }
        "netbird" => {
            let base = base_url.as_deref().unwrap_or("").trim();
            let is_saas = base.is_empty() || base.contains("api.netbird.io") || base.contains("app.netbird.io");

            if is_saas {
                "https://app.netbird.io/team/users".to_string()
            } else {
                let clean_base = base.trim_end_matches('/').trim_end_matches("/api");
                format!("{}/team/users", clean_base)
            }
        }
        _ => return Err(format!("Unknown mesh provider '{}'", provider)),
    };

    launch_url_in_browser(&url)?;
    Ok(url)
}


// ── Universal Mesh Routing Command ──

// ── Universal Mesh Routing Command ──

pub async fn resolve_mesh_endpoint(
    config_path: &std::path::Path,
    mesh: &MeshState,
    host: &crate::HostConfig,
    target_port_override: Option<u16>,
) -> Result<NetworkEndpointResult, String> {
    let target_host = if host.host.is_empty() { "127.0.0.1".to_string() } else { host.host.clone() };
    let target_port = target_port_override.unwrap_or_else(|| if host.port == 0 { 22 } else { host.port });

    let route_str = host.network_route.clone().unwrap_or_else(|| "direct".to_string());
    let route = route_str.as_str();

    if route == "direct" {
        return Ok(NetworkEndpointResult {
            host: target_host,
            port: target_port,
            route_type: "Direct".into(),
        });
    }

    let active_type = {
        let cur = mesh.active_session.lock().unwrap();
        cur.clone()
    };

    let cfg = crate::load_or_init_config(config_path);

    let effective_type = match route {
        "mesh" => {
            if let Some(ref m) = active_type {
                m.clone()
            } else {
                let wg_active = {
                    let map = mesh.wireguard.active_sessions.lock().unwrap();
                    map.keys().next().cloned()
                };
                if let Some(pid) = wg_active {
                    let name = cfg.wireguard_profiles.iter().find(|p| p.id == pid).map(|p| p.name.clone()).unwrap_or_default();
                    ActiveMeshType::WireGuard { profile_id: pid, name }
                } else if cfg.netbird.as_ref().map(|n| n.enabled).unwrap_or(false) {
                    ActiveMeshType::NetBird
                } else if cfg.tailscale.as_ref().map(|t| t.enabled).unwrap_or(false) {
                    ActiveMeshType::Tailscale
                } else {
                    return Err("No Mesh or VPN connection is currently active in Taris. Please connect in the Mesh/VPN drawer.".into());
                }
            }
        }
        r if r.starts_with("wireguard:") => {
            let pid = r.trim_start_matches("wireguard:");
            let name = cfg.wireguard_profiles.iter().find(|p| p.id == pid).map(|p| p.name.clone()).unwrap_or_default();
            ActiveMeshType::WireGuard { profile_id: pid.to_string(), name }
        }
        "netbird" => ActiveMeshType::NetBird,
        "tailscale" => ActiveMeshType::Tailscale,
        _ => {
            return Ok(NetworkEndpointResult {
                host: target_host,
                port: target_port,
                route_type: "Direct".into(),
            });
        }
    };

    match effective_type {
        ActiveMeshType::WireGuard { profile_id, name } => {
            let profile = cfg.wireguard_profiles.iter().find(|p| p.id == profile_id)
                .ok_or_else(|| format!("WireGuard profile '{}' not found", profile_id))?
                .clone();

            let port = {
                let map = mesh.wireguard.active_sessions.lock().unwrap();
                map.get(&profile_id).map(|s| s.local_forward_port)
            };

            let active_port = match port {
                Some(p) => p,
                None => {
                    mesh.disconnect_all();
                    let session = wireguard::start_wireguard_tunnel(profile).await?;
                    let p = session.local_forward_port;
                    mesh.wireguard.active_sessions.lock().unwrap().insert(profile_id.clone(), session);
                    if let Ok(mut cur) = mesh.active_session.lock() {
                        *cur = Some(ActiveMeshType::WireGuard { profile_id, name });
                    }
                    p
                }
            };

            crate::log_info!("mesh", "Routed {} through WireGuard tunnel to local port {}", host.name, active_port);
            Ok(NetworkEndpointResult {
                host: "127.0.0.1".into(),
                port: active_port,
                route_type: "WireGuard".into(),
            })
        }
        ActiveMeshType::Tailscale => {
            let ts_cfg = cfg.tailscale.as_ref().ok_or_else(|| "Tailscale is not configured in settings".to_string())?;
            let ts_status = tailscale::get_tailscale_status(ts_cfg);
            if !ts_status.active {
                let err = ts_status.error.unwrap_or_else(|| format!("Tailscale daemon is not running (state: {})", ts_status.backend_state));
                return Err(format!("Tailscale route failed: {}", err));
            }

            let mut candidates = Vec::new();
            if let Some(ref exit_node) = ts_cfg.exit_node {
                if !exit_node.is_empty() && exit_node != &target_host {
                    candidates.push(format!("{}:{}", exit_node, target_port));
                }
            }
            candidates.push(format!("{}:{}", target_host, target_port));

            if let Some(peer) = ts_status.peers.iter().find(|p| {
                p.tailscale_ips.contains(&target_host)
                    || p.hostname.eq_ignore_ascii_case(&target_host)
                    || p.dns_name.eq_ignore_ascii_case(&target_host)
            }) {
                for h in &cfg.hosts {
                    let matches_peer = h.name.eq_ignore_ascii_case(&peer.hostname)
                        || (peer.hostname.len() >= 3 && h.name.to_lowercase().contains(&peer.hostname.to_lowercase()));
                    if matches_peer && !h.host.is_empty() && h.host != target_host {
                        candidates.push(format!("{}:{}", h.host, target_port));
                    }
                }
            }

            mesh.disconnect_all();
            let port = netbird::start_netbird_forwarder(candidates).await?;
            if let Ok(mut cur) = mesh.active_session.lock() {
                *cur = Some(ActiveMeshType::Tailscale);
            }
            crate::log_info!("mesh", "Routed {} through Tailscale tunnel to local port {}", host.name, port);
            Ok(NetworkEndpointResult {
                host: "127.0.0.1".into(),
                port,
                route_type: "Tailscale".into(),
            })
        }
        ActiveMeshType::NetBird => {
            let mut candidates = Vec::new();

            // 1. If an exit node is configured, prioritize routing through exit node endpoint
            if let Some(ref nb_cfg) = cfg.netbird {
                if let Some(ref exit_node) = nb_cfg.exit_node {
                    if !exit_node.is_empty() && exit_node != &target_host {
                        candidates.push(format!("{}:{}", exit_node, target_port));
                    }
                }
            }

            candidates.push(format!("{}:{}", target_host, target_port));

            // 2. Discover peer endpoints from NetBird management
            if let Some(ref nb_cfg) = cfg.netbird {
                if let Ok(nb_status) = tokio::time::timeout(
                    std::time::Duration::from_secs(6),
                    netbird::query_netbird_management(nb_cfg)
                ).await.unwrap_or(Err("NetBird API query timed out".into())) {
                    if let Some(peer) = nb_status.peers.iter().find(|p| {
                        p.ip == target_host
                            || p.hostname.as_deref() == Some(&target_host)
                            || p.name.eq_ignore_ascii_case(&target_host)
                    }) {
                        if let Some(ref conn_ip) = peer.connection_ip {
                            if !conn_ip.is_empty() && conn_ip != &target_host {
                                candidates.push(format!("{}:{}", conn_ip, target_port));
                            }
                        }

                        for h in &cfg.hosts {
                            let matches_peer = h.name.eq_ignore_ascii_case(&peer.name)
                                || peer.hostname.as_ref().map_or(false, |hn| h.name.eq_ignore_ascii_case(hn))
                                || (peer.name.len() >= 3 && h.name.to_lowercase().contains(&peer.name.to_lowercase()));
                            if matches_peer && !h.host.is_empty() && h.host != target_host {
                                candidates.push(format!("{}:{}", h.host, target_port));
                            }
                        }
                    }
                }
            }

            mesh.disconnect_all();
            let port = netbird::start_netbird_forwarder(candidates).await?;
            if let Ok(mut cur) = mesh.active_session.lock() {
                *cur = Some(ActiveMeshType::NetBird);
            }
            crate::log_info!("mesh", "Routed {} through NetBird tunnel to local port {}", host.name, port);
            Ok(NetworkEndpointResult {
                host: "127.0.0.1".into(),
                port,
                route_type: "NetBird".into(),
            })
        }
    }
}

pub fn resolve_mesh_endpoint_sync(
    config_path: &std::path::Path,
    mesh: &MeshState,
    host: &crate::HostConfig,
    target_port_override: Option<u16>,
) -> Result<NetworkEndpointResult, String> {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        tokio::task::block_in_place(|| {
            handle.block_on(resolve_mesh_endpoint(config_path, mesh, host, target_port_override))
        })
    } else {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        rt.block_on(resolve_mesh_endpoint(config_path, mesh, host, target_port_override))
    }
}

#[tauri::command]
pub async fn get_mesh_tunnel_endpoint(
    state: tauri::State<'_, crate::AppState>,
    host_id: String,
    target_host_override: Option<String>,
    target_port_override: Option<u16>,
) -> Result<NetworkEndpointResult, String> {
    let host = {
        let cfg = crate::load_or_init_config(&state.config_path);
        cfg.hosts.iter().find(|h| h.id == host_id).cloned()
    };

    let mut h = host.unwrap_or_else(|| crate::HostConfig {
        id: host_id.clone(),
        name: host_id,
        host: target_host_override.clone().unwrap_or_else(|| "127.0.0.1".into()),
        port: target_port_override.unwrap_or(22),
        user: "root".into(),
        auth_type: "key".into(),
        key_path: None,
        password: None,
        has_docker: false,
        icon: "\u{f233}".into(),
        docker_port: None,
        enable_port_scan: false,
        mac_address: None,
        cloud_provider: None,
        cloud_project_id: None,
        cloud_zone: None,
        cloud_instance_id: None,
        network_route: Some("mesh".into()),
    });

    if let Some(th) = target_host_override {
        h.host = th;
    }
    if let Some(tp) = target_port_override {
        h.port = tp;
    }

    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        resolve_mesh_endpoint(&state.config_path, &state.mesh, &h, target_port_override)
    )
    .await
    .map_err(|_| "Mesh tunnel resolution timed out (10s)".to_string())?
}

