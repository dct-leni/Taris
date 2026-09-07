use crate::{AppState, HostConfig, RealFileItem};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteDirList {
    pub current_path: String,
    pub files: Vec<RealFileItem>,
}

/// Canonicalizes and resolves remote SFTP paths.
pub fn resolve_sftp_path(sftp: &ssh2::Sftp, path: &str) -> String {
    let p = path.trim();
    if p.is_empty() || p == "~" || p == "." {
        return sftp
            .realpath(Path::new("."))
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| "/".to_string());
    }
    if p.starts_with("~/") {
        if let Ok(canon) = sftp.realpath(Path::new(".")) {
            let rel = &p[2..];
            return canon.join(rel).to_string_lossy().replace('\\', "/");
        }
    }
    if !p.starts_with('/') {
        if let Ok(canon) = sftp.realpath(Path::new(".")) {
            return canon.join(p).to_string_lossy().replace('\\', "/");
        }
    }
    p.replace('\\', "/")
}

#[tauri::command]
pub fn list_remote_files(
    state: tauri::State<'_, AppState>,
    host: HostConfig,
    remote_path: Option<String>,
) -> Result<RemoteDirList, String> {
    let sess = state.take_ssh_session(&host)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("Failed to initialize SFTP subsystem: {}", e))?;

    let resolved_path = resolve_sftp_path(&sftp, remote_path.as_deref().unwrap_or(""));
    let target = Path::new(&resolved_path);
    let mut files = Vec::new();

    let entries = match sftp.readdir(target) {
        Ok(e) => e,
        Err(err) => return Err(format!("SFTP readdir failed for '{}': {}", resolved_path, err)),
    };

    for (p, stat) in entries {
        let name = match p.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => continue,
        };

        if name == "." || name == ".." {
            continue;
        }

        let is_dir = stat.is_dir();
        let is_db = name.ends_with(".db") || name.ends_with(".sqlite") || name.ends_with(".sqlite3");

        let size = if is_dir {
            "DIR".to_string()
        } else if let Some(bytes) = stat.size {
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

        let modified = if let Some(mtime) = stat.mtime {
            use chrono::TimeZone;
            if let Some(dt) = chrono::Local.timestamp_opt(mtime as i64, 0).single() {
                dt.format("%d/%m/%Y %H:%M").to_string()
            } else {
                "-".to_string()
            }
        } else {
            "-".to_string()
        };

        let full_path = if resolved_path.ends_with('/') {
            format!("{}{}", resolved_path, name)
        } else {
            format!("{}/{}", resolved_path, name)
        };

        files.push(RealFileItem {
            name,
            path: full_path,
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

    state.return_ssh_session(&host, sess);

    Ok(RemoteDirList {
        current_path: resolved_path,
        files,
    })
}

#[tauri::command]
pub fn read_remote_file(
    state: tauri::State<'_, AppState>,
    host: HostConfig,
    remote_path: String,
) -> Result<String, String> {
    let sess = state.take_ssh_session(&host)?;
    let res = (|| {
        let sftp = sess
            .sftp()
            .map_err(|e| format!("Failed to initialize SFTP: {}", e))?;
        let resolved = resolve_sftp_path(&sftp, &remote_path);
        let mut remote_file = sftp
            .open(Path::new(&resolved))
            .map_err(|e| format!("SFTP open failed for '{}': {}", resolved, e))?;

        let mut content = Vec::new();
        remote_file
            .read_to_end(&mut content)
            .map_err(|e| format!("SFTP read failed: {}", e))?;

        Ok(String::from_utf8_lossy(&content).to_string())
    })();

    if res.is_ok() {
        state.return_ssh_session(&host, sess);
    }
    res
}

#[tauri::command]
pub fn write_remote_file(
    state: tauri::State<'_, AppState>,
    host: HostConfig,
    remote_path: String,
    content: String,
) -> Result<(), String> {
    let sess = state.take_ssh_session(&host)?;
    let res = (|| {
        let sftp = sess
            .sftp()
            .map_err(|e| format!("Failed to initialize SFTP: {}", e))?;
        let resolved = resolve_sftp_path(&sftp, &remote_path);
        let mut remote_file = sftp
            .create(Path::new(&resolved))
            .map_err(|e| format!("SFTP create failed for '{}': {}", resolved, e))?;

        remote_file
            .write_all(content.as_bytes())
            .map_err(|e| format!("SFTP write failed: {}", e))?;

        remote_file
            .flush()
            .map_err(|e| format!("SFTP flush failed: {}", e))?;

        Ok(())
    })();

    if res.is_ok() {
        state.return_ssh_session(&host, sess);
    }
    res
}

pub fn calculate_dir_size(dir: &Path) -> u64 {
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

pub fn upload_single_file_stream(
    sftp: &ssh2::Sftp,
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
    let flags = ssh2::OpenFlags::WRITE | ssh2::OpenFlags::TRUNCATE | ssh2::OpenFlags::CREATE;
    let mut remote_file = sftp
        .open_mode(Path::new(remote_path), flags, 0o644, ssh2::OpenType::File)
        .map_err(|e| format!("Failed to create remote file '{}': {}", remote_path, e))?;

    let local_file = std::fs::File::open(local_path).map_err(|e| e.to_string())?;
    // High performance: 512KB BufReader for large disk throughput
    let mut local_reader = std::io::BufReader::with_capacity(512 * 1024, local_file);
    // Performance: 256KB transmission buffer aligned to libssh2 optimal window
    let mut buffer = vec![0u8; 256 * 1024];

    loop {
        let n = local_reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        remote_file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        *transferred += n as u64;

        // Throttle progress updates to 100ms to eliminate IPC flooding
        if last_emit.elapsed() >= std::time::Duration::from_millis(100) || *transferred >= total_size {
            let elapsed_sec = start_time.elapsed().as_secs_f64();
            let speed_bps = if elapsed_sec > 0.0 { *transferred as f64 / elapsed_sec } else { 0.0 };
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
    remote_file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn upload_dir_recursive(
    sftp: &ssh2::Sftp,
    local_dir: &Path,
    remote_dir: &str,
    app_handle: &tauri::AppHandle,
    transfer_id: &str,
    transferred: &mut u64,
    total_size: u64,
    start_time: &std::time::Instant,
    last_emit: &mut std::time::Instant,
) -> Result<(), String> {
    let _ = sftp.mkdir(Path::new(remote_dir), 0o755);
    if let Ok(entries) = std::fs::read_dir(local_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let fname = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let remote_child = format!("{}/{}", remote_dir.trim_end_matches('/'), fname);
            if path.is_dir() {
                upload_dir_recursive(
                    sftp,
                    &path,
                    &remote_child,
                    app_handle,
                    transfer_id,
                    transferred,
                    total_size,
                    start_time,
                    last_emit,
                )?;
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
                )?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn sftp_upload_file(
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

    let sess = state.take_ssh_session(&host)?;
    let res = (|| {
        let sftp = sess.sftp().map_err(|e| format!("SFTP initialization failed: {}", e))?;
        let resolved_dest_dir = resolve_sftp_path(&sftp, &remote_dest_dir);

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
            )?;
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
            )?;
        }

        Ok(())
    })();

    if res.is_ok() {
        state.return_ssh_session(&host, sess);
    }
    res
}

#[tauri::command]
pub fn sftp_download_file(
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
    transfer_id: String,
    host: HostConfig,
    remote_path: String,
    local_dest_dir: String,
) -> Result<(), String> {
    let sess = state.take_ssh_session(&host)?;
    let res = (|| {
        let sftp = sess.sftp().map_err(|e| format!("SFTP initialization failed: {}", e))?;
        let resolved_remote = resolve_sftp_path(&sftp, &remote_path);
        let file_name = Path::new(&resolved_remote)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Invalid remote filename".to_string())?
            .to_string();

        let mut remote_file = sftp
            .open(Path::new(&resolved_remote))
            .map_err(|e| format!("Failed to open remote file '{}': {}", resolved_remote, e))?;

        let stat = remote_file.stat().map_err(|e| e.to_string())?;
        let total_size = stat.size.unwrap_or(0);

        let dest_dir = Path::new(&local_dest_dir);
        if !dest_dir.exists() {
            std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
        }
        let local_dest_path = dest_dir.join(&file_name);
        let local_file = std::fs::File::create(&local_dest_path).map_err(|e| e.to_string())?;
        // High performance: 512KB BufWriter
        let mut local_writer = std::io::BufWriter::with_capacity(512 * 1024, local_file);

        // Performance: 256KB download buffer aligned to optimal libssh2 chunk size
        let mut buffer = vec![0u8; 256 * 1024];
        let mut transferred: u64 = 0;
        let start_time = std::time::Instant::now();
        let mut last_emit = std::time::Instant::now();

        loop {
            let n = remote_file.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            local_writer.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            transferred += n as u64;

            // Throttle progress updates to 100ms
            if last_emit.elapsed() >= std::time::Duration::from_millis(100)
                || (total_size > 0 && transferred >= total_size)
            {
                let elapsed_sec = start_time.elapsed().as_secs_f64();
                let speed_bps = if elapsed_sec > 0.0 { transferred as f64 / elapsed_sec } else { 0.0 };
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
                        "fileName": file_name,
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
        local_writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    })();

    if res.is_ok() {
        state.return_ssh_session(&host, sess);
    }
    res
}

pub fn delete_remote_recursive(sftp: &ssh2::Sftp, remote_path: &str) -> Result<(), String> {
    let p = Path::new(remote_path);
    let stat = sftp.stat(p).map_err(|e| format!("Stat failed for '{}': {}", remote_path, e))?;
    if stat.is_dir() {
        if let Ok(entries) = sftp.readdir(p) {
            for (child_path, child_stat) in entries {
                let name = match child_path.file_name() {
                    Some(n) => n.to_string_lossy().to_string(),
                    None => continue,
                };
                if name == "." || name == ".." {
                    continue;
                }
                let child_str = format!("{}/{}", remote_path.trim_end_matches('/'), name);
                if child_stat.is_dir() {
                    delete_remote_recursive(sftp, &child_str)?;
                } else {
                    let _ = sftp.unlink(Path::new(&child_str));
                }
            }
        }
        sftp.rmdir(p).map_err(|e| format!("SFTP rmdir failed for '{}': {}", remote_path, e))?;
    } else {
        sftp.unlink(p).map_err(|e| format!("SFTP unlink failed for '{}': {}", remote_path, e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_remote_file(
    state: tauri::State<'_, AppState>,
    host: HostConfig,
    remote_path: String,
) -> Result<(), String> {
    let sess = state.take_ssh_session(&host)?;
    let res = (|| {
        let sftp = sess.sftp().map_err(|e| format!("SFTP initialization failed: {}", e))?;
        let resolved = resolve_sftp_path(&sftp, &remote_path);
        if resolved == "/" || resolved.is_empty() {
            return Err("Refusing to delete root directory '/'".to_string());
        }
        delete_remote_recursive(&sftp, &resolved)
    })();

    if res.is_ok() {
        state.return_ssh_session(&host, sess);
    }
    res
}
