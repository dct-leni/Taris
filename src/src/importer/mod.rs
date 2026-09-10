use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedHost {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_type: String,
    pub key_path: Option<String>,
    pub icon: String,
    pub source: String, // "openssh", "putty", "kitty", "termius", "mobaxterm", "filezilla", "wsl"
}

pub fn get_user_home() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

/// Parses OpenSSH config file syntax into candidate hosts
pub fn parse_openssh_config(content: &str) -> Vec<ImportedHost> {
    let mut hosts = Vec::new();
    let mut current_host: Option<ImportedHost> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let mut tokens = trimmed.split_whitespace();
        let key = tokens.next().unwrap_or("").to_lowercase();
        let value = tokens.collect::<Vec<&str>>().join(" ");

        if key == "host" {
            // If wildcards or multiple patterns, skip generic blocks
            if value.contains('*') || value.contains('?') {
                if let Some(h) = current_host.take() {
                    if !h.host.is_empty() {
                        hosts.push(h);
                    }
                }
                continue;
            }

            if let Some(h) = current_host.take() {
                if !h.host.is_empty() {
                    hosts.push(h);
                }
            }

            current_host = Some(ImportedHost {
                id: format!("import-ssh-{}", hosts.len() + 1),
                name: value.clone(),
                host: value,
                port: 22,
                user: "root".to_string(),
                auth_type: "key".to_string(),
                key_path: None,
                icon: "\u{f233}".to_string(),
                source: "openssh".to_string(),
            });
        } else if let Some(ref mut h) = current_host {
            match key.as_str() {
                "hostname" => h.host = value,
                "user" => h.user = value,
                "port" => {
                    if let Ok(p) = value.parse::<u16>() {
                        h.port = p;
                    }
                }
                "identityfile" => {
                    h.key_path = Some(value.replace('~', "%USERPROFILE%"));
                    h.auth_type = "key".to_string();
                }
                _ => {}
            }
        }
    }

    if let Some(h) = current_host {
        if !h.host.is_empty() {
            hosts.push(h);
        }
    }

    hosts
}

/// Detects and parses OpenSSH config from default system paths
pub fn detect_openssh_hosts() -> Vec<ImportedHost> {
    let mut paths = Vec::new();
    if let Some(home) = get_user_home() {
        paths.push(home.join(".ssh").join("config"));
    }
    if cfg!(windows) {
        paths.push(PathBuf::from("C:\\ProgramData\\ssh\\ssh_config"));
    } else {
        paths.push(PathBuf::from("/etc/ssh/ssh_config"));
    }

    for path in paths {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let parsed = parse_openssh_config(&content);
                if !parsed.is_empty() {
                    return parsed;
                }
            }
        }
    }
    Vec::new()
}

/// Reads Windows PuTTY / KiTTY sessions from the Registry
#[cfg(windows)]
pub fn detect_putty_hosts() -> Vec<ImportedHost> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut hosts = Vec::new();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // 1. PuTTY
    if let Ok(sessions) = hkcu.open_subkey("Software\\SimonTatham\\PuTTY\\Sessions") {
        for name in sessions.enum_keys().filter_map(|k| k.ok()) {
            if name == "Default%20Settings" {
                continue;
            }
            if let Ok(sess_key) = sessions.open_subkey(&name) {
                let host_name: String = sess_key.get_value("HostName").unwrap_or_default();
                if host_name.is_empty() {
                    continue;
                }
                let port: u32 = sess_key.get_value("PortNumber").unwrap_or(22);
                let user_name: String = sess_key.get_value("UserName").unwrap_or_else(|_| "root".into());
                let key_file: String = sess_key.get_value("PublicKeyFile").unwrap_or_default();
                let clean_name = name.replace("%20", " ");

                hosts.push(ImportedHost {
                    id: format!("import-putty-{}", hosts.len() + 1),
                    name: clean_name,
                    host: host_name,
                    port: port as u16,
                    user: if user_name.is_empty() { "root".into() } else { user_name },
                    auth_type: if key_file.is_empty() { "password".into() } else { "key".into() },
                    key_path: if key_file.is_empty() { None } else { Some(key_file) },
                    icon: "\u{f233}".into(),
                    source: "putty".into(),
                });
            }
        }
    }

    // 2. KiTTY
    if let Ok(sessions) = hkcu.open_subkey("Software\\9bis.com\\KiTTY\\Sessions") {
        for name in sessions.enum_keys().filter_map(|k| k.ok()) {
            if name == "Default%20Settings" {
                continue;
            }
            if let Ok(sess_key) = sessions.open_subkey(&name) {
                let host_name: String = sess_key.get_value("HostName").unwrap_or_default();
                if host_name.is_empty() {
                    continue;
                }
                let port: u32 = sess_key.get_value("PortNumber").unwrap_or(22);
                let user_name: String = sess_key.get_value("UserName").unwrap_or_else(|_| "root".into());
                let key_file: String = sess_key.get_value("PublicKeyFile").unwrap_or_default();
                let clean_name = name.replace("%20", " ");

                hosts.push(ImportedHost {
                    id: format!("import-kitty-{}", hosts.len() + 1),
                    name: format!("{} (KiTTY)", clean_name),
                    host: host_name,
                    port: port as u16,
                    user: if user_name.is_empty() { "root".into() } else { user_name },
                    auth_type: if key_file.is_empty() { "password".into() } else { "key".into() },
                    key_path: if key_file.is_empty() { None } else { Some(key_file) },
                    icon: "\u{f233}".into(),
                    source: "kitty".into(),
                });
            }
        }
    }

    hosts
}

