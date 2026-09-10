use crate::{AppState, HostConfig, RealFileItem};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteDirList {
    pub current_path: String,
    pub files: Vec<RealFileItem>,
}

/// Canonicalizes and resolves remote SFTP paths asynchronously.
pub async fn resolve_sftp_path(sftp: &russh_sftp::client::SftpSession, path: &str) -> String {
    let p = path.trim();
    if p.is_empty() || p == "~" || p == "." {
        return match sftp.canonicalize(".").await {
            Ok(canon) => {
                let clean = canon.replace('\\', "/");
                let trimmed = clean.trim_end_matches('/');
                if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() }
            }
            Err(_) => "/".to_string(),
        };
    }
    if p.starts_with("~/") {
        if let Ok(canon) = sftp.canonicalize(".").await {
            let rel = &p[2..];
            let canon_clean = canon.trim_end_matches(['/', '\\']);
            let joined = format!("{}/{}", canon_clean, rel).replace('\\', "/");
            let trimmed = joined.trim_end_matches('/');
            return if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() };
        }
    }
    if !p.starts_with('/') {
        if let Ok(canon) = sftp.canonicalize(".").await {
            let canon_clean = canon.trim_end_matches(['/', '\\']);
            let joined = format!("{}/{}", canon_clean, p).replace('\\', "/");
            let trimmed = joined.trim_end_matches('/');
            return if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() };
        }
    }
    if let Ok(canon) = sftp.canonicalize(p).await {
        let clean = canon.replace('\\', "/");
        let trimmed = clean.trim_end_matches('/');
        return if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() };
    }
    let clean = p.replace('\\', "/");
    let trimmed = clean.trim_end_matches('/');
    if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() }
}

pub fn parse_ls_output(output: &str, base_path: &str) -> Vec<RealFileItem> {
    let mut files = Vec::new();
    let clean_base = base_path.trim().trim_end_matches('/');

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("total ") {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 8 {
            continue;
        }

        let perms = parts[0];
        let is_dir = perms.starts_with('d');
        let size_raw = parts[4].parse::<u64>().unwrap_or(0);

        let (name_index, modified) = if let Ok(epoch) = parts[5].parse::<i64>() {
            let dt_str = chrono::DateTime::from_timestamp(epoch, 0)
                .map(|dt| dt.format("%d/%m/%Y %H:%M").to_string())
                .unwrap_or_else(|| "-".to_string());
            (6, dt_str)
        } else if parts.len() >= 9 {
            let dt_str = format!("{} {} {}", parts[5], parts[6], parts[7]);
            (8, dt_str)
        } else {
            (5, "-".to_string())
        };

        if name_index >= parts.len() {
            continue;
        }

        let name = parts[name_index..].join(" ");
        if name == "." || name == ".." {
            continue;
        }

        let is_db = name.ends_with(".db") || name.ends_with(".sqlite") || name.ends_with(".sqlite3");

        let size = if is_dir {
            "DIR".to_string()
        } else if size_raw < 1024 {
            format!("{} B", size_raw)
        } else if size_raw < 1024 * 1024 {
            format!("{:.1} KB", size_raw as f32 / 1024.0)
        } else {
            format!("{:.1} MB", size_raw as f32 / (1024.0 * 1024.0))
        };

        let path = if clean_base.is_empty() || clean_base == "." {
            name.clone()
        } else {
            format!("{}/{}", clean_base, name)
        };

        files.push(RealFileItem {
            name,
            size,
            modified,
            is_dir,
            is_db,
            path,
        });
    }

    files.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    files
}

pub async fn list_remote_files_ssh_fallback(
    handle: &std::sync::Arc<russh::client::Handle<crate::ssh::client::TarisSshHandler>>,
    path: &str,
) -> Result<RemoteDirList, String> {
    let raw = path.trim();
    let target_dir = if raw.is_empty() || raw == "." {
        "~".to_string()
    } else {
        raw.to_string()
    };

    let escaped = target_dir.replace('"', "\\\"");
    let cmd = format!(
        "p=\"{}\"; [ \"$p\" = \"~\" ] || [ -z \"$p\" ] && p=\"$HOME\"; case \"$p\" in \"~/\"*) p=\"$HOME/${{p#\\~/}}\";; esac; cd \"$p\" 2>/dev/null && pwd && (ls -la --time-style=+%s . 2>/dev/null || ls -la .)",
        escaped
    );

    let stdout = crate::ssh::client::exec_command(handle, &cmd).await?;
    let mut lines = stdout.lines();
    let first_line = lines.next().unwrap_or("").trim();
    let (real_pwd, ls_output) = if first_line.starts_with('/') || first_line.starts_with('\\') {
        (first_line.to_string(), lines.collect::<Vec<&str>>().join("\n"))
    } else {
        (target_dir.clone(), stdout.clone())
    };

    let files = parse_ls_output(&ls_output, &real_pwd);
    Ok(RemoteDirList {
        current_path: real_pwd,
        files,
    })
}

