use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KeyPermissionStatus {
    pub path: String,
    pub full_path: String,
    pub exists: bool,
    pub too_open: bool,
    pub details: String,
}

pub fn resolve_ssh_key_path(raw_path: &str) -> PathBuf {
    let trimmed = raw_path.trim().trim_matches('"');
    if trimmed.starts_with('~') {
        #[cfg(windows)]
        let home = std::env::var("USERPROFILE").ok();
        #[cfg(not(windows))]
        let home = std::env::var("HOME").ok();

        if let Some(h) = home {
            let without_tilde = trimmed.trim_start_matches('~').trim_start_matches(['/', '\\']);
            return PathBuf::from(h).join(without_tilde);
        }
    }
    let p = PathBuf::from(trimmed);
    if p.is_absolute() {
        return p;
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let direct = cwd.join(&p);
    if direct.exists() {
        return direct;
    }
    if let Some(parent) = cwd.parent() {
        let in_parent = parent.join(&p);
        if in_parent.exists() {
            return in_parent;
        }
    }
    direct
}

#[tauri::command]
pub fn check_ssh_key_permissions(path: String) -> Result<KeyPermissionStatus, String> {
    let full = resolve_ssh_key_path(&path);
    if !full.exists() {
        return Ok(KeyPermissionStatus {
            path,
            full_path: full.to_string_lossy().to_string(),
            exists: false,
            too_open: false,
            details: "File does not exist on disk".to_string(),
        });
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
        let mode = meta.permissions().mode() & 0o777;
        let too_open = (mode & 0o077) != 0;
        let details = if too_open {
            format!("Permissions 0{:o} are too open: group/others have access. OpenSSH requires 0600 (owner only).", mode)
        } else {
            format!("Permissions 0{:o} secured (restricted to owner only).", mode)
        };
        Ok(KeyPermissionStatus {
            path,
            full_path: full.to_string_lossy().to_string(),
            exists: true,
            too_open,
            details,
        })
    }

    #[cfg(windows)]
    {
        let win_path = full.to_string_lossy().replace('/', "\\");
        let output = std::process::Command::new("icacls")
            .arg(&win_path)
            .output()
            .map_err(|e| format!("Failed to execute icacls: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut ace_lines = Vec::new();
        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Successfully processed") || trimmed.is_empty() {
                continue;
            }
            let content = if let Some(stripped) = trimmed.strip_prefix(&win_path) {
                stripped.trim()
            } else {
                trimmed
            };
            if !content.is_empty() {
                ace_lines.push(content);
            }
        }
        let aces_text = ace_lines.join("\n");
        let has_inheritance = aces_text.contains(":(I)") || aces_text.contains(":(I)(");
        let lower = aces_text.to_lowercase();
        let has_everyone = lower.contains("everyone")
            || lower.contains("builtin\\users")
            || lower.contains("\\users:")
            || lower.contains("authenticated users")
            || aces_text.contains("S-1-15-");

        let too_open = has_inheritance || has_everyone;
        let details = if too_open {
            if has_inheritance {
                "Inherited permissions detected. OpenSSH requires inheritance to be disabled.".to_string()
            } else {
                "Key file is accessible by other users or groups. OpenSSH requires owner-only access.".to_string()
            }
        } else {
            "Permissions secured (restricted to owner/system only, no inherited access).".to_string()
        };

        Ok(KeyPermissionStatus {
            path,
            full_path: win_path,
            exists: true,
            too_open,
            details,
        })
    }

    #[cfg(not(any(unix, windows)))]
    {
        Ok(KeyPermissionStatus {
            path,
            full_path: full.to_string_lossy().to_string(),
            exists: true,
            too_open: false,
            details: "Permissions check not required for this OS".to_string(),
        })
    }
}

#[tauri::command]
pub fn fix_ssh_key_permissions(path: String) -> Result<KeyPermissionStatus, String> {
    let full = resolve_ssh_key_path(&path);
    if !full.exists() {
        return Err(format!("Private key file not found: {}", full.display()));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&full, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to chmod 600: {}", e))?;
    }

    #[cfg(windows)]
    {
        let win_path = full.to_string_lossy().replace('/', "\\");
        let username = std::env::var("USERNAME").unwrap_or_else(|_| "CURRENT_USER".into());
        let grant_arg = format!("{}:(F)", username);

        let _ = std::process::Command::new("takeown")
            .arg("/F")
            .arg(&win_path)
            .output();

        let out = std::process::Command::new("icacls")
            .arg(&win_path)
            .args([
                "/inheritance:r",
                "/grant:r",
                &grant_arg,
                "/remove:g",
                "Everyone",
                "/remove:g",
                "BUILTIN\\Users",
                "/remove:g",
                "Users",
                "/remove:g",
                "Authenticated Users",
            ])
            .output()
            .map_err(|e| format!("icacls execution failed: {}", e))?;

        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("Failed to secure key permissions: {}", err));
        }
    }

    check_ssh_key_permissions(path)
}

#[tauri::command]
pub async fn pick_ssh_key_file() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        let mut dialog = rfd::FileDialog::new()
            .set_title("Select SSH Private Key")
            .add_filter("All Files (*.*)", &["*"])
            .add_filter("SSH Keys (*.pem, *.ppk, *.key)", &["pem", "ppk", "key"]);

        let cwd = std::env::current_dir().unwrap_or_default();
        let local_ssh = cwd.join(".ssh");
        if local_ssh.exists() {
            dialog = dialog.set_directory(&local_ssh);
        } else {
            #[cfg(windows)]
            if let Ok(userprofile) = std::env::var("USERPROFILE") {
                let user_ssh = PathBuf::from(userprofile).join(".ssh");
                if user_ssh.exists() {
                    dialog = dialog.set_directory(&user_ssh);
                }
            }
            #[cfg(not(windows))]
            if let Ok(home) = std::env::var("HOME") {
                let user_ssh = PathBuf::from(home).join(".ssh");
                if user_ssh.exists() {
                    dialog = dialog.set_directory(&user_ssh);
                }
            }
        }

        let picked = dialog.pick_file();
        if let Some(path) = picked {
            if let Ok(rel) = path.strip_prefix(&cwd) {
                Ok(Some(rel.to_string_lossy().replace('\\', "/")))
            } else {
                Ok(Some(path.to_string_lossy().to_string()))
            }
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