#[cfg(not(windows))]
pub fn detect_putty_hosts() -> Vec<ImportedHost> {
    Vec::new()
}

/// Parses MobaXterm .ini sessions
pub fn parse_mobaxterm_ini(content: &str) -> Vec<ImportedHost> {
    let mut hosts = Vec::new();
    let mut in_bookmarks = false;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_bookmarks = trimmed.eq_ignore_ascii_case("[Bookmarks]") || trimmed.contains("Bookmark");
            continue;
        }

        if in_bookmarks && trimmed.contains('=') {
            let mut parts = trimmed.splitn(2, '=');
            let name = parts.next().unwrap_or("").trim();
            let val = parts.next().unwrap_or("").trim();

            if val.starts_with("#109#") || val.contains('%') {
                let fields: Vec<&str> = val.split('%').collect();
                if fields.len() >= 3 {
                    let host = fields[1].trim();
                    let port = fields[2].trim().parse::<u16>().unwrap_or(22);
                    let user = if fields.len() > 3 && !fields[3].trim().is_empty() {
                        fields[3].trim()
                    } else {
                        "root"
                    };

                    if !host.is_empty() {
                        hosts.push(ImportedHost {
                            id: format!("import-moba-{}", hosts.len() + 1),
                            name: name.to_string(),
                            host: host.to_string(),
                            port,
                            user: user.to_string(),
                            auth_type: "password".to_string(),
                            key_path: None,
                            icon: "\u{f233}".to_string(),
                            source: "mobaxterm".to_string(),
                        });
                    }
                }
            }
        }
    }

    hosts
}

/// Parses FileZilla sitemanager.xml file
pub fn parse_filezilla_xml(content: &str) -> Vec<ImportedHost> {
    let mut hosts = Vec::new();

    for block in content.split("<Server>") {
        if !block.contains("</Server>") {
            continue;
        }

        let extract_tag = |tag: &str| -> Option<String> {
            let open = format!("<{}>", tag);
            let close = format!("</{}>", tag);
            if let Some(start) = block.find(&open) {
                if let Some(end) = block[start + open.len()..].find(&close) {
                    return Some(block[start + open.len()..start + open.len() + end].trim().to_string());
                }
            }
            None
        };

        let host = extract_tag("Host");
        if let Some(h) = host {
            if h.is_empty() {
                continue;
            }
            let name = extract_tag("Name").unwrap_or_else(|| h.clone());
            let port = extract_tag("Port").and_then(|p| p.parse::<u16>().ok()).unwrap_or(22);
            let user = extract_tag("User").unwrap_or_else(|| "root".into());
            let key_file = extract_tag("Keyfile");

            hosts.push(ImportedHost {
                id: format!("import-filezilla-{}", hosts.len() + 1),
                name,
                host: h,
                port,
                user,
                auth_type: if key_file.is_some() { "key".into() } else { "password".into() },
                key_path: key_file,
                icon: "\u{f233}".into(),
                source: "filezilla".into(),
            });
        }
    }

    hosts
}

/// Detects FileZilla XML config from user profile
pub fn detect_filezilla_hosts() -> Vec<ImportedHost> {
    let mut paths = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        paths.push(PathBuf::from(appdata).join("FileZilla").join("sitemanager.xml"));
    }
    if let Some(home) = get_user_home() {
        paths.push(home.join(".config").join("filezilla").join("sitemanager.xml"));
    }

    for path in paths {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                let parsed = parse_filezilla_xml(&content);
                if !parsed.is_empty() {
                    return parsed;
                }
            }
        }
    }
    Vec::new()
}

