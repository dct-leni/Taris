use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Seek};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub compressed_size: u64,
    pub is_dir: bool,
    pub modified: String,
}

/// Reads entries from a .zip file (Random seek: reads central directory in milliseconds)
pub fn read_zip_entries<R: Read + Seek>(reader: R) -> Result<Vec<ArchiveEntry>, String> {
    let mut zip = zip::ZipArchive::new(reader).map_err(|e| format!("Invalid ZIP archive: {}", e))?;
    let mut entries = Vec::new();

    for i in 0..zip.len() {
        if let Ok(file) = zip.by_index(i) {
            let full_name = file.name().replace('\\', "/");
            let is_dir = file.is_dir() || full_name.ends_with('/');
            let clean_name = full_name.trim_end_matches('/').split('/').last().unwrap_or(&full_name).to_string();

            let mod_str = if let Some(mtime) = file.last_modified() {
                format!(
                    "{:02}/{:02}/{:04} {:02}:{:02}",
                    mtime.day(),
                    mtime.month(),
                    mtime.year(),
                    mtime.hour(),
                    mtime.minute()
                )
            } else {
                "-".to_string()
            };

            entries.push(ArchiveEntry {
                path: full_name,
                name: clean_name,
                size: file.size(),
                compressed_size: file.compressed_size(),
                is_dir,
                modified: mod_str,
            });
        }
    }

    Ok(entries)
}

/// Reads entries from a .tar or .tar.gz file
pub fn read_tar_entries<R: Read>(reader: R) -> Result<Vec<ArchiveEntry>, String> {
    let mut archive = tar::Archive::new(reader);
    let mut entries = Vec::new();

    let raw_entries = archive.entries().map_err(|e| format!("Invalid TAR archive: {}", e))?;
    for entry_res in raw_entries {
        if let Ok(entry) = entry_res {
            if let Ok(path) = entry.path() {
                let full_name = path.to_string_lossy().replace('\\', "/");
                let is_dir = entry.header().entry_type().is_dir() || full_name.ends_with('/');
                let clean_name = full_name.trim_end_matches('/').split('/').last().unwrap_or(&full_name).to_string();
                let size = entry.header().size().unwrap_or(0);
                let mtime = entry.header().mtime().unwrap_or(0);

                let mod_str = if let Some(dt) = chrono::DateTime::from_timestamp(mtime as i64, 0) {
                    dt.format("%d/%m/%Y %H:%M").to_string()
                } else {
                    "-".to_string()
                };

                entries.push(ArchiveEntry {
                    path: full_name,
                    name: clean_name,
                    size,
                    compressed_size: size,
                    is_dir,
                    modified: mod_str,
                });
            }
        }
    }

    Ok(entries)
}

/// Reads entries from a .7z file
pub fn read_sevenz_entries(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();

    let archive = sevenz_rust::Archive::read(&mut file, len, &[]).map_err(|e| format!("7z parse error: {:?}", e))?;
    let mut entries = Vec::new();

    for entry in &archive.files {
        let full_name = entry.name().replace('\\', "/");
        let is_dir = entry.is_directory() || full_name.ends_with('/');
        let clean_name = full_name.trim_end_matches('/').split('/').last().unwrap_or(&full_name).to_string();

        entries.push(ArchiveEntry {
            path: full_name,
            name: clean_name,
            size: entry.size(),
            compressed_size: entry.compressed_size,
            is_dir,
            modified: "-".to_string(),
        });
    }

    Ok(entries)
}

/// Inspects local or remote archive file
pub fn inspect_local_archive(path: &Path) -> Result<Vec<ArchiveEntry>, String> {
    let lower = path.to_string_lossy().to_lowercase();
    let file = File::open(path).map_err(|e| format!("Failed to open archive: {}", e))?;

    if lower.ends_with(".zip") {
        read_zip_entries(file)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        let gz = flate2::read::GzDecoder::new(file);
        read_tar_entries(gz)
    } else if lower.ends_with(".tar") {
        read_tar_entries(file)
    } else if lower.ends_with(".7z") {
        read_sevenz_entries(path)
    } else {
        // Attempt ZIP by default
        read_zip_entries(file)
    }
}

