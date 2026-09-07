use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Emitter;
use crate::{is_command_in_path, open_ssh2_session, parse_command_line, resolve_sftp_path, HostConfig};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiscoveredEditor {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub fn discover_external_editors() -> Vec<DiscoveredEditor> {
    let mut editors = Vec::new();
    let mut added_ids = std::collections::HashSet::new();

    let known_editors: &[(&str, &str, &str)] = &[
        ("zed", "zed", "Zed"),
        ("code", "code", "Visual Studio Code"),
        ("subl", "subl", "Sublime Text"),
        ("cursor", "cursor", "Cursor"),
        ("nvim", "nvim", "Neovim"),
        ("vim", "vim", "Vim"),
        ("nano", "nano", "Nano"),
        ("notepadplusplus", "notepad++", "Notepad++"),
        ("notepad", "notepad", "Notepad"),
        ("gedit", "gedit", "GNOME Text Editor"),
        ("kate", "kate", "Kate"),
    ];

    for &(id, cmd, name) in known_editors {
        if is_command_in_path(cmd) {
            editors.push(DiscoveredEditor {
                id: id.into(),
                name: name.into(),
                path: cmd.into(),
            });
            added_ids.insert(id.to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let program_files = std::env::var("ProgramFiles").unwrap_or_default();
        let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

        if !added_ids.contains("zed") {
            let zed_candidates = [
                PathBuf::from(&local_app_data).join("Programs").join("Zed").join("bin").join("Zed.exe"),
                PathBuf::from(&local_app_data).join("Programs").join("Zed").join("Zed.exe"),
                PathBuf::from(&program_files).join("Zed").join("Zed.exe"),
            ];
            for p in &zed_candidates {
                if p.exists() {
                    editors.push(DiscoveredEditor {
                        id: "zed".into(),
                        name: "Zed".into(),
                        path: "zed".into(),
                    });
                    added_ids.insert("zed".into());
                    break;
                }
            }
        }

        if !added_ids.contains("code") {
            let code_candidates = [
                PathBuf::from(&local_app_data).join("Programs").join("Microsoft VS Code").join("Code.exe"),
                PathBuf::from(&program_files).join("Microsoft VS Code").join("Code.exe"),
            ];
            for p in &code_candidates {
                if p.exists() {
                    editors.push(DiscoveredEditor {
                        id: "code".into(),
                        name: "Visual Studio Code".into(),
                        path: "code".into(),
                    });
                    added_ids.insert("code".into());
                    break;
                }
            }
        }

        if !added_ids.contains("notepadplusplus") {
            let npp_candidates = [
                PathBuf::from(&program_files).join("Notepad++").join("notepad++.exe"),
                PathBuf::from(&program_files_x86).join("Notepad++").join("notepad++.exe"),
            ];
            for p in &npp_candidates {
                if p.exists() {
                    editors.push(DiscoveredEditor {
                        id: "notepadplusplus".into(),
                        name: "Notepad++".into(),
                        path: "notepad++".into(),
                    });
                    added_ids.insert("notepadplusplus".into());
                    break;
                }
            }
        }

        if !added_ids.contains("notepad") {
            let notepad_path = PathBuf::from("C:\\Windows\\notepad.exe");
            if notepad_path.exists() {
                editors.push(DiscoveredEditor {
                    id: "notepad".into(),
                    name: "Notepad".into(),
                    path: "notepad".into(),
                });
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if !added_ids.contains("zed") && Path::new("/Applications/Zed.app").exists() {
            editors.push(DiscoveredEditor {
                id: "zed".into(),
                name: "Zed".into(),
                path: "zed".into(),
            });
        }
        if !added_ids.contains("code") && Path::new("/Applications/Visual Studio Code.app").exists() {
            editors.push(DiscoveredEditor {
                id: "code".into(),
                name: "Visual Studio Code".into(),
                path: "code".into(),
            });
        }
    }

    editors
}

#[tauri::command]
pub fn open_in_external_editor(
    app_handle: tauri::AppHandle,
    host: Option<HostConfig>,
    remote_path: Option<String>,
    local_path: Option<String>,
    editor_path: Option<String>,
) -> Result<String, String> {
    let editor = match editor_path {
        Some(ref p) if !p.trim().is_empty() => p.trim().to_string(),
        _ => {
            let discovered = discover_external_editors();
            discovered.first().map(|e| e.path.clone()).unwrap_or_else(|| {
                #[cfg(target_os = "windows")]
                { "notepad".to_string() }
                #[cfg(target_os = "macos")]
                { "open -t".to_string() }
                #[cfg(not(any(target_os = "windows", target_os = "macos")))]
                { "nano".to_string() }
            })
        }
    };

    let launch_editor = |target_path: &Path| -> Result<(), String> {
        let parts = parse_command_line(&editor);
        if parts.is_empty() {
            return Err("External editor command is empty".into());
        }
        let mut executable = parts[0].clone();
        if !is_command_in_path(&executable) && !Path::new(&executable).exists() {
            #[cfg(target_os = "windows")]
            {
                if executable.eq_ignore_ascii_case("zed") {
                    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
                    let p = PathBuf::from(&local).join("Programs").join("Zed").join("bin").join("Zed.exe");
                    if p.exists() {
                        executable = p.to_string_lossy().to_string();
                    }
                } else if executable.eq_ignore_ascii_case("code") {
                    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
                    let p = PathBuf::from(&local).join("Programs").join("Microsoft VS Code").join("Code.exe");
                    if p.exists() {
                        executable = p.to_string_lossy().to_string();
                    }
                }
            }
        }
        let mut cmd = std::process::Command::new(&executable);
        if parts.len() > 1 {
            cmd.args(&parts[1..]);
        }
        cmd.arg(target_path);
        cmd.spawn()
            .map_err(|e| format!("Failed to launch external editor '{}': {}", editor, e))?;
        Ok(())
    };

    if let Some(lpath) = local_path {
        launch_editor(Path::new(&lpath))?;
        return Ok(format!("Opened '{}' in external editor", lpath));
    }

    if let (Some(h), Some(rpath)) = (host, remote_path) {
        let sess = open_ssh2_session(&h)?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP initialization failed: {}", e))?;

        let resolved_remote = resolve_sftp_path(&sftp, &rpath);
        let file_name = Path::new(&resolved_remote)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file.txt")
            .to_string();

        let temp_dir = std::env::temp_dir().join("taris_external_cache").join(&h.id);
        std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
        let local_temp_file = temp_dir.join(&file_name);

        let mut remote_file = sftp.open(Path::new(&resolved_remote))
            .map_err(|e| format!("Failed to open remote file '{}': {}", resolved_remote, e))?;

        let mut content = Vec::new();
        remote_file.read_to_end(&mut content)
            .map_err(|e| format!("Failed to read remote file: {}", e))?;

        std::fs::write(&local_temp_file, &content)
            .map_err(|e| format!("Failed to write cache file: {}", e))?;

        let initial_mtime = std::fs::metadata(&local_temp_file)
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::now());

        launch_editor(&local_temp_file)?;

        // Background auto-sync watcher
        let watcher_host = h.clone();
        let watcher_remote = resolved_remote.clone();
        let watcher_local = local_temp_file.clone();
        let watcher_name = file_name.clone();
        let app = app_handle.clone();

        std::thread::spawn(move || {
            use std::time::Duration;
            let mut last_mtime = initial_mtime;
            for _ in 0..7200 {
                std::thread::sleep(Duration::from_millis(1000));
                if !watcher_local.exists() {
                    break;
                }
                if let Ok(meta) = std::fs::metadata(&watcher_local) {
                    if let Ok(mtime) = meta.modified() {
                        if mtime > last_mtime {
                            last_mtime = mtime;
                            if let Ok(new_bytes) = std::fs::read(&watcher_local) {
                                if let Ok(sess) = open_ssh2_session(&watcher_host) {
                                    if let Ok(sftp) = sess.sftp() {
                                        let flags = ssh2::OpenFlags::WRITE | ssh2::OpenFlags::TRUNCATE | ssh2::OpenFlags::CREATE;
                                        if let Ok(mut rf) = sftp.open_mode(Path::new(&watcher_remote), flags, 0o644, ssh2::OpenType::File) {
                                            if rf.write_all(&new_bytes).is_ok() {
                                                let _ = app.emit("file-synced-remote", serde_json::json!({
                                                    "fileName": watcher_name,
                                                    "hostName": watcher_host.name,
                                                    "remotePath": watcher_remote,
                                                }));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        return Ok(format!("Opened '{}' in external editor (auto-sync active)", file_name));
    }

    Err("Missing file path or host for external editor".to_string())
}