/// Parses Termius JSON export
pub fn parse_termius_json(content: &str) -> Vec<ImportedHost> {
    let mut hosts = Vec::new();

    if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
        let items = if let Some(arr) = val.as_array() {
            arr.clone()
        } else if let Some(arr) = val.get("items").and_then(|v| v.as_array()) {
            arr.clone()
        } else if let Some(arr) = val.get("hosts").and_then(|v| v.as_array()) {
            arr.clone()
        } else {
            Vec::new()
        };

        for item in items {
            let label = item.get("label").and_then(|v| v.as_str()).unwrap_or("");
            let address = item.get("address").and_then(|v| v.as_str())
                .or_else(|| item.get("host").and_then(|v| v.as_str()))
                .unwrap_or("");
            let username = item.get("username").and_then(|v| v.as_str())
                .or_else(|| item.get("user").and_then(|v| v.as_str()))
                .unwrap_or("root");
            let port = item.get("port").and_then(|v| v.as_u64()).unwrap_or(22) as u16;

            if !address.is_empty() {
                hosts.push(ImportedHost {
                    id: format!("import-termius-{}", hosts.len() + 1),
                    name: if label.is_empty() { address.to_string() } else { label.to_string() },
                    host: address.to_string(),
                    port,
                    user: username.to_string(),
                    auth_type: "key".to_string(),
                    key_path: None,
                    icon: "\u{f233}".to_string(),
                    source: "termius".to_string(),
                });
            }
        }
    }

    hosts
}

/// Detects installed WSL distributions
pub fn detect_wsl_hosts() -> Vec<ImportedHost> {
    if !cfg!(windows) {
        return Vec::new();
    }

    let output = match std::process::Command::new("wsl.exe").args(["-l", "-q"]).output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };

    if !output.status.success() {
        return Vec::new();
    }

    // WSL -l -q outputs UTF-16LE with null bytes
    let raw = &output.stdout;
    let text = if raw.len() >= 2 && raw[1] == 0 {
        let u16_vec: Vec<u16> = raw
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16_lossy(&u16_vec)
    } else {
        String::from_utf8_lossy(raw).to_string()
    };

    let mut hosts = Vec::new();
    for line in text.lines() {
        let name = line.trim().replace('\0', "");
        if name.is_empty() || name.eq_ignore_ascii_case("docker-desktop") || name.eq_ignore_ascii_case("docker-desktop-data") {
            continue;
        }

        let icon = if name.to_lowercase().contains("ubuntu") {
            "ubuntu"
        } else if name.to_lowercase().contains("debian") {
            "debian"
        } else if name.to_lowercase().contains("arch") {
            "archlinux"
        } else if name.to_lowercase().contains("kali") {
            "kali"
        } else {
            "linux"
        };

        hosts.push(ImportedHost {
            id: format!("import-wsl-{}", name.to_lowercase().replace(' ', "-")),
            name: format!("WSL: {}", name),
            host: "127.0.0.1".into(),
            port: 22,
            user: "root".into(),
            auth_type: "key".into(),
            key_path: None,
            icon: icon.into(),
            source: "wsl".into(),
        });
    }

    hosts
}

#[tauri::command]
pub async fn detect_all_importable_hosts() -> Result<Vec<ImportedHost>, String> {
    let mut all = Vec::new();

    all.extend(detect_openssh_hosts());
    all.extend(detect_putty_hosts());
    all.extend(detect_filezilla_hosts());
    all.extend(detect_wsl_hosts());

    // Deduplicate candidates by host + port + user
    let mut unique = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for h in all {
        let key = format!("{}:{}:{}", h.host.to_lowercase(), h.port, h.user.to_lowercase());
        if !seen.contains(&key) {
            seen.insert(key);
            unique.push(h);
        }
    }

    Ok(unique)
}

#[tauri::command]
pub async fn parse_imported_host_file(format: String, content: String) -> Result<Vec<ImportedHost>, String> {
    match format.to_lowercase().as_str() {
        "openssh" | "ssh" | "config" => Ok(parse_openssh_config(&content)),
        "termius" | "json" => Ok(parse_termius_json(&content)),
        "mobaxterm" | "ini" => Ok(parse_mobaxterm_ini(&content)),
        "filezilla" | "xml" => Ok(parse_filezilla_xml(&content)),
        _ => {
            // Auto-detect format by content
            if content.contains("<Server>") && content.contains("</Server>") {
                Ok(parse_filezilla_xml(&content))
            } else if content.trim_start().starts_with('[') || content.trim_start().starts_with('{') {
                Ok(parse_termius_json(&content))
            } else if content.contains("[Bookmarks]") || content.contains("#109#") {
                Ok(parse_mobaxterm_ini(&content))
            } else {
                Ok(parse_openssh_config(&content))
            }
        }
    }
}