/// Extracts a single entry from a local archive
pub fn extract_local_entry(archive_path: &Path, entry_path: &str, dest_path: &Path) -> Result<(), String> {
    let lower = archive_path.to_string_lossy().to_lowercase();
    let file = File::open(archive_path).map_err(|e| e.to_string())?;

    if lower.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        let mut entry = zip.by_name(entry_path).map_err(|e| e.to_string())?;
        let mut out = File::create(dest_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        Ok(())
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") || lower.ends_with(".tar") {
        let mut archive = if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
            let gz = flate2::read::GzDecoder::new(file);
            tar::Archive::new(Box::new(gz) as Box<dyn Read>)
        } else {
            tar::Archive::new(Box::new(file) as Box<dyn Read>)
        };

        for e in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = e.map_err(|e| e.to_string())?;
            if let Ok(p) = entry.path() {
                if p.to_string_lossy().replace('\\', "/") == entry_path {
                    let mut out = File::create(dest_path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
                    return Ok(());
                }
            }
        }
        Err(format!("Entry '{}' not found in TAR archive", entry_path))
    } else {
        Err("Unsupported archive format for extraction".into())
    }
}

#[tauri::command]
pub async fn inspect_archive(
    state: tauri::State<'_, crate::AppState>,
    host: Option<crate::HostConfig>,
    archive_path: String,
) -> Result<Vec<ArchiveEntry>, String> {
    if let Some(h) = host {
        // Remote archive inspection via russh SSH session channel
        let handle = state.get_russh_session(&h).await?;
        let lower = archive_path.to_lowercase();

        if lower.ends_with(".zip") {
            let cmd = format!("unzip -l \"{}\" 2>/dev/null", archive_path.replace('"', "\\\""));
            if let Ok(out) = crate::ssh::client::exec_command(&handle, &cmd).await {
                if out.contains("Archive:") || out.contains("Length") {
                    let mut entries = Vec::new();
                    let mut in_files = false;
                    for line in out.lines() {
                        if line.contains("----") {
                            in_files = !in_files;
                            continue;
                        }
                        if in_files {
                            let parts: Vec<&str> = line.trim().split_whitespace().collect();
                            if parts.len() >= 4 {
                                let size = parts[0].parse::<u64>().unwrap_or(0);
                                let mod_str = format!("{} {}", parts[1], parts[2]);
                                let path = parts[3..].join(" ");
                                let is_dir = path.ends_with('/');
                                let name = path.trim_end_matches('/').split('/').last().unwrap_or(&path).to_string();
                                entries.push(ArchiveEntry {
                                    path,
                                    name,
                                    size,
                                    compressed_size: size,
                                    is_dir,
                                    modified: mod_str,
                                });
                            }
                        }
                    }
                    if !entries.is_empty() {
                        return Ok(entries);
                    }
                }
            }
        } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") || lower.ends_with(".tar") {
            let flag = if lower.ends_with(".tar") { "-tvf" } else { "-ztvf" };
            let cmd = format!("tar {} \"{}\" 2>/dev/null", flag, archive_path.replace('"', "\\\""));
            if let Ok(out) = crate::ssh::client::exec_command(&handle, &cmd).await {
                let mut entries = Vec::new();
                for line in out.lines() {
                    let parts: Vec<&str> = line.trim().split_whitespace().collect();
                    if parts.len() >= 6 {
                        let perms = parts[0];
                        let is_dir = perms.starts_with('d');
                        let size = parts[2].parse::<u64>().unwrap_or(0);
                        let mod_str = format!("{} {}", parts[3], parts[4]);
                        let path = parts[5..].join(" ");
                        let name = path.trim_end_matches('/').split('/').last().unwrap_or(&path).to_string();
                        entries.push(ArchiveEntry {
                            path,
                            name,
                            size,
                            compressed_size: size,
                            is_dir,
                            modified: mod_str,
                        });
                    }
                }
                if !entries.is_empty() {
                    return Ok(entries);
                }
            }
        }

        // If tools aren't present on remote or format is 7z, download first/last 512KB for local inspection
        Err("Remote archive inspection requires remote unzip/tar utilities or local cache".into())
    } else {
        // Local archive
        inspect_local_archive(Path::new(&archive_path))
    }
}
