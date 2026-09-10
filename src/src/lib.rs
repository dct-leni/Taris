use chrono::Local;
pub mod archive;
pub mod cloud;
pub mod docker;
pub mod editor;
pub mod icons;
pub mod importer;
pub mod logs;
pub mod mcp;
pub mod mesh;
pub mod mosh;
pub mod ports;
pub mod ssh;
pub mod terminal;
pub mod wsl;

pub use logs::*;
pub use ssh::*;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn default_mcp_server_port() -> u16 {
    8765
}

fn default_false() -> bool {
    false
}

fn default_app_font_size() -> u32 {
    13
}

fn default_cursor_style() -> String {
    "block".to_string()
}

fn default_port() -> u16 {
    22
}

fn default_host_icon() -> String {
    "\u{f233}".to_string()
}


fn default_scrollback() -> u32 {
    10000
}

fn default_theme() -> String {
    "one_dark".to_string()
}

fn default_docker_port() -> u16 {
    2375
}

fn default_drawer_width() -> u32 {
    240
}

fn default_sidebar_width() -> u32 {
    310
}

fn default_sftp_col_date_width() -> u32 {
    105
}

fn default_sftp_col_size_width() -> u32 {
    55
}

fn default_true() -> bool {
    true
}

fn default_sftp_col_type_width() -> u32 {
    50
}

fn default_sftp_col_perms_width() -> u32 {
    75
}

fn default_rail_order() -> Vec<String> {
    vec![
        "hosts".into(),
        "cloud".into(),
        "files".into(),
        "snippets".into(),
        "docker".into(),
        "ports".into(),
        "tunnels".into(),
        "wireguard".into(),
    ]
}

fn default_font_family() -> String {
    "Cascadia Code".to_string()
}

fn default_font_size() -> u32 {
    14
}

fn default_shell_name() -> String {
    "powershell".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SettingsConfig {
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_app_font_size")]
    pub app_font_size: u32,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_theme")]
    pub app_theme: String,
    #[serde(default = "default_theme")]
    pub terminal_theme: String,
    #[serde(default = "default_shell_name")]
    pub default_shell: String,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default)]
    pub external_editor: Option<String>,
    #[serde(default)]
    pub external_editor_name: Option<String>,
    #[serde(default = "default_docker_port")]
    pub docker_port: u16,
    #[serde(default = "default_drawer_width")]
    pub drawer_width: u32,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default = "default_sftp_col_date_width")]
    pub sftp_col_date_width: u32,
    #[serde(default = "default_sftp_col_size_width")]
    pub sftp_col_size_width: u32,
    #[serde(default = "default_scrollback")]
    pub scrollback: u32,
    #[serde(default = "default_true")]
    pub enable_multiplexing: bool,
    #[serde(default)]
    pub enable_ssh_compression: bool,
    #[serde(default)]
    pub enable_app_logs: bool,
    #[serde(default = "default_false")]
    pub enable_mcp_server: bool,
    #[serde(default = "default_mcp_server_port")]
    pub mcp_server_port: u16,
    #[serde(default)]
    pub custom_themes: std::collections::HashMap<String, serde_json::Value>,
}

