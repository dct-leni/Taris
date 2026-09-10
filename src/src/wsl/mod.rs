use crate::HostConfig;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static RUNNING_CACHE: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);
static ONLINE_DISTROS_CACHE: Mutex<Option<(Instant, Vec<WslOnlineDistro>)>> = Mutex::new(None);

pub fn clear_running_distro_cache() {
    if let Ok(mut lock) = RUNNING_CACHE.lock() {
        *lock = None;
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WslDistro {
    pub id: String,
    pub name: String,
    pub version: u32,
    pub base_path: String,
    pub default_uid: u32,
    pub is_default: bool,
    pub state: String, // "Running", "Stopped", "Unknown"
    pub plan9_path: String, // "\\wsl.localhost\Ubuntu"
    pub ip_address: Option<String>,
    pub image_size: Option<u64>,
    pub image_size_formatted: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WslStatus {
    pub is_installed: bool,
    pub distros: Vec<WslDistro>,
    pub default_distro: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WslOnlineDistro {
    pub name: String,
    pub friendly_name: String,
}

fn get_distro_image_size(base_path: &str) -> (Option<u64>, Option<String>) {
    let clean = base_path.trim_start_matches(r"\\?\");
    if clean.is_empty() {
        return (None, None);
    }
    let p = std::path::Path::new(clean);
    if !p.exists() {
        return (None, None);
    }

    if p.is_file() {
        if let Ok(meta) = std::fs::metadata(p) {
            let len = meta.len();
            return (Some(len), Some(format_size_bytes(len)));
        }
    }

    let ext4 = p.join("ext4.vhdx");
    if ext4.exists() {
        if let Ok(meta) = std::fs::metadata(&ext4) {
            let len = meta.len();
            return (Some(len), Some(format_size_bytes(len)));
        }
    }

    if let Ok(entries) = std::fs::read_dir(p) {
        for entry in entries.filter_map(|e| e.ok()) {
            let ep = entry.path();
            if ep.is_file() {
                if let Some(ext) = ep.extension().and_then(|x| x.to_str()) {
                    if ext.eq_ignore_ascii_case("vhdx") || ext.eq_ignore_ascii_case("vhd") {
                        if let Ok(meta) = entry.metadata() {
                            let len = meta.len();
                            return (Some(len), Some(format_size_bytes(len)));
                        }
                    }
                }
            }
        }
    }

    (None, None)
}

fn format_size_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.0} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.0} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Checks if WSL subsystem is installed and available on this host.
pub fn is_wsl_installed() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        // 1. Check LxssManager service in HKLM
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if hklm.open_subkey("SYSTEM\\CurrentControlSet\\Services\\LxssManager").is_ok() {
            return true;
        }

        // 2. Check wslapi.dll in System32 and HKCU Lxss
        if let Some(sys_root) = std::env::var_os("SystemRoot") {
            let p = std::path::PathBuf::from(sys_root).join("System32").join("wslapi.dll");
            if p.exists() {
                let hkcu = RegKey::predef(HKEY_CURRENT_USER);
                if hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Lxss").is_ok() {
                    return true;
                }
            }
        }

        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Enumerate registered WSL distributions via pure Windows Registry (HKCU\...\Lxss) in < 1ms.
pub fn get_wsl_distros() -> Vec<WslDistro> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let mut distros = Vec::new();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let lxss = match hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Lxss") {
            Ok(k) => k,
            Err(_) => return distros,
        };

        let default_guid: String = lxss.get_value("DefaultDistribution").unwrap_or_default();

        // Get running distros list if possible via quick non-blocking check
        let running_names = get_running_distro_names();

        for guid in lxss.enum_keys().filter_map(|k| k.ok()) {
            if let Ok(sub) = lxss.open_subkey(&guid) {
                let name: String = sub.get_value("DistributionName").unwrap_or_default();
                if name.is_empty() {
                    continue;
                }
                let base_path: String = sub.get_value("BasePath").unwrap_or_default();
                let version: u32 = sub.get_value("Version").unwrap_or(2);
                let default_uid: u32 = sub.get_value("DefaultUid").unwrap_or(1000);
                let is_default = !default_guid.is_empty() && guid.eq_ignore_ascii_case(&default_guid);

                let is_running = running_names.iter().any(|r| r.eq_ignore_ascii_case(&name));
                let state = if is_running { "Running" } else { "Stopped" }.to_string();
                let plan9_path = format!(r"\\wsl.localhost\{}", name);
                let (image_size, image_size_formatted) = get_distro_image_size(&base_path);

                distros.push(WslDistro {
                    id: guid,
                    name,
                    version,
                    base_path,
                    default_uid,
                    is_default,
                    state,
                    plan9_path,
                    ip_address: None,
                    image_size,
                    image_size_formatted,
                });
            }
        }

        distros
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Discovers currently running distribution names via lightweight wsl.exe query.
#[cfg(windows)]
fn get_running_distro_names() -> Vec<String> {
    if let Ok(lock) = RUNNING_CACHE.lock() {
        if let Some((instant, ref cached)) = *lock {
            if instant.elapsed() < Duration::from_millis(5000) {
                return cached.clone();
            }
        }
    }

    let mut names = Vec::new();
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.args(["--list", "--running", "-q"]);
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Ok(out) = cmd.output() {
        let text = decode_utf16_or_utf8(&out.stdout);
        for line in text.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                names.push(trimmed.to_string());
            }
        }
    }

    if let Ok(mut lock) = RUNNING_CACHE.lock() {
        *lock = Some((Instant::now(), names.clone()));
    }

    names
}