pub async fn read_remote_file_ssh_fallback(
    handle: &std::sync::Arc<russh::client::Handle<crate::ssh::client::TarisSshHandler>>,
    path: &str,
) -> Result<String, String> {
    use base64::Engine;
    let escaped = path.replace('"', "\\\"");
    let cmd = format!(
        "p=\"{}\"; [ \"$p\" = \"~\" ] || [ -z \"$p\" ] && p=\"$HOME\"; case \"$p\" in \"~/\"*) p=\"$HOME/${{p#\\~/}}\";; esac; (base64 \"$p\" 2>/dev/null || cat \"$p\")",
        escaped
    );
    let stdout = crate::ssh::client::exec_command(handle, &cmd).await?;
    let clean_b64: String = stdout.chars().filter(|c| !c.is_whitespace()).collect();
    if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(&clean_b64) {
        if let Ok(utf8) = String::from_utf8(decoded) {
            return Ok(utf8);
        }
    }

    Ok(stdout)
}

pub async fn write_remote_file_ssh_fallback(
    handle: &std::sync::Arc<russh::client::Handle<crate::ssh::client::TarisSshHandler>>,
    path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    let cmd = format!(
        "echo \"{}\" | base64 -d > \"{}\"",
        b64,
        path.replace('"', "\\\"")
    );
    let _ = crate::ssh::client::exec_command(handle, &cmd).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_remote_files(
    state: tauri::State<'_, AppState>,
    host: HostConfig,
    remote_path: Option<String>,
) -> Result<RemoteDirList, String> {
    if let Ok(sftp) = state.get_sftp_session(&host).await {
        let resolved_path = resolve_sftp_path(&sftp, remote_path.as_deref().unwrap_or("")).await;

        match sftp.read_dir(&resolved_path).await {
            Ok(entries) => {
                let mut files = Vec::new();

                for entry in entries {
                    let name = entry.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }

                    let is_dir = entry.file_type().is_dir();
                    let is_db = name.ends_with(".db") || name.ends_with(".sqlite") || name.ends_with(".sqlite3");

                    let size = if is_dir {
                        "DIR".to_string()
                    } else if let Some(bytes) = entry.metadata().size {
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

                    let modified = if let Some(mtime) = entry.metadata().mtime {
                        use chrono::TimeZone;
                        if let Some(dt) = chrono::Local.timestamp_opt(mtime as i64, 0).single() {
                            dt.format("%d/%m/%Y %H:%M").to_string()
                        } else {
                            "-".to_string()
                        }
                    } else {
                        "-".to_string()
                    };

                    let full_path = if resolved_path == "/" {
                        format!("/{}", name)
                    } else if resolved_path.ends_with('/') {
                        format!("{}{}", resolved_path, name)
                    } else {
                        format!("{}/{}", resolved_path, name)
                    };

                    files.push(RealFileItem {
                        name,
                        size,
                        modified,
                        is_dir,
                        is_db,
                        path: full_path,
                    });
                }

                files.sort_by(|a, b| {
                    if a.is_dir == b.is_dir {
                        a.name.to_lowercase().cmp(&b.name.to_lowercase())
                    } else if a.is_dir {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    }
                });

                return Ok(RemoteDirList {
                    current_path: resolved_path,
                    files,
                });
            }
            Err(err) => {
                crate::log_warn!("sftp", "SFTP read_dir failed on '{}': {:?}, falling back to in-band SSH exec", resolved_path, err);
            }
        }
    }

    // In-band SSH command fallback when SFTP subsystem is blocked or unavailable
    let handle = state.get_russh_session(&host).await?;
    list_remote_files_ssh_fallback(&handle, remote_path.as_deref().unwrap_or(".")).await
}

#[tauri::command]
pub async fn read_remote_file(
    state: tauri::State<'_, AppState>,
    host: HostConfig,
    remote_path: String,
) -> Result<String, String> {
    if let Ok(sftp) = state.get_sftp_session(&host).await {
        let resolved_path = resolve_sftp_path(&sftp, &remote_path).await;

        if let Ok(mut file) = sftp.open(&resolved_path).await {
            let mut bytes = Vec::new();
            if file.read_to_end(&mut bytes).await.is_ok() {
                if let Ok(content) = String::from_utf8(bytes) {
                    return Ok(content);
                }
            }
        }
    }

    // Fallback via SSH command
    let handle = state.get_russh_session(&host).await?;
    read_remote_file_ssh_fallback(&handle, &remote_path).await
}

#[tauri::command]
pub async fn write_remote_file(
    state: tauri::State<'_, AppState>,
    host: HostConfig,
    remote_path: String,
    content: String,
) -> Result<(), String> {
    if let Ok(sftp) = state.get_sftp_session(&host).await {
        let resolved_path = resolve_sftp_path(&sftp, &remote_path).await;

        if let Ok(mut file) = sftp.create(&resolved_path).await {
            if file.write_all(content.as_bytes()).await.is_ok() && file.flush().await.is_ok() {
                return Ok(());
            }
        }
    }

    // Fallback via SSH command
    let handle = state.get_russh_session(&host).await?;
    write_remote_file_ssh_fallback(&handle, &remote_path, content.as_bytes()).await
}

fn calculate_dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                total += std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            } else if path.is_dir() {
                total += calculate_dir_size(&path);
            }
        }
    }
    total
}