impl Default for SettingsConfig {
    fn default() -> Self {
        Self {
            font_family: default_font_family(),
            font_size: default_font_size(),
            app_font_size: default_app_font_size(),
            theme: default_theme(),
            app_theme: default_theme(),
            terminal_theme: default_theme(),
            default_shell: default_shell_name(),
            cursor_style: default_cursor_style(),
            external_editor: None,
            external_editor_name: None,
            docker_port: default_docker_port(),
            drawer_width: default_drawer_width(),
            sidebar_width: default_sidebar_width(),
            sftp_col_date_width: default_sftp_col_date_width(),
            sftp_col_size_width: default_sftp_col_size_width(),
            scrollback: default_scrollback(),
            enable_multiplexing: true,
            enable_ssh_compression: false,
            enable_app_logs: false,
            enable_mcp_server: false,
            mcp_server_port: default_mcp_server_port(),
            custom_themes: std::collections::HashMap::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HostConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub auth_type: String, // "key" or "password"
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub has_docker: bool,
    #[serde(default = "default_host_icon")]
    pub icon: String,
    #[serde(default)]
    pub docker_port: Option<u16>,
    #[serde(default = "default_true")]
    pub enable_port_scan: bool,
    #[serde(default)]
    pub mac_address: Option<String>,
    #[serde(default)]
    pub cloud_provider: Option<String>,
    #[serde(default)]
    pub cloud_project_id: Option<String>,
    #[serde(default)]
    pub cloud_zone: Option<String>,
    #[serde(default)]
    pub cloud_instance_id: Option<String>,
    #[serde(default)]
    pub network_route: Option<String>,
    #[serde(default)]
    pub protocol: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TunnelConfig {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    #[serde(default)]
    pub auto_start: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TunnelStatus {
    pub id: String,
    pub name: String,
    pub host_id: String,
    pub host_name: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub is_active: bool,
    pub bytes_rx: u64,
    pub bytes_tx: u64,
    pub active_connections: u32,
    pub error: Option<String>,
}


#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SnippetItem {
    pub id: String,
    pub title: String,
    pub command: String,
    #[serde(default)]
    pub tags: Option<String>,
}

fn default_snippets() -> Vec<SnippetItem> {
    vec![
        SnippetItem {
            id: "snip-1".into(),
            title: "Docker PS".into(),
            command: "docker ps -a".into(),
            tags: Some("docker".into()),
        },
        SnippetItem {
            id: "snip-2".into(),
            title: "Disk Usage".into(),
            command: "df -h".into(),
            tags: Some("system".into()),
        },
        SnippetItem {
            id: "snip-3".into(),
            title: "Memory Info".into(),
            command: "free -h".into(),
            tags: Some("system".into()),
        },
        SnippetItem {
            id: "snip-4".into(),
            title: "Network Sockets".into(),
            command: "ss -tulpn".into(),
            tags: Some("network".into()),
        },
        SnippetItem {
            id: "snip-5".into(),
            title: "Systemd Logs".into(),
            command: "journalctl -xe -f".into(),
            tags: Some("logs".into()),
        },
    ]
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SessionConfig {
    #[serde(default)]
    pub active_view: Option<String>,
    #[serde(default)]
    pub active_category: Option<String>,
    #[serde(default = "default_rail_order")]
    pub rail_order: Vec<String>,
    #[serde(default)]
    pub show_host_ip: bool,
}

impl Default for SessionConfig {
    fn default() -> Self {
        Self {
            active_view: Some("local".into()),
            active_category: Some("hosts".into()),
            rail_order: default_rail_order(),
            show_host_ip: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileExplorerConfig {
    #[serde(default = "default_true")]
    pub col_date: bool,
    #[serde(default = "default_true")]
    pub col_size: bool,
    #[serde(default)]
    pub col_type: bool,
    #[serde(default)]
    pub col_perms: bool,
    #[serde(default = "default_sftp_col_date_width")]
    pub width_date: u32,
    #[serde(default = "default_sftp_col_size_width")]
    pub width_size: u32,
    #[serde(default = "default_sftp_col_type_width")]
    pub width_type: u32,
    #[serde(default = "default_sftp_col_perms_width")]
    pub width_perms: u32,
}

impl Default for FileExplorerConfig {
    fn default() -> Self {
        Self {
            col_date: true,
            col_size: true,
            col_type: false,
            col_perms: false,
            width_date: 105,
            width_size: 55,
            width_type: 50,
            width_perms: 75,
        }
    }
}

pub use cloud::{CloudAuthConfig, CloudAuthStatus, CloudInstance, CloudProject, CloudSshEndpoint};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppConfig {
    #[serde(default)]
    pub settings: SettingsConfig,
    #[serde(default)]
    pub hosts: Vec<HostConfig>,
    #[serde(default = "default_snippets")]
    pub snippets: Vec<SnippetItem>,
    #[serde(default)]
    pub session: SessionConfig,
    #[serde(default)]
    pub file_explorer: FileExplorerConfig,
    #[serde(default)]
    pub tunnels: Vec<TunnelConfig>,
    #[serde(default)]
    pub cloud_auth: CloudAuthConfig,
    #[serde(default)]
    pub wireguard_profiles: Vec<mesh::WireGuardProfile>,
    #[serde(default)]
    pub tailscale: Option<mesh::TailscaleConfig>,
    #[serde(default)]
    pub netbird: Option<mesh::NetBirdConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            settings: SettingsConfig::default(),
            hosts: vec![],
            snippets: default_snippets(),
            session: SessionConfig::default(),
            file_explorer: FileExplorerConfig::default(),
            tunnels: vec![],
            cloud_auth: CloudAuthConfig::default(),
            wireguard_profiles: Vec::new(),
            tailscale: None,
            netbird: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TelemetryData {
    pub cpu: f32,
    pub ram: f32,
    pub net_rx: u64,
    pub net_tx: u64,
    #[serde(default)]
    pub ping_ms: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RealFileItem {
    pub name: String,
    pub path: String,
    pub size: String,
    pub modified: String,
    pub is_dir: bool,
    pub is_db: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TableSummary {
    pub name: String,
    pub count: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub duration_ms: f64,
}

pub enum PtySessionBackend {
    Local {
        master: Box<dyn portable_pty::MasterPty + Send>,
        writer: Box<dyn Write + Send>,
        child: Box<dyn portable_pty::Child + Send + Sync>,
    },
    Ssh {
        write_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
        resize_tx: tokio::sync::mpsc::Sender<(u16, u16)>,
        shutdown_tx: tokio::sync::broadcast::Sender<()>,
    },
    Mosh {
        write_tx: tokio::sync::mpsc::Sender<Vec<u8>>,
        resize_tx: tokio::sync::mpsc::Sender<(u16, u16)>,
        shutdown_tx: tokio::sync::broadcast::Sender<()>,
    },
}

pub struct PtySession {
    pub backend: PtySessionBackend,
}

pub struct ActiveTunnel {
    pub config: TunnelConfig,
    pub shutdown_tx: tokio::sync::broadcast::Sender<()>,
    pub bytes_rx: Arc<std::sync::atomic::AtomicU64>,
    pub bytes_tx: Arc<std::sync::atomic::AtomicU64>,
    pub active_connections: Arc<std::sync::atomic::AtomicU32>,
    pub error: Arc<Mutex<Option<String>>>,
}

#[derive(Clone)]
pub struct AppState {
    pub pty_sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pub config_path: PathBuf,
    pub ssh_pool: ssh::SshSessionPool,
    pub docker_cpu_samples: Arc<Mutex<HashMap<String, (u64, u64, std::time::Instant)>>>,
    pub active_tunnels: Arc<Mutex<HashMap<String, ActiveTunnel>>>,
    pub mesh: Arc<mesh::MeshState>,
    pub mcp_handle: Arc<Mutex<Option<mcp::McpServerHandle>>>,
}

impl AppState {
    pub async fn get_russh_session(&self, host: &HostConfig) -> Result<Arc<russh::client::Handle<ssh::TarisSshHandler>>, String> {
        let is_mesh = host.network_route.as_deref() == Some("mesh")
            || (host.network_route.is_some() && host.network_route.as_deref() != Some("direct"));

        if is_mesh {
            match mesh::resolve_mesh_endpoint_sync(&self.config_path, &self.mesh, host, None) {
                Ok(ep) => {
                    crate::log_info!("ssh", "Connecting to {} via mesh route {} at {}:{}", host.name, ep.route_type, ep.host, ep.port);
                    self.ssh_pool.take_session_with_target(host, &ep.host, ep.port).await
                }
                Err(e) => {
                    crate::log_error!("ssh", "Failed to resolve mesh route for {}: {}", host.name, e);
                    Err(format!("Mesh routing failed for {}: {}", host.name, e))
                }
            }
        } else {
            let port = if host.port == 0 { 22 } else { host.port };
            self.ssh_pool.take_session_with_target(host, &host.host, port).await
        }
    }

    pub async fn create_interactive_russh_session(
        &self,
        host: &HostConfig,
        banner_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    ) -> Result<Arc<russh::client::Handle<ssh::TarisSshHandler>>, String> {
        let is_mesh = host.network_route.as_deref() == Some("mesh")
            || (host.network_route.is_some() && host.network_route.as_deref() != Some("direct"));

        let handler = if let Some(tx) = banner_tx {
            ssh::TarisSshHandler::with_banner_tx(&host.name, tx)
        } else {
            ssh::TarisSshHandler::new(&host.name)
        };

        if is_mesh {
            match mesh::resolve_mesh_endpoint_sync(&self.config_path, &self.mesh, host, None) {
                Ok(ep) => {
                    crate::log_info!("ssh", "Connecting dedicated interactive russh to {} via mesh route {} at {}:{}", host.name, ep.route_type, ep.host, ep.port);
                    ssh::open_russh_session_with_handler(host, &ep.host, ep.port, handler).await
                }
                Err(e) => {
                    crate::log_error!("ssh", "Failed to resolve mesh route for {}: {}", host.name, e);
                    Err(format!("Mesh routing failed for {}: {}", host.name, e))
                }
            }
        } else {
            let port = if host.port == 0 { 22 } else { host.port };
            ssh::open_russh_session_with_handler(host, &host.host, port, handler).await
        }
    }

    pub async fn get_sftp_session(&self, host: &HostConfig) -> Result<russh_sftp::client::SftpSession, String> {
        let handle = self.get_russh_session(host).await?;
        let channel = handle.channel_open_session().await.map_err(|e| format!("Failed to open SSH channel for SFTP: {}", e))?;
        channel.request_subsystem(true, "sftp").await.map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;
        russh_sftp::client::SftpSession::new(channel.into_stream()).await.map_err(|e| format!("Failed to initialize SFTP session: {}", e))
    }
}

// ── PTY Commands ──

pub(crate) fn parse_command_line(cmd_str: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut quote_char = ' ';

    for ch in cmd_str.chars() {
        match ch {
            '"' | '\'' if !in_quotes => {
                in_quotes = true;
                quote_char = ch;
            }
            c if in_quotes && c == quote_char => {
                in_quotes = false;
            }
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    args.push(current);
                    current = String::new();
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

pub fn is_command_in_path(cmd: &str) -> bool {
    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let full_path = dir.join(cmd);
            if full_path.is_file() {
                return true;
            }
            #[cfg(target_os = "windows")]
            {
                if !cmd.contains('.') {
                    for ext in &[".exe", ".cmd", ".bat"] {
                        let with_ext = dir.join(format!("{}{}", cmd, ext));
                        if with_ext.is_file() {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiscoveredShell {
    pub id: String,
    pub name: String,
    pub path: String,
}

pub fn find_git_bash() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\usr\bin\bash.exe",
    ];
    for c in &candidates {
        let p = Path::new(c);
        if p.exists() {
            return Some(p.to_path_buf());
        }
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let p = Path::new(&local_app_data).join("Programs").join("Git").join("bin").join("bash.exe");
        if p.exists() {
            return Some(p);
        }
        let p2 = Path::new(&local_app_data).join("Programs").join("Git").join("usr").join("bin").join("bash.exe");
        if p2.exists() {
            return Some(p2);
        }
    }
    None
}

pub fn discover_available_shells() -> Vec<DiscoveredShell> {
    let mut shells = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // 1. Windows PowerShell
        let win_ps = Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        shells.push(DiscoveredShell {
            id: "powershell".into(),
            name: "PowerShell (Windows)".into(),
            path: if win_ps.exists() { win_ps.to_string_lossy().to_string() } else { "powershell".into() },
        });

        // 2. PowerShell 7 (pwsh)
        if is_command_in_path("pwsh") {
            shells.push(DiscoveredShell {
                id: "pwsh".into(),
                name: "PowerShell 7".into(),
                path: "pwsh".into(),
            });
        } else {
            let pwsh_candidates = [
                r"C:\Program Files\PowerShell\7\pwsh.exe",
                r"C:\Program Files\PowerShell\7-preview\pwsh.exe",
            ];
            for c in &pwsh_candidates {
                let p = Path::new(c);
                if p.exists() {
                    shells.push(DiscoveredShell {
                        id: "pwsh".into(),
                        name: "PowerShell 7".into(),
                        path: p.to_string_lossy().to_string(),
                    });
                    break;
                }
            }
        }

        // 3. Command Prompt
        let cmd_exe = Path::new(r"C:\Windows\System32\cmd.exe");
        shells.push(DiscoveredShell {
            id: "cmd".into(),
            name: "Command Prompt (CMD)".into(),
            path: if cmd_exe.exists() { cmd_exe.to_string_lossy().to_string() } else { "cmd".into() },
        });

        // 4. Git Bash
        if is_command_in_path("bash") {
            shells.push(DiscoveredShell {
                id: "git-bash".into(),
                name: "Git Bash".into(),
                path: "bash".into(),
            });
        } else if let Some(git_bash) = find_git_bash() {
            shells.push(DiscoveredShell {
                id: "git-bash".into(),
                name: "Git Bash".into(),
                path: git_bash.to_string_lossy().to_string(),
            });
        }

        // 5. WSL
        let wsl_exe = Path::new(r"C:\Windows\System32\wsl.exe");
        if wsl_exe.exists() || is_command_in_path("wsl") {
            shells.push(DiscoveredShell {
                id: "wsl".into(),
                name: "WSL (Default Linux)".into(),
                path: "wsl".into(),
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let default_shell_env = std::env::var("SHELL").unwrap_or_default();
        let candidate_shells = [
            ("zsh", "Zsh"),
            ("bash", "Bash"),
            ("fish", "Fish"),
            ("pwsh", "PowerShell 7"),
            ("sh", "Sh"),
        ];

        for &(cmd, name) in &candidate_shells {
            let is_default = default_shell_env.ends_with(cmd);
            if is_command_in_path(cmd) || Path::new(&format!("/bin/{}", cmd)).exists() || Path::new(&format!("/usr/bin/{}", cmd)).exists() {
                shells.push(DiscoveredShell {
                    id: cmd.into(),
                    name: if is_default { format!("{} (Default)", name) } else { name.into() },
                    path: cmd.into(),
                });
            }
        }
    }

    shells
}

#[tauri::command]
fn get_available_shells() -> Vec<DiscoveredShell> {
    discover_available_shells()
}

#[tauri::command]
async fn pty_spawn(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: String,
    shell_type: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    host: Option<HostConfig>,
    command: Option<String>,
    on_data: tauri::ipc::Channel<String>,
) -> Result<(), String> {
    if let Some(h) = host {
        if h.protocol.as_deref() == Some("mosh") {
            let handle = state.get_russh_session(&h).await?;
            let (write_tx, resize_tx, shutdown_tx) = crate::mosh::spawn_mosh_session(
                &handle,
                &h,
                cols.unwrap_or(80),
                rows.unwrap_or(24),
                on_data,
            )
            .await?;

            state.pty_sessions.lock().unwrap().insert(
                session_id.clone(),
                PtySession {
                    backend: PtySessionBackend::Mosh {
                        write_tx,
                        resize_tx,
                        shutdown_tx,
                    },
                },
            );

            return Ok(());
        }

        // Direct in-process dedicated russh PTY channel session
        let (banner_tx, mut banner_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let handle = state.create_interactive_russh_session(&h, Some(banner_tx)).await?;
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("Failed to open SSH session channel: {}", e))?;

        channel
            .request_pty(
                true,
                "xterm-256color",
                cols.unwrap_or(80) as u32,
                rows.unwrap_or(24) as u32,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| format!("Failed to request SSH PTY: {}", e))?;

        if let Some(ref cmd) = command.filter(|c| !c.trim().is_empty()) {
            crate::log_info!("ssh", "Executing command in PTY for {}: {}", h.name, cmd);
            channel
                .exec(true, cmd.as_str())
                .await
                .map_err(|e| format!("Failed to exec command in SSH PTY: {}", e))?;
        } else {
            channel
                .request_shell(true)
                .await
                .map_err(|e| format!("Failed to request SSH shell: {}", e))?;
        }

        // Forward any pre-auth banner received during authentication
        while let Ok(banner) = banner_rx.try_recv() {
            let normalized = banner.replace("\r\n", "\n").replace('\n', "\r\n");
            let _ = on_data.send(normalized);
        }

        let (write_tx, mut write_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);
        let (resize_tx, mut resize_rx) = tokio::sync::mpsc::channel::<(u16, u16)>(32);
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::broadcast::channel::<()>(1);

        state.pty_sessions.lock().unwrap().insert(
            session_id.clone(),
            PtySession {
                backend: PtySessionBackend::Ssh {
                    write_tx,
                    resize_tx,
                    shutdown_tx,
                },
            },
        );

        let session_id_clone = session_id.clone();
        let app_clone = app.clone();
        let state_pool = state.ssh_pool.clone();
        let h_clone = h.clone();
        let pty_sessions_clone = state.pty_sessions.clone();

        tokio::spawn(async move {
            let mut zmodem_detector = crate::terminal::ZmodemDetector::new();
            loop {
                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        let _ = channel.close().await;
                        let _ = handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
                        break;
                    }
                    Some((c, r)) = resize_rx.recv() => {
                        let _ = channel.window_change(c as u32, r as u32, 0, 0).await;
                    }
                    Some(bytes) = write_rx.recv() => {
                        if channel.data(&bytes[..]).await.is_err() {
                            break;
                        }
                    }
                    msg = channel.wait() => {
                        match msg {
                            Some(russh::ChannelMsg::Data { ref data }) => {
                                let (display_bytes, event_opt) = zmodem_detector.feed(data);
                                if let Some(event) = event_opt {
                                    use tauri::Emitter;
                                    let _ = app_clone.emit(&format!("zmodem-event-{}", session_id_clone), &event);
                                }
                                if !display_bytes.is_empty() {
                                    let s = String::from_utf8_lossy(&display_bytes).to_string();
                                    if on_data.send(s).is_err() {
                                        break;
                                    }
                                }
                            }
                            Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                                let (display_bytes, _) = zmodem_detector.feed(data);
                                if !display_bytes.is_empty() {
                                    let s = String::from_utf8_lossy(&display_bytes).to_string();
                                    if on_data.send(s).is_err() {
                                        break;
                                    }
                                }
                            }
                            Some(russh::ChannelMsg::ExitStatus { .. }) | Some(russh::ChannelMsg::Eof) | None => {
                                let _ = on_data.send("\r\n\x1b[90m[Connection closed]\x1b[0m\r\n".to_string());
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }

            let _ = channel.close().await;
            let _ = handle.disconnect(russh::Disconnect::ByApplication, "Session terminated", "en").await;
            pty_sessions_clone.lock().unwrap().remove(&session_id_clone);
            state_pool.remove_session(&h_clone).await;
        });

        return Ok(());
    }

    // Local shell spawned via portable_pty
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = shell_type.unwrap_or_else(|| {
        #[cfg(target_os = "windows")]
        { "powershell".into() }
        #[cfg(not(target_os = "windows"))]
        { std::env::var("SHELL").unwrap_or_else(|_| "bash".into()) }
    });
    let mut cmd = if shell == "cmd" || shell == "cmd.exe" {
        CommandBuilder::new("cmd.exe")
    } else if shell == "powershell" || shell == "powershell.exe" {
        let mut c = CommandBuilder::new("powershell.exe");
        c.args(["-NoLogo"]);
        c
    } else if shell == "pwsh" || shell == "pwsh.exe" {
        let mut c = CommandBuilder::new("pwsh");
        c.args(["-NoLogo"]);
        c
    } else if shell == "git-bash" || shell == "bash" || shell == "bash.exe" {
        #[cfg(target_os = "windows")]
        {
            let bash_path = find_git_bash()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| {
                    if is_command_in_path("bash") {
                        "bash.exe".into()
                    } else {
                        "powershell.exe".into()
                    }
                });
            let mut c = CommandBuilder::new(bash_path);
            c.args(["--login", "-i"]);
            c
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut c = CommandBuilder::new("bash");
            c.args(["-l"]);
            c
        }
    } else if let Some(distro) = shell.strip_prefix("wsl:") {
        let mut c = CommandBuilder::new("wsl.exe");
        c.args(["-d", distro]);
        c
    } else if shell == "wsl" || shell == "wsl.exe" {
        CommandBuilder::new("wsl.exe")
    } else if shell == "zsh" {
        #[cfg(not(target_os = "windows"))]
        {
            let mut c = CommandBuilder::new("zsh");
            c.args(["-l"]);
            c
        }
        #[cfg(target_os = "windows")]
        {
            CommandBuilder::new("zsh")
        }
    } else if shell == "fish" {
        #[cfg(not(target_os = "windows"))]
        {
            let mut c = CommandBuilder::new("fish");
            c.args(["-l"]);
            c
        }
        #[cfg(target_os = "windows")]
        {
            CommandBuilder::new("fish")
        }
    } else {
        let parts = parse_command_line(&shell);
        if parts.is_empty() {
            #[cfg(target_os = "windows")]
            {
                let mut c = CommandBuilder::new("powershell.exe");
                c.args(["-NoLogo"]);
                c
            }
            #[cfg(not(target_os = "windows"))]
            {
                let mut c = CommandBuilder::new("bash");
                c.args(["-l"]);
                c
            }
        } else {
            let mut c = CommandBuilder::new(&parts[0]);
            if parts.len() > 1 {
                c.args(&parts[1..]);
            }
            c
        }
    };

    cmd.env("TERM", "xterm-256color");
    if let Ok(cur_dir) = std::env::current_dir() {
        cmd.cwd(cur_dir);
    }

    let child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            crate::log_warn!("pty", "Failed to spawn shell '{}': {}. Falling back to default shell.", shell, e);
            #[cfg(target_os = "windows")]
            {
                let mut fallback_cmd = CommandBuilder::new("powershell.exe");
                fallback_cmd.args(["-NoLogo"]);
                fallback_cmd.env("TERM", "xterm-256color");
                if let Ok(cur_dir) = std::env::current_dir() {
                    fallback_cmd.cwd(cur_dir);
                }
                pair.slave.spawn_command(fallback_cmd).map_err(|e2| format!("Failed to spawn shell '{}': {} (fallback error: {})", shell, e, e2))?
            }
            #[cfg(not(target_os = "windows"))]
            {
                let mut fallback_cmd = CommandBuilder::new("sh");
                fallback_cmd.env("TERM", "xterm-256color");
                pair.slave.spawn_command(fallback_cmd).map_err(|e2| format!("Failed to spawn shell '{}': {} (fallback error: {})", shell, e, e2))?
            }
        }
    };
    // Essential for Windows ConPTY: drop slave side immediately to release handles
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    state.pty_sessions.lock().unwrap().insert(
        session_id.clone(),
        PtySession {
            backend: PtySessionBackend::Local {
                master: pair.master,
                writer,
                child,
            },
        },
    );

    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let s = String::from_utf8_lossy(&buf[..n]).to_string();
            if on_data.send(s).is_err() {
                break;
            }
        }
        let _ = on_data.send("\r\n\x1b[90m[Process completed]\x1b[0m\r\n".to_string());
    });

    Ok(())
}

#[tauri::command]
async fn pty_write(
    state: tauri::State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let tx_opt = {
        let guard = state.pty_sessions.lock().unwrap();
        guard.get(&session_id).and_then(|s| match &s.backend {
            PtySessionBackend::Ssh { write_tx, .. } | PtySessionBackend::Mosh { write_tx, .. } => Some(write_tx.clone()),
            PtySessionBackend::Local { .. } => None,
        })
    };

    if let Some(tx) = tx_opt {
        let _ = tx.send(data.into_bytes()).await;
        Ok(())
    } else {
        let mut sessions = state.pty_sessions.lock().unwrap();
        if let Some(sess) = sessions.get_mut(&session_id) {
            if let PtySessionBackend::Local { ref mut writer, .. } = sess.backend {
                writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
                writer.flush().map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

#[tauri::command]
async fn pty_resize(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let tx_opt = {
        let guard = state.pty_sessions.lock().unwrap();
        guard.get(&session_id).and_then(|s| match &s.backend {
            PtySessionBackend::Ssh { resize_tx, .. } | PtySessionBackend::Mosh { resize_tx, .. } => Some(resize_tx.clone()),
            PtySessionBackend::Local { .. } => None,
        })
    };

    if let Some(tx) = tx_opt {
        let _ = tx.send((cols, rows)).await;
        Ok(())
    } else {
        let mut sessions = state.pty_sessions.lock().unwrap();
        if let Some(sess) = sessions.get_mut(&session_id) {
            if let PtySessionBackend::Local { ref master, .. } = sess.backend {
                master
                    .resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    })
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
}

#[tauri::command]
fn pty_close(state: tauri::State<'_, AppState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock().unwrap();
    if let Some(mut sess) = sessions.remove(&session_id) {
        match &mut sess.backend {
            PtySessionBackend::Local { ref mut child, .. } => {
                let _ = child.kill();
            }
            PtySessionBackend::Ssh { shutdown_tx, .. } | PtySessionBackend::Mosh { shutdown_tx, .. } => {
                let _ = shutdown_tx.send(());
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn ssh_disconnect_host(state: tauri::State<'_, AppState>, host: HostConfig) -> Result<(), String> {
    crate::log_info!("ssh", "Explicitly disconnecting host '{}' and clearing from session pool", host.name);
    state.ssh_pool.remove_session(&host).await;
    Ok(())
}

// ── Portable Config Commands ──

pub fn load_or_init_config(path: &Path) -> AppConfig {
    crate::log_info!("config", "Loading configuration from {:?}", path);
    if path.exists() {
        match std::fs::read_to_string(path) {
            Ok(content) => match toml::from_str::<AppConfig>(&content) {
                Ok(cfg) => {
                    crate::log_info!(
                        "config",
                        "Successfully loaded config from {:?}: {} hosts, {} wireguard profiles, tailscale={}, netbird={}",
                        path,
                        cfg.hosts.len(),
                        cfg.wireguard_profiles.len(),
                        cfg.tailscale.is_some(),
                        cfg.netbird.is_some()
                    );
                    return cfg;
                }
                Err(err) => {
                    crate::log_error!(
                        "config",
                        "FAILED to parse config at {:?}: {}. Preserving file and returning default.",
                        path,
                        err
                    );
                    eprintln!("WARNING: Failed to parse config at {:?}: {}. Preserving existing file!", path, err);
                    return AppConfig::default();
                }
            },
            Err(e) => {
                crate::log_error!("config", "Failed to read config file at {:?}: {}", path, e);
            }
        }
    } else {
        crate::log_warn!("config", "Config file at {:?} does not exist. Initializing default.", path);
    }
    let default_cfg = AppConfig::default();
    if !path.exists() {
        if let Ok(serialized) = toml::to_string_pretty(&default_cfg) {
            let _ = std::fs::write(path, serialized);
            crate::log_info!("config", "Initialized new default config at {:?}", path);
        }
    }
    default_cfg
}

#[tauri::command]
fn get_config(state: tauri::State<'_, AppState>) -> AppConfig {
    load_or_init_config(&state.config_path)
}

#[tauri::command]
fn save_config(state: tauri::State<'_, AppState>, config: AppConfig) -> Result<(), String> {
    let serialized = toml::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&state.config_path, &serialized).map_err(|e| e.to_string())?;
    crate::log_info!("config", "Saved config to {:?}", state.config_path);

    // If running from target/debug or target/release during development, mirror to workspace root
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let workspace_cfg = if cwd.join("Cargo.toml").exists() {
        Some(cwd.join("config.toml"))
    } else if let Some(parent) = cwd.parent() {
        if parent.join("Cargo.toml").exists() {
            Some(parent.join("config.toml"))
        } else {
            None
        }
    } else {
        None
    };

    if let Some(ws_cfg) = workspace_cfg {
        if ws_cfg != state.config_path {
            let _ = std::fs::write(&ws_cfg, &serialized);
        }
    }
    Ok(())
}

pub fn cleanup_unused_icons(config_path: &Path, hosts: &[HostConfig]) {
    let base_dir = config_path.parent().unwrap_or(Path::new("."));
    let icons_dir = base_dir.join("ui").join("icons");

    let mut used_filenames = std::collections::HashSet::new();
    for h in hosts {
        let clean = h.icon.trim();
        if clean.starts_with("icons/") || clean.ends_with(".svg") {
            let filename = Path::new(clean)
                .file_name()
                .and_then(|f| f.to_str())
                .unwrap_or("")
                .to_string();
            if !filename.is_empty() {
                used_filenames.insert(filename);
            }
        } else if !clean.is_empty() && !clean.starts_with("&#") && clean.len() > 1 {
            used_filenames.insert(format!("{}.svg", clean));
        }
    }

    let mut dirs_to_clean = Vec::new();
    if icons_dir.exists() && icons_dir.is_dir() {
        dirs_to_clean.push(icons_dir);
    }
    let workspace_icons = PathBuf::from("ui").join("icons");
    if workspace_icons.exists() && workspace_icons.is_dir() {
        dirs_to_clean.push(workspace_icons);
    }

    for dir in dirs_to_clean {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("svg") {
                    if let Some(file_name) = path.file_name().and_then(|f| f.to_str()) {
                        if !used_filenames.contains(file_name) {
                            let _ = std::fs::remove_file(&path);
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn save_host_icon(
    state: tauri::State<'_, AppState>,
    name: String,
    svg_content: String,
) -> Result<String, String> {
    let base_dir = state.config_path.parent().unwrap_or(Path::new("."));
    let icons_dir = base_dir.join("ui").join("icons");
    if !icons_dir.exists() {
        let _ = std::fs::create_dir_all(&icons_dir);
    }

    let clean_name: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let file_name = format!("{}.svg", clean_name);
    let target_path = icons_dir.join(&file_name);
    let _ = std::fs::write(&target_path, &svg_content);

    // Also write to workspace ui/icons if running from target/debug
    let workspace_icons = PathBuf::from("ui").join("icons");
    if workspace_icons.exists() || PathBuf::from("ui").exists() {
        let _ = std::fs::create_dir_all(&workspace_icons);
        let _ = std::fs::write(workspace_icons.join(&file_name), &svg_content);
    }

    Ok(format!("icons/{}", file_name))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalThemeItem {
    pub id: String,
    pub name: String,
    pub is_custom: bool,
    pub theme: serde_json::Value,
}

#[tauri::command]
fn save_terminal_theme(
    state: tauri::State<'_, AppState>,
    name: String,
    theme_json: String,
) -> Result<String, String> {
    let base_dir = state.config_path.parent().unwrap_or(Path::new("."));
    let themes_dir = if base_dir.join("themes").exists() {
        base_dir.join("themes")
    } else if base_dir.join("ui").join("themes").exists() {
        base_dir.join("ui").join("themes")
    } else {
        base_dir.join("themes")
    };
    if !themes_dir.exists() {
        let _ = std::fs::create_dir_all(&themes_dir);
    }

    let clean_name: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c.to_ascii_lowercase() } else { '_' })
        .collect();
    let file_name = format!("{}.json", clean_name);
    let target_path = themes_dir.join(&file_name);
    let _ = std::fs::write(&target_path, &theme_json).map_err(|e| e.to_string())?;

    // Also write to workspace ui/themes if running from target/debug
    let workspace_themes = PathBuf::from("ui").join("themes");
    if workspace_themes.exists() || PathBuf::from("ui").exists() {
        let _ = std::fs::create_dir_all(&workspace_themes);
        let _ = std::fs::write(workspace_themes.join(&file_name), &theme_json);
    }

    // Also check parent/ui/themes if in subfolder
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(parent) = cwd.parent() {
            let parent_themes = parent.join("ui").join("themes");
            if parent_themes.exists() {
                let _ = std::fs::write(parent_themes.join(&file_name), &theme_json);
            }
        }
    }

    crate::log_info!("config", "Saved terminal theme file {:?} for '{}'", target_path, name);
    Ok(clean_name)
}

#[tauri::command]
fn load_all_terminal_themes(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TerminalThemeItem>, String> {
    let mut search_dirs = Vec::new();

    // 1. Config adjacent themes
    let base_dir = state.config_path.parent().unwrap_or(Path::new("."));
    search_dirs.push(base_dir.join("themes"));
    search_dirs.push(base_dir.join("ui").join("themes"));

    // 2. Workspace ui/themes
    search_dirs.push(PathBuf::from("ui").join("themes"));

    // 3. Parent ui/themes
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(p) = cwd.parent() {
            search_dirs.push(p.join("ui").join("themes"));
        }
    }

    let mut map: std::collections::HashMap<String, TerminalThemeItem> = std::collections::HashMap::new();

    for dir in search_dirs {
        if dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("json") {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            let id = stem.to_string();
                            if !map.contains_key(&id) {
                                if let Ok(content) = std::fs::read_to_string(&path) {
                                    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&content) {
                                        let name = json_val.get("name")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or(stem)
                                            .to_string();
                                        let is_custom = id.starts_with("custom_");
                                        map.insert(id.clone(), TerminalThemeItem {
                                            id,
                                            name,
                                            is_custom,
                                            theme: json_val,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result: Vec<TerminalThemeItem> = map.into_values().collect();
    let defaults_order = [
        "one_dark", "tokyo_night", "dracula", "catppuccin", "nord",
        "monokai_pro", "solarized_dark", "gruvbox_dark", "synthwave", "alacritty_dark"
    ];
    result.sort_by(|a, b| {
        let pos_a = defaults_order.iter().position(|&x| x == a.id);
        let pos_b = defaults_order.iter().position(|&x| x == b.id);
        match (pos_a, pos_b) {
            (Some(ia), Some(ib)) => ia.cmp(&ib),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(result)
}

#[tauri::command]
fn add_host(state: tauri::State<'_, AppState>, host: HostConfig) -> Result<AppConfig, String> {
    if host.auth_type == "key" {
        if let Some(ref kp) = host.key_path {
            let _ = fix_ssh_key_permissions(kp.clone());
        }
    }
    let mut cfg = load_or_init_config(&state.config_path);
    cfg.hosts.retain(|h| h.id != host.id);
    cfg.hosts.push(host);
    let serialized = toml::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.config_path, serialized).map_err(|e| e.to_string())?;
    cleanup_unused_icons(&state.config_path, &cfg.hosts);
    Ok(cfg)
}

#[tauri::command]
fn delete_host(state: tauri::State<'_, AppState>, id: String) -> Result<AppConfig, String> {
    let mut cfg = load_or_init_config(&state.config_path);
    cfg.hosts.retain(|h| h.id != id);
    let serialized = toml::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.config_path, serialized).map_err(|e| e.to_string())?;
    cleanup_unused_icons(&state.config_path, &cfg.hosts);
    Ok(cfg)
}

#[tauri::command]
fn save_snippet(state: tauri::State<'_, AppState>, snippet: SnippetItem) -> Result<AppConfig, String> {
    let mut cfg = load_or_init_config(&state.config_path);
    cfg.snippets.retain(|s| s.id != snippet.id);
    cfg.snippets.push(snippet);
    let serialized = toml::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.config_path, serialized).map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[tauri::command]
fn delete_snippet(state: tauri::State<'_, AppState>, id: String) -> Result<AppConfig, String> {
    let mut cfg = load_or_init_config(&state.config_path);
    cfg.snippets.retain(|s| s.id != id);
    let serialized = toml::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.config_path, serialized).map_err(|e| e.to_string())?;
    Ok(cfg)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HostPingRequest {
    pub id: String,
    pub host: String,
    pub port: u16,
}

#[tauri::command]
async fn check_hosts_alive(hosts: Vec<HostPingRequest>) -> HashMap<String, bool> {
    use std::net::SocketAddr;
    use std::time::Duration;
    use tokio::net::TcpStream;

    let mut results = HashMap::new();
    if hosts.is_empty() {
        return results;
    }

    let mut tasks = Vec::new();
    for h in hosts {
        tasks.push(tokio::spawn(async move {
            let target_port = if h.port == 0 { 22 } else { h.port };
            let addr_str = format!("{}:{}", h.host, target_port);
            let alive = if let Ok(sock) = addr_str.parse::<SocketAddr>() {
                tokio::time::timeout(Duration::from_millis(800), TcpStream::connect(sock))
                    .await
                    .map(|r| r.is_ok())
                    .unwrap_or(false)
            } else {
                tokio::time::timeout(Duration::from_millis(800), tokio::net::lookup_host(&addr_str))
                    .await
                    .ok()
                    .and_then(|r| r.ok())
                    .and_then(|mut addrs| addrs.next())
                    .map(|sock| {
                        std::net::TcpStream::connect_timeout(&sock, Duration::from_millis(800)).is_ok()
                    })
                    .unwrap_or(false)
            };
            (h.id, alive)
        }));
    }

    for task in tasks {
        if let Ok((id, alive)) = task.await {
            results.insert(id, alive);
        }
    }
    results
}

// ── Telemetry & Real File Browser ──

#[tauri::command]
async fn get_remote_telemetry(state: tauri::State<'_, AppState>, host: HostConfig) -> Result<TelemetryData, String> {
    let handle = state.get_russh_session(&host).await?;
    let output = match tokio::time::timeout(
        std::time::Duration::from_secs(4),
        crate::ssh::client::exec_command(&handle, "cat /proc/stat /proc/meminfo /proc/net/dev 2>/dev/null"),
    )
    .await
    {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Telemetry query timed out (4s)".into()),
    };

    let out_str = output;
    if out_str.trim().is_empty() {
        return Ok(TelemetryData {
            cpu: 0.0,
            ram: 0.0,
            net_rx: 0,
            net_tx: 0,
            ping_ms: None,
        });
    }

    // In-process Rust parser for Linux procfs
    let mut cpu = 0.0;
    let mut mem_total: f32 = 0.0;
    let mut mem_avail: f32 = 0.0;
    let mut net_rx: u64 = 0;
    let mut net_tx: u64 = 0;

    for line in out_str.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("cpu ") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 5 {
                let user: f32 = parts[1].parse().unwrap_or(0.0);
                let nice: f32 = parts[2].parse().unwrap_or(0.0);
                let system: f32 = parts[3].parse().unwrap_or(0.0);
                let idle: f32 = parts[4].parse().unwrap_or(0.0);
                let total = user + nice + system + idle;
                if total > 0.0 {
                    cpu = ((user + system) * 100.0) / total;
                }
            }
        } else if trimmed.starts_with("MemTotal:") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 2 {
                mem_total = parts[1].parse().unwrap_or(0.0);
            }
        } else if trimmed.starts_with("MemAvailable:") {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 2 {
                mem_avail = parts[1].parse().unwrap_or(0.0);
            }
        } else if trimmed.contains(':') && !trimmed.starts_with("lo:") && !trimmed.starts_with("Inter-") && !trimmed.starts_with("face") {
            if let Some((_, stats)) = trimmed.split_once(':') {
                let num_parts: Vec<&str> = stats.split_whitespace().collect();
                if num_parts.len() >= 9 {
                    net_rx += num_parts[0].parse::<u64>().unwrap_or(0);
                    net_tx += num_parts[8].parse::<u64>().unwrap_or(0);
                }
            }
        }
    }

    let ram = if mem_total > 0.0 {
        ((mem_total - mem_avail) * 100.0) / mem_total
    } else {
        0.0
    };

    let ping_ms = {
        use std::net::{TcpStream, ToSocketAddrs};
        let target_port = if host.port == 0 { 22 } else { host.port };
        let addr_str = format!("{}:{}", host.host, target_port);
        let start = std::time::Instant::now();
        if let Ok(sock) = addr_str.parse::<std::net::SocketAddr>() {
            if TcpStream::connect_timeout(&sock, std::time::Duration::from_millis(800)).is_ok() {
                Some(start.elapsed().as_millis() as u32)
            } else {
                None
            }
        } else if let Ok(mut addrs) = addr_str.to_socket_addrs() {
            if let Some(addr) = addrs.next() {
                if TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(800)).is_ok() {
                    Some(start.elapsed().as_millis() as u32)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    Ok(TelemetryData {
        cpu,
        ram,
        net_rx,
        net_tx,
        ping_ms,
    })
}

#[cfg(target_os = "windows")]
pub fn normalize_local_path(trimmed: &str) -> String {
    let norm = trimmed.replace('/', "\\");
    // 1. Direct WSL DrvFs mount: \mnt\c\... or /mnt/c/... or \\wsl.localhost\<distro>\mnt\c\...
    let mnt_stripped = if norm.starts_with("\\mnt\\") {
        Some(&norm[5..])
    } else if norm.eq_ignore_ascii_case("\\mnt") {
        None
    } else if let Some(idx) = norm.find("\\mnt\\") {
        let prefix = &norm[..idx];
        if prefix.starts_with("\\\\wsl.localhost\\") || prefix.starts_with("\\\\wsl$\\") {
            Some(&norm[idx + 5..])
        } else {
            None
        }
    } else {
        None
    };

    if let Some(rest) = mnt_stripped {
        let bytes = rest.as_bytes();
        if !bytes.is_empty() && bytes[0].is_ascii_alphabetic() && (bytes.len() == 1 || bytes[1] == b'\\') {
            let drive = (bytes[0] as char).to_ascii_uppercase();
            let sub = if bytes.len() > 2 { &rest[2..] } else { "" };
            return format!("{}:\\{}", drive, sub);
        }
    }

    // 2. Git Bash / MSYS2 style path "/c/Users/..."
    let bytes = trimmed.as_bytes();
    if bytes.len() >= 2 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && (bytes.len() == 2 || bytes[2] == b'/') {
        let drive = (bytes[1] as char).to_ascii_uppercase();
        let rest = if bytes.len() > 3 { &trimmed[3..] } else { "" };
        return format!("{}:\\{}", drive, rest.replace('/', "\\"));
    }

    trimmed.to_string()
}

#[cfg(not(target_os = "windows"))]
pub fn normalize_local_path(trimmed: &str) -> String {
    trimmed.to_string()
}

#[tauri::command]
fn list_local_files(dir_path: Option<String>) -> Result<Vec<RealFileItem>, String> {
    let raw = dir_path.unwrap_or_default();
    let trimmed = raw.trim();

    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."));

    let clean_trimmed = normalize_local_path(trimmed);

    // 1. Resolve ~, ~/, ~\, or empty / relative
    let mut candidate: PathBuf = if clean_trimmed.is_empty() || clean_trimmed == "." {
        std::env::current_dir().unwrap_or_else(|_| home_dir.clone())
    } else if clean_trimmed == "~" {
        home_dir.clone()
    } else if clean_trimmed.starts_with("~/") || clean_trimmed.starts_with("~\\") {
        home_dir.join(&clean_trimmed[2..])
    } else {
        PathBuf::from(&clean_trimmed)
    };

    // 2. If candidate doesn't exist, check for accidental git branch suffix (e.g. "path [main]" or "path (main)")
    if !candidate.exists() {
        let str_val = candidate.to_string_lossy().to_string();
        if let Some(pos) = str_val.rfind(" [").or_else(|| str_val.rfind(" (")) {
            let stripped = PathBuf::from(&str_val[..pos]);
            if stripped.exists() {
                candidate = stripped;
            }
        }
    }

    // 3. If candidate points to a file (e.g. ConPTY window title like "bash.exe"), resolve to its parent directory
    if candidate.is_file() {
        candidate = candidate.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| home_dir.clone());
    }

    let target_dir = if candidate.is_dir() {
        candidate
    } else {
        // Fallback: check if relative to current working directory
        if let Ok(cur) = std::env::current_dir() {
            let joined = cur.join(&candidate);
            if joined.is_dir() {
                joined
            } else if joined.is_file() {
                joined.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| home_dir.clone())
            } else {
                crate::log_warn!("files", "Local directory '{}' does not exist; falling back to home dir '{}'", trimmed, home_dir.display());
                home_dir.clone()
            }
        } else {
            crate::log_warn!("files", "Local directory '{}' does not exist; falling back to home dir '{}'", trimmed, home_dir.display());
            home_dir.clone()
        }
    };

    let entries = match std::fs::read_dir(&target_dir) {
        Ok(e) => e,
        Err(err) => {
            crate::log_error!("files", "Failed to read local directory '{}': {}", target_dir.display(), err);
            return Err(format!("Cannot read directory '{}': {}", target_dir.display(), err));
        }
    };

    let mut files = Vec::new();

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let is_db = name.ends_with(".db") || name.ends_with(".sqlite") || name.ends_with(".sqlite3");

        let size = if is_dir {
            "DIR".to_string()
        } else if let Some(m) = &meta {
            let bytes = m.len();
            if bytes < 1024 {
                format!("{} B", bytes)
            } else if bytes < 1024 * 1024 {
                format!("{:.1} KB", bytes as f32 / 1024.0)
            } else {
                format!("{:.1} MB", bytes as f32 / (1024.0 * 1024.0))
            }
        } else {
            "-".to_string()
        };

        let modified = if let Some(m) = &meta {
            if let Ok(time) = m.modified() {
                let dt: chrono::DateTime<Local> = time.into();
                dt.format("%d/%m/%Y %H:%M").to_string()
            } else {
                "-".to_string()
            }
        } else {
            "-".to_string()
        };

        files.push(RealFileItem {
            name,
            path,
            size,
            modified,
            is_dir,
            is_db,
        });
    }

    files.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(files)
}

#[tauri::command]
async fn cache_remote_db(state: tauri::State<'_, AppState>, host: HostConfig, remote_path: String) -> Result<String, String> {
    let sftp = state.get_sftp_session(&host).await?;
    let resolved_remote = crate::ssh::sftp::resolve_sftp_path(&sftp, &remote_path).await;

    let file_name = std::path::Path::new(&resolved_remote)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("remote.db");

    let temp_cache_dir = std::env::temp_dir().join("taris_db_cache");
    let _ = std::fs::create_dir_all(&temp_cache_dir);
    let local_path = temp_cache_dir.join(format!("{}_{}", host.id, file_name));

    let mut remote_file = sftp
        .open(&resolved_remote)
        .await
        .map_err(|e| format!("SFTP open failed for '{}': {}", resolved_remote, e))?;

    let mut local_file = tokio::fs::File::create(&local_path)
        .await
        .map_err(|e| format!("Failed to create local cache file: {}", e))?;

    tokio::io::copy(&mut remote_file, &mut local_file)
        .await
        .map_err(|e| format!("Failed to copy DB over SFTP: {}", e))?;

    Ok(local_path.to_string_lossy().to_string())
}

#[tauri::command]
fn sqlite_get_tables(path: String) -> Result<Vec<TableSummary>, String> {
    let conn = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").map_err(|e| e.to_string())?;
    let table_names: Vec<String> = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut result = Vec::new();
    for name in table_names {
        let count_query = format!("SELECT COUNT(*) FROM \"{}\"", name.replace('"', "\"\""));
        let count: i64 = conn.query_row(&count_query, [], |r| r.get(0)).unwrap_or(0);
        result.push(TableSummary { name, count });
    }
    Ok(result)
}

#[tauri::command]
fn sqlite_query(path: String, query: String) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();
    let conn = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let columns: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();
    let col_count = columns.len();

    let mut rows_data = Vec::new();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;

    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut row_vals = Vec::with_capacity(col_count);
        for i in 0..col_count {
            let val = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                Ok(rusqlite::types::ValueRef::Integer(n)) => serde_json::Value::Number(serde_json::Number::from(n)),
                Ok(rusqlite::types::ValueRef::Real(f)) => serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null),
                Ok(rusqlite::types::ValueRef::Text(s)) => serde_json::Value::String(String::from_utf8_lossy(s).to_string()),
                Ok(rusqlite::types::ValueRef::Blob(b)) => serde_json::Value::String(format!("<Blob {} B>", b.len())),
                Err(_) => serde_json::Value::Null,
            };
            row_vals.push(val);
        }
        rows_data.push(row_vals);
        if rows_data.len() >= 500 {
            break;
        }
    }

    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
    let row_count = rows_data.len();

    Ok(QueryResult {
        columns,
        rows: rows_data,
        row_count,
        duration_ms: (elapsed * 10.0).round() / 10.0,
    })
}

// ── Window Controls ──

#[tauri::command]
fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn window_maximize(window: tauri::Window) -> Result<bool, String> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn read_local_file(path: String) -> Result<String, String> {
    let clean = normalize_local_path(&path);
    std::fs::read_to_string(&clean).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_local_file(path: String, content: String) -> Result<(), String> {
    let clean = normalize_local_path(&path);
    std::fs::write(&clean, content).map_err(|e| e.to_string())
}




// ── 4.6 Native Clipboard & Multi-Threaded Transfers ──

#[cfg(windows)]
pub mod clipboard_utils {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::ffi::OsStringExt;

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hWndNewOwner: *mut std::ffi::c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn GetClipboardData(uFormat: u32) -> *mut std::ffi::c_void;
        fn SetClipboardData(uFormat: u32, hMem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn IsClipboardFormatAvailable(format: u32) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(uFlags: u32, dwBytes: usize) -> *mut std::ffi::c_void;
        fn GlobalLock(hMem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn GlobalUnlock(hMem: *mut std::ffi::c_void) -> i32;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn DragQueryFileW(hDrop: *mut std::ffi::c_void, iFile: u32, lpszFile: *mut u16, cch: u32) -> u32;
    }

    const CF_HDROP: u32 = 15;
    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;

    pub fn get_text() -> Result<String, String> {
        unsafe {
            if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
                return Ok(String::new());
            }
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err("Failed to open Windows clipboard".to_string());
            }
            let h_mem = GetClipboardData(CF_UNICODETEXT);
            if h_mem.is_null() {
                CloseClipboard();
                return Ok(String::new());
            }
            let ptr = GlobalLock(h_mem) as *const u16;
            if ptr.is_null() {
                CloseClipboard();
                return Ok(String::new());
            }
            let mut len = 0;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(ptr, len);
            let s = String::from_utf16_lossy(slice);
            GlobalUnlock(h_mem);
            CloseClipboard();
            Ok(s)
        }
    }

    pub fn set_text(text: &str) -> Result<(), String> {
        unsafe {
            let wide: Vec<u16> = std::ffi::OsStr::new(text)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let bytes = wide.len() * 2;
            let h_mem = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if h_mem.is_null() {
                return Err("Failed to allocate global memory".to_string());
            }
            let ptr = GlobalLock(h_mem) as *mut u16;
            if ptr.is_null() {
                return Err("Failed to lock global memory".to_string());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
            GlobalUnlock(h_mem);

            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err("Failed to open Windows clipboard".to_string());
            }
            EmptyClipboard();
            if SetClipboardData(CF_UNICODETEXT, h_mem).is_null() {
                CloseClipboard();
                return Err("Failed to set clipboard data".to_string());
            }
            CloseClipboard();
            Ok(())
        }
    }

    pub fn get_files() -> Result<Vec<String>, String> {
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP) == 0 {
                return Ok(vec![]);
            }
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err("Failed to open Windows clipboard".to_string());
            }

            let h_drop = GetClipboardData(CF_HDROP);
            if h_drop.is_null() {
                CloseClipboard();
                return Ok(vec![]);
            }

            let file_count = DragQueryFileW(h_drop, 0xFFFFFFFF, std::ptr::null_mut(), 0);
            let mut files = Vec::new();

            for i in 0..file_count {
                let len = DragQueryFileW(h_drop, i, std::ptr::null_mut(), 0);
                if len > 0 {
                    let mut buffer: Vec<u16> = vec![0; (len + 1) as usize];
                    DragQueryFileW(h_drop, i, buffer.as_mut_ptr(), len + 1);
                    buffer.truncate(len as usize);
                    let os_str = OsString::from_wide(&buffer);
                    if let Ok(s) = os_str.into_string() {
                        files.push(s);
                    }
                }
            }

            CloseClipboard();
            Ok(files)
        }
    }
}

#[cfg(not(windows))]
pub mod clipboard_utils {
    pub fn get_files() -> Result<Vec<String>, String> {
        Ok(vec![])
    }
    pub fn get_text() -> Result<String, String> {
        Ok(String::new())
    }
    pub fn set_text(_text: &str) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
fn get_clipboard_text() -> Result<String, String> {
    clipboard_utils::get_text()
}

#[tauri::command]
fn write_clipboard_text(text: String) -> Result<(), String> {
    clipboard_utils::set_text(&text)
}

#[tauri::command]
fn get_clipboard_files() -> Result<Vec<String>, String> {
    clipboard_utils::get_files()
}

#[tauri::command]
fn copy_local_files(source_paths: Vec<String>, dest_dir: String) -> Result<Vec<String>, String> {
    let dest = Path::new(&dest_dir);
    if !dest.exists() {
        std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    }
    let mut copied = Vec::new();
    for src_str in source_paths {
        let src = Path::new(&src_str);
        if let Some(file_name) = src.file_name() {
            let target = dest.join(file_name);
            if src.is_file() {
                std::fs::copy(src, &target).map_err(|e| e.to_string())?;
                copied.push(target.to_string_lossy().to_string());
            }
        }
    }
    Ok(copied)
}

pub fn delete_local_file_path(path: &str) -> Result<(), String> {
    let clean = normalize_local_path(path);
    let p = Path::new(&clean);
    if !p.exists() {
        return Err(format!("Local path '{}' does not exist", clean));
    }
    let trimmed = clean.trim().replace('\\', "/");
    if trimmed == "/" || trimmed.is_empty() || (trimmed.len() <= 3 && trimmed.contains(':')) {
        return Err("Refusing to delete root drive directory".to_string());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| format!("Failed to delete directory: {}", e))?;
    } else {
        std::fs::remove_file(p).map_err(|e| format!("Failed to delete file: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn delete_local_file(path: String) -> Result<(), String> {
    delete_local_file_path(&path)
}

fn is_ignorable_tunnel_disconnect(err_str: &str) -> bool {
    let lower = err_str.to_lowercase();
    lower.contains("10054")
        || lower.contains("10053")
        || lower.contains("forcibly closed")
        || lower.contains("connection reset")
        || lower.contains("connection aborted")
        || lower.contains("broken pipe")
        || lower.contains("unexpected eof")
        || lower.contains("channel closed")
}

async fn bridge_tunnel_client_async(
    mut client_stream: tokio::net::TcpStream,
    config_path: &std::path::Path,
    mesh: &mesh::MeshState,
    host: &HostConfig,
    remote_host: &str,
    remote_port: u16,
    bytes_rx: Arc<std::sync::atomic::AtomicU64>,
    bytes_tx: Arc<std::sync::atomic::AtomicU64>,
) -> Result<(), String> {
    let is_mesh = host.network_route.as_deref() == Some("mesh")
        || (host.network_route.is_some() && host.network_route.as_deref() != Some("direct"));

    let handle = if is_mesh {
        let ep = mesh::resolve_mesh_endpoint_sync(config_path, mesh, host, None)?;
        crate::ssh::session::open_russh_session_with_target(host, &ep.host, ep.port).await?
    } else {
        let port = if host.port == 0 { 22 } else { host.port };
        crate::ssh::session::open_russh_session_with_target(host, &host.host, port).await?
    };

    let is_direct_host = remote_host.trim().is_empty()
        || remote_host == "127.0.0.1"
        || remote_host == "localhost"
        || remote_host == host.host;

    let primary_target = if is_direct_host { "127.0.0.1" } else { remote_host };

    let channel = handle
        .channel_open_direct_tcpip(primary_target, remote_port as u32, "127.0.0.1", 12345)
        .await
        .map_err(|e| format!("channel_open_direct_tcpip failed for {}:{}: {}", primary_target, remote_port, e))?;

    crate::log_info!("tunnel", "Port forward established to {}:{} via {}", primary_target, remote_port, host.name);

    let mut channel_stream = channel.into_stream();

    let (copied_tx, copied_rx) = match tokio::io::copy_bidirectional(&mut client_stream, &mut channel_stream).await {
        Ok((tx, rx)) => (tx, rx),
        Err(e) => {
            let _ = handle.disconnect(russh::Disconnect::ByApplication, "Tunnel closed", "en").await;
            let err_msg = format!("Tunnel stream error: {}", e);
            if is_ignorable_tunnel_disconnect(&err_msg) {
                return Ok(());
            }
            return Err(err_msg);
        }
    };

    let _ = handle.disconnect(russh::Disconnect::ByApplication, "Tunnel closed", "en").await;

    bytes_tx.fetch_add(copied_tx, std::sync::atomic::Ordering::Relaxed);
    bytes_rx.fetch_add(copied_rx, std::sync::atomic::Ordering::Relaxed);

    Ok(())
}

#[tauri::command]
fn get_tunnels_status(state: tauri::State<'_, AppState>) -> Result<Vec<TunnelStatus>, String> {
    let cfg = load_or_init_config(&state.config_path);
    let active = state.active_tunnels.lock().unwrap();
    let mut out = Vec::new();
    for t in cfg.tunnels {
        let host_name = cfg.hosts.iter().find(|h| h.id == t.host_id)
            .map(|h| h.name.clone())
            .unwrap_or_else(|| "Unknown Host".to_string());
        if let Some(act) = active.get(&t.id) {
            out.push(TunnelStatus {
                id: t.id.clone(),
                name: t.name.clone(),
                host_id: t.host_id.clone(),
                host_name,
                local_port: t.local_port,
                remote_host: t.remote_host.clone(),
                remote_port: t.remote_port,
                is_active: true,
                bytes_rx: act.bytes_rx.load(std::sync::atomic::Ordering::Relaxed),
                bytes_tx: act.bytes_tx.load(std::sync::atomic::Ordering::Relaxed),
                active_connections: act.active_connections.load(std::sync::atomic::Ordering::Relaxed),
                error: act.error.lock().unwrap().clone(),
            });
        } else {
            out.push(TunnelStatus {
                id: t.id.clone(),
                name: t.name.clone(),
                host_id: t.host_id.clone(),
                host_name,
                local_port: t.local_port,
                remote_host: t.remote_host.clone(),
                remote_port: t.remote_port,
                is_active: false,
                bytes_rx: 0,
                bytes_tx: 0,
                active_connections: 0,
                error: None,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
fn save_tunnel(state: tauri::State<'_, AppState>, tunnel: TunnelConfig) -> Result<(), String> {
    let mut cfg = load_or_init_config(&state.config_path);
    if let Some(idx) = cfg.tunnels.iter().position(|t| t.id == tunnel.id) {
        cfg.tunnels[idx] = tunnel;
    } else {
        cfg.tunnels.push(tunnel);
    }
    let serialized = toml::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.config_path, serialized).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_tunnel(state: tauri::State<'_, AppState>, tunnel_id: String) -> Result<(), String> {
    if let Ok(mut active) = state.active_tunnels.lock() {
        if let Some(act) = active.remove(&tunnel_id) {
            let _ = act.shutdown_tx.send(());
            crate::log_info!("tunnel", "Tunnel '{}' stopped upon deletion", tunnel_id);
        }
    }
    let mut cfg = load_or_init_config(&state.config_path);
    cfg.tunnels.retain(|t| t.id != tunnel_id);
    let serialized = toml::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.config_path, serialized).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn toggle_tunnel(state: tauri::State<'_, AppState>, tunnel_id: String, active: bool) -> Result<bool, String> {
    if !active {
        if let Ok(mut active_map) = state.active_tunnels.lock() {
            if let Some(act) = active_map.remove(&tunnel_id) {
                let _ = act.shutdown_tx.send(());
                crate::log_info!("tunnel", "Tunnel '{}' disabled and connections terminated", tunnel_id);
            }
        }
        return Ok(false);
    }

    {
        let active_map = state.active_tunnels.lock().unwrap();
        if active_map.contains_key(&tunnel_id) {
            return Ok(true);
        }
    }

    let cfg = load_or_init_config(&state.config_path);
    let tunnel = cfg.tunnels.iter().find(|t| t.id == tunnel_id)
        .ok_or_else(|| format!("Tunnel '{}' not found in configuration", tunnel_id))?
        .clone();
    let host = cfg.hosts.iter().find(|h| h.id == tunnel.host_id)
        .ok_or_else(|| format!("Host '{}' not found for tunnel", tunnel.host_id))?
        .clone();

    let bind_addr = format!("127.0.0.1:{}", tunnel.local_port);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await
        .map_err(|e| format!("Cannot bind {}: {}", bind_addr, e))?;

    let (shutdown_tx, mut shutdown_rx) = tokio::sync::broadcast::channel::<()>(4);
    let bytes_rx = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let bytes_tx = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let active_connections = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let error = Arc::new(Mutex::new(None));

    let act = ActiveTunnel {
        config: tunnel.clone(),
        shutdown_tx: shutdown_tx.clone(),
        bytes_rx: Arc::clone(&bytes_rx),
        bytes_tx: Arc::clone(&bytes_tx),
        active_connections: Arc::clone(&active_connections),
        error: Arc::clone(&error),
    };

    state.active_tunnels.lock().unwrap().insert(tunnel_id.clone(), act);

    let remote_host = tunnel.remote_host.clone();
    let remote_port = tunnel.remote_port;
    let cfg_path = state.config_path.clone();
    let mesh_state = state.mesh.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    break;
                }
                res = listener.accept() => {
                    match res {
                        Ok((client_stream, _peer_addr)) => {
                            let host_c = host.clone();
                            let r_host = remote_host.clone();
                            let r_port = remote_port;
                            let b_rx = Arc::clone(&bytes_rx);
                            let b_tx = Arc::clone(&bytes_tx);
                            let conn_count = Arc::clone(&active_connections);
                            let c_path = cfg_path.clone();
                            let m_state = mesh_state.clone();
                            let mut conn_shutdown = shutdown_tx.subscribe();

                            tokio::spawn(async move {
                                conn_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                tokio::select! {
                                    _ = conn_shutdown.recv() => {
                                        // Tunnel disabled by user -> abort bridged stream cleanly
                                    }
                                    res = bridge_tunnel_client_async(client_stream, &c_path, &m_state, &host_c, &r_host, r_port, b_rx, b_tx) => {
                                        if let Err(e) = res {
                                            if !is_ignorable_tunnel_disconnect(&e) {
                                                crate::log_error!("tunnel", "Tunnel forward error for {} ({}:{}): {}", host_c.name, r_host, r_port, e);
                                            }
                                        }
                                    }
                                }
                                conn_count.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                            });
                        }
                        Err(_) => break,
                    }
                }
            }
        }
    });

    Ok(true)
}

#[tauri::command]
fn send_wol_packet(mac: String, broadcast_ip: Option<String>) -> Result<(), String> {
    let clean: String = mac.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if clean.len() != 12 {
        return Err("Invalid MAC address: must contain 12 hex digits (e.g. 00:11:22:33:44:55)".to_string());
    }
    let mut mac_bytes = [0u8; 6];
    for i in 0..6 {
        mac_bytes[i] = u8::from_str_radix(&clean[i * 2..i * 2 + 2], 16)
            .map_err(|e| format!("Invalid hex in MAC: {}", e))?;
    }
    let mut packet = [0xffu8; 102];
    for i in 0..16 {
        packet[6 + i * 6..6 + (i + 1) * 6].copy_from_slice(&mac_bytes);
    }
    let target = format!("{}:9", broadcast_ip.as_deref().unwrap_or("255.255.255.255"));
    let socket = std::net::UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("UDP bind failed: {}", e))?;
    socket.set_broadcast(true)
        .map_err(|e| format!("Set broadcast failed: {}", e))?;
    socket.send_to(&packet, &target)
        .map_err(|e| format!("Failed to send WoL packet: {}", e))?;
    Ok(())
}

#[tauri::command]
fn launch_url_in_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
fn get_mcp_status(state: tauri::State<'_, AppState>) -> mcp::McpStatus {
    let handle_lock = state.mcp_handle.lock().unwrap();
    if let Some(ref handle) = *handle_lock {
        mcp::McpStatus {
            active: true,
            port: handle.port,
            url: format!("http://127.0.0.1:{}/mcp", handle.port),
        }
    } else {
        let cfg = load_or_init_config(&state.config_path);
        mcp::McpStatus {
            active: false,
            port: cfg.settings.mcp_server_port,
            url: format!("http://127.0.0.1:{}/mcp", cfg.settings.mcp_server_port),
        }
    }
}

#[tauri::command]
async fn toggle_mcp_server(
    state: tauri::State<'_, AppState>,
    enabled: bool,
    port: Option<u16>,
) -> Result<mcp::McpStatus, String> {
    let target_port = port.unwrap_or_else(|| {
        let cfg = load_or_init_config(&state.config_path);
        cfg.settings.mcp_server_port
    });

    let mut handle_lock = state.mcp_handle.lock().unwrap();

    // Persist to config.toml
    let mut cfg = load_or_init_config(&state.config_path);
    cfg.settings.enable_mcp_server = enabled;
    cfg.settings.mcp_server_port = target_port;
    let serialized = toml::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    let _ = std::fs::write(&state.config_path, &serialized);

    // Mirror to workspace root if present in dev
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let workspace_cfg = if cwd.join("Cargo.toml").exists() {
        Some(cwd.join("config.toml"))
    } else if let Some(parent) = cwd.parent() {
        if parent.join("Cargo.toml").exists() {
            Some(parent.join("config.toml"))
        } else {
            None
        }
    } else {
        None
    };
    if let Some(ws_path) = workspace_cfg {
        let _ = std::fs::write(ws_path, &serialized);
    }

    if enabled {
        if let Some(ref h) = *handle_lock {
            if h.port == target_port {
                return Ok(mcp::McpStatus {
                    active: true,
                    port: target_port,
                    url: format!("http://127.0.0.1:{}/mcp", target_port),
                });
            }
            let _ = h.shutdown_tx.send(());
        }

        let (shutdown_tx, shutdown_rx) = tokio::sync::broadcast::channel(1);
        let state_clone = state.inner().clone();
        tokio::spawn(async move {
            if let Err(e) = mcp::start_mcp_server(state_clone, target_port, shutdown_rx).await {
                crate::log_error!("mcp", "MCP server failed on port {}: {}", target_port, e);
            }
        });

        *handle_lock = Some(mcp::McpServerHandle {
            port: target_port,
            shutdown_tx,
        });

        crate::log_info!("mcp", "Enabled MCP server on http://127.0.0.1:{}/mcp", target_port);

        Ok(mcp::McpStatus {
            active: true,
            port: target_port,
            url: format!("http://127.0.0.1:{}/mcp", target_port),
        })
    } else {
        if let Some(h) = handle_lock.take() {
            let _ = h.shutdown_tx.send(());
            crate::log_info!("mcp", "Stopped MCP server on port {}", h.port);
        }
        Ok(mcp::McpStatus {
            active: false,
            port: target_port,
            url: format!("http://127.0.0.1:{}/mcp", target_port),
        })
    }
}

#[tauri::command]
async fn wsl_get_status() -> wsl::WslStatus {
    tokio::task::spawn_blocking(wsl::get_wsl_status)
        .await
        .unwrap_or_else(|_| wsl::WslStatus {
            is_installed: false,
            distros: Vec::new(),
            default_distro: None,
        })
}

#[tauri::command]
async fn wsl_start_distro(distro: String) -> Result<(), String> {
    wsl::start_wsl_distro(&distro).await
}

#[tauri::command]
async fn wsl_stop_distro(distro: String) -> Result<(), String> {
    wsl::stop_wsl_distro(&distro).await
}

#[tauri::command]
async fn wsl_shutdown_all() -> Result<(), String> {
    wsl::shutdown_all_wsl().await
}

#[tauri::command]
async fn wsl_install_distro(distro_name: String) -> Result<(), String> {
    wsl::install_wsl_distro(&distro_name).await
}

#[tauri::command]
async fn wsl_unregister_distro(distro: String) -> Result<(), String> {
    wsl::unregister_wsl_distro(&distro).await
}

#[tauri::command]
fn wsl_add_to_hosts(state: tauri::State<'_, AppState>, distro: wsl::WslDistro) -> Result<AppConfig, String> {
    let host_cfg = wsl::create_wsl_host_config(&distro);
    let mut cfg = load_or_init_config(&state.config_path);
    if let Some(pos) = cfg.hosts.iter().position(|h| h.id == host_cfg.id) {
        cfg.hosts[pos] = host_cfg;
    } else {
        cfg.hosts.push(host_cfg);
    }
    let serialized = toml::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.config_path, &serialized).map_err(|e| e.to_string())?;
    Ok(cfg)
}



#[tauri::command]
async fn wsl_get_available_distros() -> Result<Vec<wsl::WslOnlineDistro>, String> {
    Ok(wsl::get_available_wsl_distros().await)
}

#[tauri::command]
async fn wsl_import_distro(
    distro_name: String,
    install_location: String,
    file_path: String,
) -> Result<(), String> {
    wsl::import_wsl_distro(&distro_name, &install_location, &file_path).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ensure WebView2 does not write persistent HTTP or shader disk cache between runs
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--disable-http-cache --disable-gpu-shader-disk-cache",
    );

    // Clean up any stale webview disk cache from previous non-incognito runs
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let webview_cache_dir = PathBuf::from(local_app_data)
            .join("com.taris.studio")
            .join("EBWebView");
        if webview_cache_dir.exists() {
            for sub in &["Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/Service Worker"] {
                let p = webview_cache_dir.join(sub);
                if p.exists() {
                    let _ = std::fs::remove_dir_all(&p);
                }
            }
        }
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let exe_dir = std::env::current_exe()
        .map(|p| p.parent().unwrap_or(Path::new(".")).to_path_buf())
        .unwrap_or_else(|_| PathBuf::from("."));

    // The application config is strictly adjacent to the executable
    let exe_config = exe_dir.join("config.toml");

    // If config does not exist next to the executable, copy it over from workspace / CWD
    if !exe_config.exists() {
        let mut source_config = None;
        if cwd.join("config.toml").exists() {
            source_config = Some(cwd.join("config.toml"));
        } else if let Some(parent) = cwd.parent() {
            let p_cfg = parent.join("config.toml");
            if p_cfg.exists() {
                source_config = Some(p_cfg);
            }
        }
        if let Some(src) = source_config {
            if let Ok(content) = std::fs::read(&src) {
                let _ = std::fs::write(&exe_config, content);
                crate::log_info!("config", "Copied workspace config from {:?} to executable directory {:?}", src, exe_config);
            }
        }
    }

    let config_path = exe_config;

    crate::log_info!("config", "Resolved application config path: {:?}", config_path);
    let initial_cfg = load_or_init_config(&config_path);

    // Ensure .ssh directory exists
    let base_dir = config_path.parent().unwrap_or(Path::new("."));
    let ssh_dir = base_dir.join(".ssh");
    if !ssh_dir.exists() {
        let _ = std::fs::create_dir_all(&ssh_dir);
    }

    let mesh_state = mesh::MeshState::default();

    let app_state = AppState {
        pty_sessions: Arc::new(Mutex::new(HashMap::new())),
        config_path: config_path.clone(),
        ssh_pool: ssh::SshSessionPool::new(),
        docker_cpu_samples: Arc::new(Mutex::new(HashMap::new())),
        active_tunnels: Arc::new(Mutex::new(HashMap::new())),
        mesh: Arc::new(mesh_state.clone()),
        mcp_handle: Arc::new(Mutex::new(None)),
    };

    if initial_cfg.settings.enable_mcp_server {
        let port = initial_cfg.settings.mcp_server_port;
        let (shutdown_tx, shutdown_rx) = tokio::sync::broadcast::channel(1);
        let state_clone = app_state.clone();
        tokio::spawn(async move {
            if let Err(e) = mcp::start_mcp_server(state_clone, port, shutdown_rx).await {
                crate::log_error!("mcp", "MCP server error on port {}: {}", port, e);
            }
        });
        *app_state.mcp_handle.lock().unwrap() = Some(mcp::McpServerHandle {
            port,
            shutdown_tx,
        });
        crate::log_info!("mcp", "MCP server listening at http://127.0.0.1:{}/mcp", port);
    }

    tauri::Builder::default()
        .manage(app_state)
        .manage(mesh_state)
        .invoke_handler(tauri::generate_handler![
            get_remote_telemetry,
            read_local_file,
            write_local_file,
            list_local_files,
            list_remote_files,
            read_remote_file,
            write_remote_file,
            cache_remote_db,
            sqlite_get_tables,
            sqlite_query,
            window_minimize,
            window_maximize,
            window_close,
            get_config,
            save_config,
            add_host,
            delete_host,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
            ssh_disconnect_host,
            get_clipboard_text,
            write_clipboard_text,
            get_clipboard_files,
            copy_local_files,
            sftp_upload_file,
            sftp_download_file,
            delete_local_file,
            delete_remote_file,
            save_host_icon,
            save_snippet,
            delete_snippet,
            check_hosts_alive,
            get_tunnels_status,
            save_tunnel,
            delete_tunnel,
            toggle_tunnel,
            send_wol_packet,
            get_available_shells,
            pick_ssh_key_file,
            check_ssh_key_permissions,
            fix_ssh_key_permissions,
            mesh::parse_wireguard_config_text,
            mesh::export_wireguard_config_text,
            mesh::pick_wireguard_conf_file,
            mesh::toggle_wireguard_profile_session,
            mesh::get_wireguard_runtime_statuses,
            mesh::get_tailscale_runtime_status,
            mesh::get_netbird_runtime_status,
            mesh::get_mesh_tunnel_endpoint,
            mesh::toggle_tailscale_session,
            mesh::toggle_netbird_session,
            mesh::get_active_mesh_sessions,
            mesh::open_mesh_auth_portal,
            launch_url_in_browser,
            docker::check_docker_available,
            docker::get_docker_containers,
            docker::docker_container_action,
            docker::get_container_stats,
            ports::get_port_inspection,
            editor::discover_external_editors,
            editor::open_in_external_editor,
            editor::open_in_native_explorer,
            cloud::check_cloud_auth,
            cloud::save_cloud_credentials,
            cloud::get_cloud_credentials,
            cloud::list_cloud_projects,
            cloud::list_cloud_instances,
            cloud::get_cloud_instance_ssh_endpoint,
            cloud::pick_cloud_key_file,
            logs::get_app_logs,
            logs::log_webview_event,
            logs::clear_app_logs,
            logs::export_app_logs_text,
            importer::detect_all_importable_hosts,
            importer::parse_imported_host_file,
            archive::inspect_archive,
            get_mcp_status,
            toggle_mcp_server,
            wsl_get_status,
            wsl_start_distro,
            wsl_stop_distro,
            wsl_shutdown_all,
            wsl_install_distro,
            wsl_unregister_distro,
            wsl_add_to_hosts,
            wsl_get_available_distros,
            wsl_import_distro,
            save_terminal_theme,
            load_all_terminal_themes,
            icons::get_host_icons,
            icons::trim_memory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Taris application");
}