/// Decodes command output that could be UTF-16LE (standard on Windows CLI) or UTF-8.
pub fn decode_utf16_or_utf8(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[1] == 0 {
        let u16_chars: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&u16_chars)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

/// Returns overall WSL status including installation presence and installed distros.
pub fn get_wsl_status() -> WslStatus {
    let installed = is_wsl_installed();
    let distros = if installed { get_wsl_distros() } else { Vec::new() };
    let default_distro = distros.iter().find(|d| d.is_default).map(|d| d.name.clone());

    WslStatus {
        is_installed: installed,
        distros,
        default_distro,
    }
}

/// Starts a specific WSL distribution.
pub async fn start_wsl_distro(distro_name: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let name = distro_name.to_string();
        tokio::task::spawn_blocking(move || {
            // Keep micro-VM running in background so WSL2 does not terminate it immediately
            let mut cmd = std::process::Command::new("wsl.exe");
            cmd.args(["-d", &name, "-e", "sh", "-c", "nohup sleep 864000 >/dev/null 2>&1 & true"]);
            cmd.creation_flags(CREATE_NO_WINDOW);

            let res = cmd.output()
                .map_err(|e| format!("Failed to start WSL distro '{}': {}", name, e))?;

            if !res.status.success() {
                let mut fb = std::process::Command::new("wsl.exe");
                fb.args(["-d", &name, "-e", "true"]);
                fb.creation_flags(CREATE_NO_WINDOW);
                let _ = fb.output();
            }

            clear_running_distro_cache();
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = distro_name;
        Err("WSL is supported only on Windows".into())
    }
}

/// Stops/terminates a specific WSL distribution.
pub async fn stop_wsl_distro(distro_name: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let name = distro_name.to_string();
        tokio::task::spawn_blocking(move || {
            let mut cmd = std::process::Command::new("wsl.exe");
            cmd.args(["-t", &name]);
            cmd.creation_flags(CREATE_NO_WINDOW);

            let res = cmd.output()
                .map_err(|e| format!("Failed to terminate WSL distro '{}': {}", name, e))?;

            clear_running_distro_cache();

            if !res.status.success() {
                let err_msg = decode_utf16_or_utf8(&res.stderr);
                return Err(format!("WSL stop error: {}", err_msg.trim()));
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = distro_name;
        Err("WSL is supported only on Windows".into())
    }
}

/// Shuts down all running WSL2 micro-virtual machines.
pub async fn shutdown_all_wsl() -> Result<(), String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(|| {
            let mut cmd = std::process::Command::new("wsl.exe");
            cmd.arg("--shutdown");
            cmd.creation_flags(CREATE_NO_WINDOW);

            let res = cmd.output()
                .map_err(|e| format!("Failed to shutdown WSL: {}", e))?;

            clear_running_distro_cache();

            if !res.status.success() {
                let err_msg = decode_utf16_or_utf8(&res.stderr);
                return Err(format!("WSL shutdown error: {}", err_msg.trim()));
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("WSL is supported only on Windows".into())
    }
}

/// Installs an official WSL distribution from Microsoft's online catalog.
pub async fn install_wsl_distro(distro_name: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let name = distro_name.trim().to_string();
        tokio::task::spawn_blocking(move || {
            let mut cmd = std::process::Command::new("wsl.exe");
            cmd.args(["--install", "-d", &name, "--no-launch"]);
            cmd.creation_flags(CREATE_NO_WINDOW);

            let res = cmd.output();

            match res {
                Ok(out) => {
                    if !out.status.success() {
                        let err_msg = decode_utf16_or_utf8(&out.stderr);
                        let stdout_msg = decode_utf16_or_utf8(&out.stdout);
                        let combined = format!("{} {}", err_msg.trim(), stdout_msg.trim()).trim().to_string();
                        return Err(if !combined.is_empty() {
                            combined
                        } else {
                            format!("Failed to install WSL distro '{}'", name)
                        });
                    }
                    clear_running_distro_cache();
                    Ok(())
                }
                Err(e) => Err(format!("Failed to execute wsl --install: {}", e)),
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = distro_name;
        Err("WSL is supported only on Windows".into())
    }
}

/// Queries available distributions directly from `wsl.exe --list --online`.
pub async fn get_available_wsl_distros() -> Vec<WslOnlineDistro> {
    #[cfg(windows)]
    {
        if let Ok(lock) = ONLINE_DISTROS_CACHE.lock() {
            if let Some((instant, ref cached)) = *lock {
                if instant.elapsed() < Duration::from_secs(60) && !cached.is_empty() {
                    return cached.clone();
                }
            }
        }

        tokio::task::spawn_blocking(|| {
            let mut cmd = std::process::Command::new("wsl.exe");
            cmd.args(["--list", "--online"]);
            cmd.creation_flags(CREATE_NO_WINDOW);

            let output = cmd.output();

            let mut list = Vec::new();
            if let Ok(res) = output {
                if res.status.success() {
                    let text = decode_utf16_or_utf8(&res.stdout);
                    let mut header_passed = false;

                    for raw_line in text.lines() {
                        let line = raw_line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        let upper = line.to_uppercase();
                        if upper.starts_with("NAME") && upper.contains("FRIENDLY") {
                            header_passed = true;
                            continue;
                        }
                        if !header_passed {
                            continue;
                        }
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if !parts.is_empty() {
                            let name = parts[0].to_string();
                            let friendly_name = if parts.len() > 1 {
                                parts[1..].join(" ")
                            } else {
                                name.clone()
                            };
                            list.push(WslOnlineDistro { name, friendly_name });
                        }
                    }
                }
            }

            if !list.is_empty() {
                if let Ok(mut lock) = ONLINE_DISTROS_CACHE.lock() {
                    *lock = Some((Instant::now(), list.clone()));
                }
            }

            list
        })
        .await
        .unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Imports a tar/tar.gz/vhdx archive as a new WSL distribution.
pub async fn import_wsl_distro(
    distro_name: &str,
    install_location: &str,
    file_path: &str,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let name = distro_name.trim().to_string();
        if name.is_empty() {
            return Err("Distribution name cannot be empty".into());
        }
        let file = file_path.trim().to_string();
        if file.is_empty() {
            return Err("Image file path cannot be empty".into());
        }

        let mut location = install_location.trim().to_string();
        if location.is_empty() {
            if let Some(user_prof) = std::env::var_os("USERPROFILE") {
                let p = std::path::PathBuf::from(user_prof).join("WSL").join(&name);
                location = p.to_string_lossy().to_string();
            } else {
                location = format!("C:\\WSL\\{}", name);
            }
        }

        tokio::task::spawn_blocking(move || {
            let _ = std::fs::create_dir_all(&location);
            let is_vhdx = file.to_lowercase().ends_with(".vhdx") || file.to_lowercase().ends_with(".vhd");

            let mut cmd = std::process::Command::new("wsl.exe");
            cmd.creation_flags(CREATE_NO_WINDOW);
            if is_vhdx {
                cmd.args(["--import", &name, &location, &file, "--vhd", "--version", "2"]);
            } else {
                cmd.args(["--import", &name, &location, &file, "--version", "2"]);
            }

            let res = cmd.output().map_err(|e| format!("Failed to execute wsl --import: {}", e))?;
            if !res.status.success() {
                let err_msg = decode_utf16_or_utf8(&res.stderr);
                let out_msg = decode_utf16_or_utf8(&res.stdout);
                let combined = format!("{} {}", err_msg.trim(), out_msg.trim()).trim().to_string();
                return Err(if !combined.is_empty() {
                    combined
                } else {
                    "wsl.exe --import exited with failure".to_string()
                });
            }
            clear_running_distro_cache();
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (distro_name, install_location, file_path);
        Err("WSL is supported only on Windows".into())
    }
}

/// Unregisters/deletes a WSL distribution.
pub async fn unregister_wsl_distro(distro_name: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let name = distro_name.to_string();
        tokio::task::spawn_blocking(move || {
            let mut cmd = std::process::Command::new("wsl.exe");
            cmd.args(["--unregister", &name]);
            cmd.creation_flags(CREATE_NO_WINDOW);

            let res = cmd.output()
                .map_err(|e| format!("Failed to unregister WSL distro '{}': {}", name, e))?;

            clear_running_distro_cache();

            if !res.status.success() {
                let err_msg = decode_utf16_or_utf8(&res.stderr);
                return Err(format!("WSL unregister error: {}", err_msg.trim()));
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = distro_name;
        Err("WSL is supported only on Windows".into())
    }
}

/// Creates a pre-populated HostConfig bookmark for a WSL distribution.
pub fn create_wsl_host_config(distro: &WslDistro) -> HostConfig {
    HostConfig {
        id: format!("wsl-{}", distro.name.to_lowercase().replace(' ', "-")),
        name: format!("{} (WSL)", distro.name),
        host: "127.0.0.1".into(),
        port: 22,
        user: if distro.default_uid == 0 { "root".into() } else { "user".into() },
        auth_type: "key".into(),
        key_path: None,
        password: None,
        has_docker: false,
        icon: "\u{f17c}".into(), // Font Awesome Linux penguin
        docker_port: None,
        enable_port_scan: false,
        mac_address: None,
        cloud_provider: None,
        cloud_project_id: None,
        cloud_zone: None,
        cloud_instance_id: None,
        network_route: Some("direct".into()),
        protocol: Some(format!("wsl:{}", distro.name)),
    }
}