pub async fn upload_single_file_stream(
    sftp: &russh_sftp::client::SftpSession,
    local_path: &Path,
    remote_path: &str,
    app_handle: &tauri::AppHandle,
    transfer_id: &str,
    file_display_name: &str,
    transferred: &mut u64,
    total_size: u64,
    start_time: &std::time::Instant,
    last_emit: &mut std::time::Instant,
) -> Result<(), String> {
    let mut remote_file = sftp
        .create(remote_path)
        .await
        .map_err(|e| format!("Failed to create remote file '{}': {}", remote_path, e))?;

    let mut local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| e.to_string())?;

    // High performance: 256KB buffer
    let mut buffer = vec![0u8; 256 * 1024];

    loop {
        let n = local_file
            .read(&mut buffer)
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        remote_file
            .write_all(&buffer[..n])
            .await
            .map_err(|e| e.to_string())?;
        *transferred += n as u64;

        // Throttle progress updates to 100ms to eliminate IPC flooding
        if last_emit.elapsed() >= std::time::Duration::from_millis(100) || *transferred >= total_size {
            let elapsed_sec = start_time.elapsed().as_secs_f64();
            let speed_bps = if elapsed_sec > 0.0 {
                *transferred as f64 / elapsed_sec
            } else {
                0.0
            };
            let speed_str = if speed_bps < 1024.0 * 1024.0 {
                format!("{:.1} KB/s", speed_bps / 1024.0)
            } else {
                format!("{:.1} MB/s", speed_bps / (1024.0 * 1024.0))
            };
            let percent = if total_size > 0 {
                (*transferred as f64 / total_size as f64 * 100.0).round() as u32
            } else {
                100
            };

            let _ = app_handle.emit(
                "transfer-progress",
                serde_json::json!({
                    "transferId": transfer_id,
                    "fileName": file_display_name,
                    "transferred": *transferred,
                    "total": total_size,
                    "speedStr": speed_str,
                    "progressPercent": percent,
                    "direction": "upload",
                    "status": if *transferred >= total_size { "completed" } else { "transferring" }
                }),
            );
            *last_emit = std::time::Instant::now();
        }
    }
    remote_file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn upload_dir_recursive(
    sftp: &russh_sftp::client::SftpSession,
    local_dir: &Path,
    remote_dir: &str,
    app_handle: &tauri::AppHandle,
    transfer_id: &str,
    transferred: &mut u64,
    total_size: u64,
    start_time: &std::time::Instant,
    last_emit: &mut std::time::Instant,
) -> Result<(), String> {
    let _ = sftp.create_dir(remote_dir).await;
    if let Ok(entries) = std::fs::read_dir(local_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let fname = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let remote_child = format!("{}/{}", remote_dir.trim_end_matches('/'), fname);
            if path.is_dir() {
                Box::pin(upload_dir_recursive(
                    sftp,
                    &path,
                    &remote_child,
                    app_handle,
                    transfer_id,
                    transferred,
                    total_size,
                    start_time,
                    last_emit,
                ))
                .await?;
            } else if path.is_file() {
                upload_single_file_stream(
                    sftp,
                    &path,
                    &remote_child,
                    app_handle,
                    transfer_id,
                    &fname,
                    transferred,
                    total_size,
                    start_time,
                    last_emit,
                )
                .await?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn sftp_upload_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    transfer_id: String,
    host: HostConfig,
    local_path: String,
    remote_dest_dir: String,
) -> Result<(), String> {
    let local_file_path = Path::new(&local_path);
    if !local_file_path.exists() {
        return Err(format!("Local file '{}' not found", local_path));
    }

    let sftp = state.get_sftp_session(&host).await?;
    let resolved_dest_dir = resolve_sftp_path(&sftp, &remote_dest_dir).await;

    let file_name = local_file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid local filename".to_string())?
        .to_string();

    let remote_target_path = format!("{}/{}", resolved_dest_dir.trim_end_matches('/'), file_name);

    let mut transferred: u64 = 0;
    let start_time = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    if local_file_path.is_file() {
        let total_size = std::fs::metadata(local_file_path)
            .map_err(|e| e.to_string())?
            .len();

        upload_single_file_stream(
            &sftp,
            local_file_path,
            &remote_target_path,
            &app_handle,
            &transfer_id,
            &file_name,
            &mut transferred,
            total_size,
            &start_time,
            &mut last_emit,
        )
        .await?;
    } else if local_file_path.is_dir() {
        let total_size = calculate_dir_size(local_file_path);
        upload_dir_recursive(
            &sftp,
            local_file_path,
            &remote_target_path,
            &app_handle,
            &transfer_id,
            &mut transferred,
            total_size,
            &start_time,
            &mut last_emit,
        )
        .await?;
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_download_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    transfer_id: String,
    host: HostConfig,
    remote_path: String,
    local_dest_dir: String,
) -> Result<(), String> {
    let sftp = state.get_sftp_session(&host).await?;
    let resolved_remote = resolve_sftp_path(&sftp, &remote_path).await;
    let file_name = Path::new(&resolved_remote)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid remote filename".to_string())?
        .to_string();

    let mut remote_file = sftp
        .open(&resolved_remote)
        .await
        .map_err(|e| format!("Failed to open remote file '{}': {}", resolved_remote, e))?;

    let meta = sftp.metadata(&resolved_remote).await.ok();
    let total_size = meta.and_then(|m| m.size).unwrap_or(0);

    let dest_dir = Path::new(&local_dest_dir);
    if !dest_dir.exists() {
        std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    }
    let local_dest_path = dest_dir.join(&file_name);
    let mut local_file = tokio::fs::File::create(&local_dest_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut buffer = vec![0u8; 256 * 1024];
    let mut transferred: u64 = 0;
    let start_time = std::time::Instant::now();
    let mut last_emit = std::time::Instant::now();

    loop {
        let n = remote_file
            .read(&mut buffer)
            .await
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        local_file
            .write_all(&buffer[..n])
            .await
            .map_err(|e| e.to_string())?;
        transferred += n as u64;

        if last_emit.elapsed() >= std::time::Duration::from_millis(100)
            || (total_size > 0 && transferred >= total_size)
        {
            let elapsed_sec = start_time.elapsed().as_secs_f64();
            let speed_bps = if elapsed_sec > 0.0 {
                transferred as f64 / elapsed_sec
            } else {
                0.0
            };
            let speed_str = if speed_bps < 1024.0 * 1024.0 {
                format!("{:.1} KB/s", speed_bps / 1024.0)
            } else {
                format!("{:.1} MB/s", speed_bps / (1024.0 * 1024.0))
            };
            let percent = if total_size > 0 {
                (transferred as f64 / total_size as f64 * 100.0).round() as u32
            } else {
                100
            };

            let _ = app_handle.emit(
                "transfer-progress",
                serde_json::json!({
                    "transferId": transfer_id,
                    "fileName": file_display_name_or_empty(&file_name),
                    "transferred": transferred,
                    "total": total_size,
                    "speedStr": speed_str,
                    "progressPercent": percent,
                    "direction": "download",
                    "status": if total_size > 0 && transferred >= total_size { "completed" } else { "transferring" }
                }),
            );
            last_emit = std::time::Instant::now();
        }
    }
    local_file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

fn file_display_name_or_empty(name: &str) -> &str {
    if name.is_empty() {
        "file"
    } else {
        name
    }
}

pub async fn delete_remote_recursive(
    sftp: &russh_sftp::client::SftpSession,
    remote_path: &str,
) -> Result<(), String> {
    if let Ok(entries) = sftp.read_dir(remote_path).await {
        for entry in entries {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let child_path = if remote_path.ends_with('/') {
                format!("{}{}", remote_path, name)
            } else {
                format!("{}/{}", remote_path, name)
            };

            if entry.file_type().is_dir() {
                Box::pin(delete_remote_recursive(sftp, &child_path)).await?;
            } else {
                let _ = sftp.remove_file(&child_path).await;
            }
        }
    }
    sftp.remove_dir(remote_path)
        .await
        .map_err(|e| format!("Failed to remove remote directory '{}': {}", remote_path, e))
}

#[tauri::command]
pub async fn delete_remote_file(
    state: tauri::State<'_, AppState>,
    host: HostConfig,
    remote_path: String,
) -> Result<(), String> {
    let sftp = state.get_sftp_session(&host).await?;
    let resolved_path = resolve_sftp_path(&sftp, &remote_path).await;

    if let Ok(meta) = sftp.metadata(&resolved_path).await {
        if meta.file_type().is_dir() {
            return delete_remote_recursive(&sftp, &resolved_path).await;
        }
    }

    sftp.remove_file(&resolved_path)
        .await
        .map_err(|e| format!("Failed to delete remote file '{}': {}", resolved_path, e))
}
