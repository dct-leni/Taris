use chrono::Local;
pub mod cloud;
pub mod docker;
pub mod editor;
pub mod logs;
pub mod mesh;
pub mod ports;
pub mod ssh;

pub use logs::*;
pub use ssh::*;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SettingsConfig {
    pub font_family: String,
    pub font_size: u32,
    #[serde(default = "default_app_font_size")]
    pub app_font_size: u32,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_theme")]
    pub app_theme: String,
    #[serde(default = "default_theme")]
    pub terminal_theme: String,
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
    #[serde(default)]
    pub custom_themes: std::collections::HashMap<String, serde_json::Value>,
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
    pub settings: SettingsConfig,
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
            settings: SettingsConfig {
                font_family: "Cascadia Code".into(),
                font_size: 14,
                app_font_size: 13,
                theme: "one_dark".into(),
                app_theme: "one_dark".into(),
                terminal_theme: "one_dark".into(),
                default_shell: "powershell".into(),
                cursor_style: "block".into(),
                external_editor: None,
                external_editor_name: None,
                docker_port: 2375,
                enable_multiplexing: true,
                enable_ssh_compression: false,
                drawer_width: 240,
                sidebar_width: 310,
                sftp_col_date_width: 105,
                sftp_col_size_width: 55,
                scrollback: 10000,
                enable_app_logs: false,
                custom_themes: std::collections::HashMap::new(),
            },
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

pub struct PtySession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub struct ActiveTunnel {
    pub config: TunnelConfig,
    pub shutdown_tx: tokio::sync::broadcast::Sender<()>,
    pub bytes_rx: Arc<std::sync::atomic::AtomicU64>,
    pub bytes_tx: Arc<std::sync::atomic::AtomicU64>,
    pub active_connections: Arc<std::sync::atomic::AtomicU32>,
    pub error: Arc<Mutex<Option<String>>>,
}

pub struct AppState {
    pub pty_sessions: Mutex<HashMap<String, PtySession>>,
    pub config_path: PathBuf,
    pub ssh_pool: ssh::SshSessionPool,
    pub docker_cpu_samples: Mutex<HashMap<String, (u64, u64, std::time::Instant)>>,
    pub active_tunnels: Mutex<HashMap<String, ActiveTunnel>>,
    pub mesh: Arc<mesh::MeshState>,
}

impl AppState {
    pub fn take_ssh_session(&self, host: &HostConfig) -> Result<ssh2::Session, String> {
        let is_mesh = host.network_route.as_deref() == Some("mesh")
            || (host.network_route.is_some() && host.network_route.as_deref() != Some("direct"));

        if is_mesh {
            match mesh::resolve_mesh_endpoint_sync(&self.config_path, &self.mesh, host, None) {
                Ok(ep) => {
                    crate::log_info!("ssh", "Connecting to {} via mesh route {} at {}:{}", host.name, ep.route_type, ep.host, ep.port);
                    self.ssh_pool.take_session_with_target(host, &ep.host, ep.port)
                }
                Err(e) => {
                    crate::log_error!("ssh", "Failed to resolve mesh route for {}: {}", host.name, e);
                    Err(format!("Mesh routing failed for {}: {}", host.name, e))
                }
            }
        } else {
            let port = if host.port == 0 { 22 } else { host.port };
            self.ssh_pool.take_session_with_target(host, &host.host, port)
        }
    }

    pub fn return_ssh_session(&self, host: &HostConfig, sess: ssh2::Session) {
        self.ssh_pool.return_session(host, sess);
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
fn pty_spawn(
    state: tauri::State<'_, AppState>,
    session_id: String,
    shell_type: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    on_data: tauri::ipc::Channel<String>,
) -> Result<(), String> {
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
            let bash_path = if is_command_in_path("bash") {
                "bash.exe".into()
            } else {
                find_git_bash()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| "bash.exe".into())
            };
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

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // Essential for Windows ConPTY: drop slave side immediately to release handles
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    state.pty_sessions.lock().unwrap().insert(
        session_id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
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
    });

    Ok(())
}

#[tauri::command]
fn pty_write(
    state: tauri::State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock().unwrap();
    if let Some(sess) = sessions.get_mut(&session_id) {
        sess.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        sess.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(
    state: tauri::State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock().unwrap();
    if let Some(sess) = sessions.get_mut(&session_id) {
        sess.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_close(state: tauri::State<'_, AppState>, session_id: String) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock().unwrap();
    if let Some(mut sess) = sessions.remove(&session_id) {
        let _ = sess.child.kill();
    }
    Ok(())
}

// ── Portable Config Commands ──

pub fn load_or_init_config(path: &Path) -> AppConfig {
    if path.exists() {
        if let Ok(content) = std::fs::read_to_string(path) {
            match toml::from_str::<AppConfig>(&content) {
                Ok(cfg) => return cfg,
                Err(err) => {
                    eprintln!("WARNING: Failed to parse config at {:?}: {}. Preserving existing file!", path, err);
                    return AppConfig::default();
                }
            }
        }
    }
    let default_cfg = AppConfig::default();
    if !path.exists() {
        if let Ok(serialized) = toml::to_string_pretty(&default_cfg) {
            let _ = std::fs::write(path, serialized);
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
    std::fs::write(&state.config_path, serialized).map_err(|e| e.to_string())?;
    Ok(())
}

fn cleanup_unused_icons(config_path: &Path, hosts: &[HostConfig]) {
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
fn get_telemetry() -> TelemetryData {
    TelemetryData {
        cpu: 0.0,
        ram: 0.0,
        net_rx: 0,
        net_tx: 0,
        ping_ms: None,
    }
}

#[tauri::command]
async fn get_remote_telemetry(state: tauri::State<'_, AppState>, host: HostConfig) -> Result<TelemetryData, String> {
    let host_clone = host.clone();
    let sess = state.take_ssh_session(&host_clone)?;

    let query_res = tokio::task::spawn_blocking(move || {
        let mut channel = sess.channel_session().map_err(|e| format!("Failed to open SSH channel: {}", e))?;
        channel.exec("cat /proc/stat /proc/meminfo /proc/net/dev 2>/dev/null")
            .map_err(|e| format!("Failed to exec proc query: {}", e))?;
        let mut output = Vec::new();
        channel.read_to_end(&mut output).map_err(|e| format!("Failed to read channel: {}", e))?;
        let _ = channel.wait_close();
        Ok((output, sess))
    });

    let output = match tokio::time::timeout(std::time::Duration::from_secs(4), query_res).await {
        Ok(Ok(Ok((o, s)))) => {
            state.return_ssh_session(&host, s);
            o
        }
        Ok(Ok(Err(e))) => return Err(e),
        Ok(Err(join_err)) => return Err(format!("Telemetry thread error: {}", join_err)),
        Err(_) => return Err("Telemetry query timed out (4s)".into()),
    };

    let out_str = String::from_utf8_lossy(&output);
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

#[tauri::command]
fn list_local_files(dir_path: Option<String>) -> Result<Vec<RealFileItem>, String> {
    let base = match dir_path {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => std::env::current_dir().map_err(|e| e.to_string())?,
    };

    let entries = std::fs::read_dir(&base).map_err(|e| e.to_string())?;
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
fn cache_remote_db(state: tauri::State<'_, AppState>, host: HostConfig, remote_path: String) -> Result<String, String> {
    let sess = state.take_ssh_session(&host)?;
    let res = (|| {
        let (mut remote_file, _stat) = sess.scp_recv(Path::new(&remote_path))
            .map_err(|e| format!("SCP receive failed for '{}': {}", remote_path, e))?;

        let file_name = std::path::Path::new(&remote_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("remote.db");

        let temp_cache_dir = std::env::temp_dir().join("taris_db_cache");
        let _ = std::fs::create_dir_all(&temp_cache_dir);
        let local_path = temp_cache_dir.join(format!("{}_{}", host.id, file_name));

        let mut local_file = std::fs::File::create(&local_path)
            .map_err(|e| format!("Failed to create local cache file: {}", e))?;

        std::io::copy(&mut remote_file, &mut local_file)
            .map_err(|e| format!("Failed to copy DB over SCP: {}", e))?;

        Ok(local_path.to_string_lossy().to_string())
    })();
    if res.is_ok() {
        state.return_ssh_session(&host, sess);
    }
    res
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
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_local_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}


#[tauri::command]
fn window_is_maximized(window: tauri::Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

// ── 4.6 Native Clipboard & Multi-Threaded Transfers ──

#[cfg(windows)]
mod clipboard_utils {
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
mod clipboard_utils {
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

#[tauri::command]
fn delete_local_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Local path '{}' does not exist", path));
    }
    let trimmed = path.trim().replace('\\', "/");
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

fn bridge_tunnel_client(
    client_stream: tokio::net::TcpStream,
    host: &HostConfig,
    remote_host: &str,
    remote_port: u16,
    bytes_rx: Arc<std::sync::atomic::AtomicU64>,
    bytes_tx: Arc<std::sync::atomic::AtomicU64>,
) -> Result<(), String> {
    let std_stream = client_stream.into_std().map_err(|e| format!("Socket conversion failed: {}", e))?;
    std_stream.set_nonblocking(true).map_err(|e| format!("Set nonblocking failed: {}", e))?;

    let mut stream_read = std_stream.try_clone().map_err(|e| format!("Stream clone failed: {}", e))?;
    let mut stream_write = std_stream;

    let sess = open_ssh2_session(host)?;
    sess.set_blocking(false);
    let mut channel = sess.channel_direct_tcpip(remote_host, remote_port, None)
        .map_err(|e| format!("channel_direct_tcpip failed: {}", e))?;

    let mut buf_in = [0u8; 16384];
    let mut buf_out = [0u8; 16384];

    loop {
        let mut idle = true;

        // 1. Read from local client -> write to remote SSH channel
        match stream_read.read(&mut buf_in) {
            Ok(0) => break,
            Ok(n) => {
                idle = false;
                bytes_tx.fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
                let mut written = 0;
                while written < n {
                    match channel.write(&buf_in[written..n]) {
                        Ok(w) => written += w,
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(std::time::Duration::from_millis(2));
                        }
                        Err(_) => break,
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        // 2. Read from remote SSH channel -> write to local client
        match channel.read(&mut buf_out) {
            Ok(0) => {
                if channel.eof() {
                    break;
                }
            }
            Ok(n) => {
                idle = false;
                bytes_rx.fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
                let mut written = 0;
                while written < n {
                    match stream_write.write(&buf_out[written..n]) {
                        Ok(w) => written += w,
                        Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(std::time::Duration::from_millis(2));
                        }
                        Err(_) => break,
                    }
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        if idle {
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
    }

    let _ = channel.close();
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

                            tokio::task::spawn_blocking(move || {
                                conn_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                let _ = bridge_tunnel_client(client_stream, &host_c, &r_host, r_port, b_rx, b_tx);
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
    let cwd_config = cwd.join("config.toml");
    let exe_dir = std::env::current_exe()
        .map(|p| p.parent().unwrap_or(Path::new(".")).to_path_buf())
        .unwrap_or_else(|_| PathBuf::from("."));
    let exe_config = exe_dir.join("config.toml");

    let config_path = if cwd_config.exists() {
        cwd_config
    } else if exe_config.exists() {
        exe_config
    } else if cwd.join("Cargo.toml").exists() {
        cwd_config
    } else {
        exe_config
    };
    let _ = load_or_init_config(&config_path);

    // Ensure .ssh directory exists
    let base_dir = config_path.parent().unwrap_or(Path::new("."));
    let ssh_dir = base_dir.join(".ssh");
    if !ssh_dir.exists() {
        let _ = std::fs::create_dir_all(&ssh_dir);
    }

    let mesh_state = mesh::MeshState::default();

    tauri::Builder::default()
        .manage(AppState {
            pty_sessions: Mutex::new(HashMap::new()),
            config_path,
            ssh_pool: ssh::SshSessionPool::new(),
            docker_cpu_samples: Mutex::new(HashMap::new()),
            active_tunnels: Mutex::new(HashMap::new()),
            mesh: Arc::new(mesh_state.clone()),
        })
        .manage(mesh_state)
        .invoke_handler(tauri::generate_handler![
            get_telemetry,
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
            window_is_maximized,
            get_config,
            save_config,
            add_host,
            delete_host,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_close,
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
            mesh::get_tailscale_endpoint,
            mesh::get_netbird_runtime_status,
            mesh::get_netbird_endpoint,
            mesh::get_mesh_tunnel_endpoint,
            mesh::toggle_tailscale_session,
            mesh::toggle_netbird_session,
            mesh::get_active_mesh_session,
            mesh::disconnect_all_mesh_sessions,
            mesh::open_mesh_auth_portal,
            launch_url_in_browser,
            docker::check_docker_available,
            docker::get_docker_containers,
            docker::docker_container_action,
            docker::get_container_stats,
            ports::get_port_inspection,
            editor::discover_external_editors,
            editor::open_in_external_editor,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Taris application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor::discover_external_editors;
    use crate::docker::query_docker_remote;
    use crate::ports::parse_proc_net_entries;

    #[test]
    fn test_telemetry_connect() {
        let host = HostConfig {
            id: "test".into(),
            name: "GMKtec".into(),
            host: "192.168.0.3".into(),
            port: 22,
            user: "gmktec".into(),
            auth_type: "password".into(),
            key_path: None,
            password: Some("gmktec".into()),
            has_docker: true,
            icon: "".into(),
            docker_port: None,
            enable_port_scan: true,
            mac_address: None,
            cloud_provider: None,
            cloud_project_id: None,
            cloud_zone: None,
            cloud_instance_id: None,
            network_route: None,
        };
        let res = open_ssh2_session(&host);
        assert!(res.is_ok());
    }

    #[test]
    fn test_editor_discovery() {
        let editors = discover_external_editors();
        println!("Discovered editors: {:?}", editors);
        assert!(!editors.is_empty(), "Should discover at least Notepad or Zed");
    }

    #[test]
    fn test_is_command_in_path() {
        #[cfg(target_os = "windows")]
        {
            assert!(is_command_in_path("cmd"), "cmd should be in PATH on Windows");
            assert!(is_command_in_path("cmd.exe"), "cmd.exe should be in PATH on Windows");
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert!(is_command_in_path("sh"), "sh should be in PATH on Unix");
        }
    }

    #[test]
    fn test_clipboard_reader() {
        let res = get_clipboard_files();
        assert!(res.is_ok());
    }

    #[test]
    fn test_clipboard_text() {
        let sample = "Taris clipboard integration test";
        let write_res = write_clipboard_text(sample.to_string());
        assert!(write_res.is_ok());
        let read_res = get_clipboard_text();
        assert!(read_res.is_ok());
        assert_eq!(read_res.unwrap(), sample);
    }

    #[test]
    fn test_delete_local_file_and_dir() {
        let temp_dir = std::env::temp_dir().join("taris_delete_test");
        let _ = std::fs::create_dir_all(&temp_dir);
        let test_file = temp_dir.join("temp_to_delete.txt");
        std::fs::write(&test_file, "hello delete").unwrap();
        assert!(test_file.exists());

        let res = delete_local_file(test_file.to_string_lossy().to_string());
        assert!(res.is_ok());
        assert!(!test_file.exists());

        let sub_dir = temp_dir.join("sub_folder");
        std::fs::create_dir_all(&sub_dir).unwrap();
        std::fs::write(sub_dir.join("child.txt"), "child data").unwrap();
        assert!(sub_dir.exists());

        let res_dir = delete_local_file(sub_dir.to_string_lossy().to_string());
        assert!(res_dir.is_ok());
        assert!(!sub_dir.exists());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_remote_docker_and_ports() {
        let host = HostConfig {
            id: "test".into(),
            name: "GMKtec".into(),
            host: "192.168.0.3".into(),
            port: 22,
            user: "gmktec".into(),
            auth_type: "password".into(),
            key_path: None,
            password: Some("gmktec".into()),
            has_docker: true,
            icon: "".into(),
            docker_port: Some(2375),
            enable_port_scan: true,
            mac_address: None,
            cloud_provider: None,
            cloud_project_id: None,
            cloud_zone: None,
            cloud_instance_id: None,
            network_route: None,
        };
        let sess = open_ssh2_session(&host).unwrap();
        // Check REST API query
        let containers_res = query_docker_remote(&sess, 2375, "GET", "/containers/json?all=1");
        assert!(containers_res.is_ok());
        let body = containers_res.unwrap();
        assert!(body.starts_with('['));
        println!("Containers JSON returned, length: {}", body.len());

        // Check remote port inspection via SFTP
        let sftp = sess.sftp().unwrap();
        let mut sockets = Vec::new();
        if let Ok(mut f) = sftp.open(Path::new("/proc/net/tcp")) {
            let mut content = String::new();
            if f.read_to_string(&mut content).is_ok() {
                parse_proc_net_entries(&content, "TCP", &mut sockets);
            }
        }
        println!("Remote TCP sockets parsed: {}", sockets.len());
        assert!(!sockets.is_empty());
    }

    #[test]
    fn test_local_netstat2() {
        use netstat2::*;
        let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
        let proto_flags = ProtocolFlags::TCP | ProtocolFlags::UDP;
        let sockets = get_sockets_info(af_flags, proto_flags).unwrap();
        println!("netstat2 total active sockets found: {}", sockets.len());
        assert!(!sockets.is_empty());
        for s in sockets.iter().take(5) {
            match &s.protocol_socket_info {
                ProtocolSocketInfo::Tcp(tcp) => {
                    println!("  TCP {}:{} -> {}:{} State: {:?} PIDs: {:?}", tcp.local_addr, tcp.local_port, tcp.remote_addr, tcp.remote_port, tcp.state, s.associated_pids);
                }
                ProtocolSocketInfo::Udp(udp) => {
                    println!("  UDP {}:{} PIDs: {:?}", udp.local_addr, udp.local_port, s.associated_pids);
                }
            }
        }
    }

    #[test]
    fn test_snippet_and_icon_cleanup() {
        let temp_dir = std::env::temp_dir().join("taris_test_icons");
        let _ = std::fs::create_dir_all(&temp_dir);
        let config_file = temp_dir.join("config.toml");
        let ui_icons_dir = temp_dir.join("ui").join("icons");
        let _ = std::fs::create_dir_all(&ui_icons_dir);

        // Create 2 test icons: 1 used, 1 unused
        let used_icon_path = ui_icons_dir.join("used_node.svg");
        let unused_icon_path = ui_icons_dir.join("unused_trash.svg");
        std::fs::write(&used_icon_path, "<svg>used</svg>").unwrap();
        std::fs::write(&unused_icon_path, "<svg>unused</svg>").unwrap();

        let hosts = vec![HostConfig {
            id: "host-1".into(),
            name: "Server 1".into(),
            host: "10.0.0.1".into(),
            port: 22,
            user: "root".into(),
            auth_type: "key".into(),
            key_path: None,
            password: None,
            has_docker: false,
            icon: "icons/used_node.svg".into(),
            docker_port: None,
            enable_port_scan: true,
            mac_address: None,
            cloud_provider: None,
            cloud_project_id: None,
            cloud_zone: None,
            cloud_instance_id: None,
            network_route: None,
        }];

        cleanup_unused_icons(&config_file, &hosts);

        assert!(used_icon_path.exists(), "Used icon should NOT be deleted");
        assert!(!unused_icon_path.exists(), "Unused icon SHOULD be deleted by cleanup");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_parse_workspace_config() {
        let content = std::fs::read_to_string("c:\\Users\\Leni\\Desktop\\Projects\\SSH_Term\\config.toml").unwrap();
        let res = toml::from_str::<AppConfig>(&content);
        match res {
            Ok(c) => {
                println!("SUCCESS! Hosts len = {}", c.hosts.len());
                assert_eq!(c.settings.app_theme, "one_dark");
                assert_eq!(c.settings.terminal_theme, "one_dark");
            }
            Err(e) => panic!("FAILED TO PARSE: {}", e),
        }
    }

    #[test]
    fn test_theme_and_cursor_settings() {
        let toml_str = r#"
            font_family = "Cascadia Code"
            font_size = 14
            theme = "dracula"
            app_theme = "tokyo_night"
            terminal_theme = "nord"
            default_shell = "powershell"
            cursor_blink = true
        "#;
        let s: SettingsConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(s.app_theme, "tokyo_night");
        assert_eq!(s.terminal_theme, "nord");
        assert_eq!(s.theme, "dracula");
        assert_eq!(s.enable_multiplexing, true);
        assert_eq!(s.enable_ssh_compression, false);
    }

    #[test]
    fn test_discover_available_shells() {
        let shells = discover_available_shells();
        println!("Discovered shells: {:?}", shells);
        assert!(!shells.is_empty(), "Should discover at least one shell");
        let has_ps = shells.iter().any(|s| s.id == "powershell");
        assert!(has_ps, "Should find PowerShell");
        let has_git_bash = shells.iter().any(|s| s.id == "git-bash");
        if find_git_bash().is_some() {
            assert!(has_git_bash, "Should detect Git Bash if it is installed on system");
        }
    }

    #[test]
    fn test_ssh_key_permissions() {
        let temp_dir = std::env::temp_dir().join("taris_perm_test");
        let _ = std::fs::create_dir_all(&temp_dir);
        let test_key = temp_dir.join("test_dummy_key.pem");
        std::fs::write(&test_key, "dummy key content").unwrap();

        let path_str = test_key.to_string_lossy().to_string();
        let check_res = check_ssh_key_permissions(path_str.clone()).unwrap();
        assert!(check_res.exists);

        let fix_res = fix_ssh_key_permissions(path_str.clone()).unwrap();
        assert!(fix_res.exists);
        assert!(!fix_res.too_open, "Permissions must be secured after fix: {}", fix_res.details);

        let _ = std::fs::remove_file(test_key);
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}


