use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use crate::{load_or_init_config, AppState, HostConfig};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContainerStats {
    pub cpu: String,
    pub memory: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DockerContainerItem {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub memory: String,
    pub cpu: String,
}

fn extract_http_body(raw: &str) -> Result<String, String> {
    let parts: Vec<&str> = raw.splitn(2, "\r\n\r\n").collect();
    if parts.len() < 2 {
        return Err("Malformed HTTP response".to_string());
    }
    let headers = parts[0];
    let body = parts[1];

    if headers.to_lowercase().contains("transfer-encoding: chunked") {
        let mut result = String::new();
        let mut remaining = body;
        while !remaining.is_empty() {
            let chunk_parts: Vec<&str> = remaining.splitn(2, "\r\n").collect();
            if chunk_parts.is_empty() {
                break;
            }
            let hex_len = chunk_parts[0].trim();
            if hex_len.is_empty() {
                break;
            }
            let chunk_len = match usize::from_str_radix(hex_len, 16) {
                Ok(l) => l,
                Err(_) => return Ok(body.to_string()),
            };
            if chunk_len == 0 {
                break;
            }
            if chunk_parts.len() < 2 {
                break;
            }
            let chunk_data = chunk_parts[1];
            if chunk_data.len() < chunk_len {
                result.push_str(chunk_data);
                break;
            }
            result.push_str(&chunk_data[..chunk_len]);
            let next_start = chunk_len + 2; // skip \r\n
            if chunk_data.len() > next_start {
                remaining = &chunk_data[next_start..];
            } else {
                break;
            }
        }
        Ok(result)
    } else {
        Ok(body.to_string())
    }
}

pub async fn query_docker_remote(
    handle: &russh::client::Handle<crate::ssh::TarisSshHandler>,
    docker_port: u16,
    method: &str,
    path: &str,
) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // 1. Try TCP direct channel over SSH (e.g. port 2375)
    if let Ok(ch) = handle.channel_open_direct_tcpip("127.0.0.1", docker_port as u32, "127.0.0.1", 22222).await {
        let mut stream = ch.into_stream();
        let req = format!("{} {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", method, path);
        if stream.write_all(req.as_bytes()).await.is_ok() && stream.flush().await.is_ok() {
            let mut resp = Vec::new();
            if stream.read_to_end(&mut resp).await.is_ok() && !resp.is_empty() {
                let resp_str = String::from_utf8_lossy(&resp).to_string();
                if resp_str.starts_with("HTTP/1.1 20") || resp_str.starts_with("HTTP/1.0 20") {
                    return extract_http_body(&resp_str);
                }
            }
        }
    }

    // 2. Try docker/podman system dial-stdio over channel session
    for cmd in &["docker system dial-stdio", "podman system dial-stdio"] {
        if let Ok(ch) = handle.channel_open_session().await {
            if ch.exec(true, *cmd).await.is_ok() {
                let mut stream = ch.into_stream();
                let req = format!("{} {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", method, path);
                if stream.write_all(req.as_bytes()).await.is_ok() && stream.flush().await.is_ok() {
                    let mut resp = Vec::new();
                    if stream.read_to_end(&mut resp).await.is_ok() && !resp.is_empty() {
                        let resp_str = String::from_utf8_lossy(&resp).to_string();
                        if resp_str.starts_with("HTTP/1.1 20") || resp_str.starts_with("HTTP/1.0 20") {
                            return extract_http_body(&resp_str);
                        }
                    }
                }
            }
        }
    }

    Err(format!("Could not connect to Docker/Podman API via port {} or socket", docker_port))
}

fn query_docker_local(
    docker_port: u16,
    method: &str,
    path: &str,
) -> Result<String, String> {
    use std::net::TcpStream;
    use std::time::Duration;

    // 1. Try local TCP port (configured port, e.g. 2375)
    if let Ok(mut stream) = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], docker_port)),
        Duration::from_millis(400),
    ) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
        let req = format!("{} {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", method, path);
        if stream.write_all(req.as_bytes()).is_ok() && stream.flush().is_ok() {
            let mut resp = Vec::new();
            if stream.read_to_end(&mut resp).is_ok() && !resp.is_empty() {
                let resp_str = String::from_utf8_lossy(&resp).to_string();
                if resp_str.starts_with("HTTP/1.1 20") || resp_str.starts_with("HTTP/1.0 20") {
                    return extract_http_body(&resp_str);
                }
            }
        }
    }

    // 2. Windows Named Pipe
    #[cfg(windows)]
    {
        if let Ok(mut pipe) = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(r"\\.\pipe\docker_engine")
        {
            let req = format!("{} {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", method, path);
            if pipe.write_all(req.as_bytes()).is_ok() && pipe.flush().is_ok() {
                let mut resp = Vec::new();
                if pipe.read_to_end(&mut resp).is_ok() && !resp.is_empty() {
                    let resp_str = String::from_utf8_lossy(&resp).to_string();
                    if resp_str.starts_with("HTTP/1.1 20") || resp_str.starts_with("HTTP/1.0 20") {
                        return extract_http_body(&resp_str);
                    }
                }
            }
        }
    }

    // 3. Unix domain socket
    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;
        let sock_paths = [
            "/var/run/docker.sock",
            "/run/podman/podman.sock",
            "/var/run/podman/podman.sock",
        ];
        for sp in &sock_paths {
            if let Ok(mut stream) = UnixStream::connect(sp) {
                let req = format!("{} {} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n", method, path);
                if stream.write_all(req.as_bytes()).is_ok() {
                    let mut resp = Vec::new();
                    if stream.read_to_end(&mut resp).is_ok() && !resp.is_empty() {
                        let resp_str = String::from_utf8_lossy(&resp).to_string();
                        if resp_str.starts_with("HTTP/1.1 20") || resp_str.starts_with("HTTP/1.0 20") {
                            return extract_http_body(&resp_str);
                        }
                    }
                }
            }
        }
    }

    Err(format!("Local Docker/Podman daemon not responding on port {} or socket", docker_port))
}

fn get_effective_docker_port(state: &AppState, host: Option<&HostConfig>, docker_port: Option<u16>) -> u16 {
    if let Some(p) = docker_port {
        return p;
    }
    if let Some(h) = host {
        if let Some(p) = h.docker_port {
            return p;
        }
    }
    load_or_init_config(&state.config_path).settings.docker_port
}

#[tauri::command]
pub async fn check_docker_available(
    state: tauri::State<'_, AppState>,
    host: Option<HostConfig>,
    docker_port: Option<u16>,
) -> Result<bool, String> {
    let port = get_effective_docker_port(&state, host.as_ref(), docker_port);
    let res = if let Some(ref h) = host {
        if !h.has_docker {
            return Ok(false);
        }
        if let Ok(handle) = state.get_russh_session(h).await {
            query_docker_remote(&handle, port, "GET", "/version").await.is_ok()
        } else {
            false
        }
    } else {
        query_docker_local(port, "GET", "/version").is_ok()
    };
    Ok(res)
}

#[tauri::command]
pub async fn get_docker_containers(
    state: tauri::State<'_, AppState>,
    host: Option<HostConfig>,
    docker_port: Option<u16>,
) -> Result<Vec<DockerContainerItem>, String> {
    let port = get_effective_docker_port(&state, host.as_ref(), docker_port);

    let raw_json = if let Some(ref h) = host {
        if !h.has_docker {
            return Ok(vec![]);
        }
        let handle = state.get_russh_session(h).await?;
        query_docker_remote(&handle, port, "GET", "/containers/json?all=1").await?
    } else {
        query_docker_local(port, "GET", "/containers/json?all=1")?
    };

    let parsed: serde_json::Value = serde_json::from_str(&raw_json)
        .map_err(|e| format!("Failed to parse Docker containers JSON: {}", e))?;

    let array = match parsed.as_array() {
        Some(a) => a,
        None => return Ok(vec![]),
    };

    let mut items = Vec::new();
    for c in array {
        let full_id = c.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let id = if full_id.len() > 12 { full_id[..12].to_string() } else { full_id.clone() };

        let name = c.get("Names")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim_start_matches('/')
            .to_string();

        let image = c.get("Image").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let status = c.get("Status").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let state_val = c.get("State").and_then(|v| v.as_str()).unwrap_or("").to_string();

        let mut ports_vec = Vec::new();
        if let Some(ports_arr) = c.get("Ports").and_then(|v| v.as_array()) {
            for p in ports_arr {
                let priv_p = p.get("PrivatePort").and_then(|v| v.as_u64()).unwrap_or(0);
                let pub_p = p.get("PublicPort").and_then(|v| v.as_u64());
                let p_type = p.get("Type").and_then(|v| v.as_str()).unwrap_or("tcp");
                if let Some(pub_val) = pub_p {
                    ports_vec.push(format!("{}:{}->{}/{}", pub_val, priv_p, priv_p, p_type));
                } else if priv_p > 0 {
                    ports_vec.push(format!("{}/{}", priv_p, p_type));
                }
            }
        }
        let ports = ports_vec.join(", ");

        items.push(DockerContainerItem {
            id,
            name,
            image,
            status,
            state: state_val,
            ports,
            memory: "-".to_string(),
            cpu: "-".to_string(),
        });
    }

    Ok(items)
}

#[tauri::command]
pub async fn docker_container_action(
    state: tauri::State<'_, AppState>,
    host: Option<HostConfig>,
    docker_port: Option<u16>,
    container_id: String,
    action: String,
) -> Result<(), String> {
    let port = get_effective_docker_port(&state, host.as_ref(), docker_port);
    let valid_actions = ["start", "stop", "restart", "pause", "unpause"];
    if !valid_actions.contains(&action.as_str()) {
        return Err(format!("Invalid container action '{}'", action));
    }

    let path = format!("/containers/{}/{}", container_id, action);
    if let Some(ref h) = host {
        let handle = state.get_russh_session(h).await?;
        query_docker_remote(&handle, port, "POST", &path).await?;
    } else {
        query_docker_local(port, "POST", &path)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_container_stats(
    state: tauri::State<'_, AppState>,
    host: Option<HostConfig>,
    docker_port: Option<u16>,
    container_id: String,
) -> Result<ContainerStats, String> {
    let port = get_effective_docker_port(&state, host.as_ref(), docker_port);
    let path = format!("/containers/{}/stats?stream=false", container_id);
    let raw_json = if let Some(ref h) = host {
        let handle = state.get_russh_session(h).await?;
        query_docker_remote(&handle, port, "GET", &path).await?
    } else {
        query_docker_local(port, "GET", &path)?
    };

    let st: serde_json::Value = serde_json::from_str(&raw_json)
        .map_err(|e| format!("Failed to parse stats JSON: {}", e))?;

    // 1. Memory Stats Calculation
    let mem_stats = st.get("memory_stats");
    let raw_usage = mem_stats.and_then(|m| m.get("usage")).and_then(|v| v.as_u64()).unwrap_or(0);
    let cache = mem_stats
        .and_then(|m| m.get("stats"))
        .and_then(|s| {
            s.get("cache")
                .or_else(|| s.get("inactive_file"))
                .or_else(|| s.get("total_inactive_file"))
        })
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let usage = if raw_usage > cache { raw_usage - cache } else { raw_usage };
    let limit = mem_stats.and_then(|m| m.get("limit")).and_then(|v| v.as_u64()).unwrap_or(0);

    let memory_str = if usage > 0 && limit > 0 {
        let usage_mb = usage as f64 / 1024.0 / 1024.0;
        let limit_mb = limit as f64 / 1024.0 / 1024.0;
        if limit_mb > 1024.0 {
            format!("{:.1} MiB / {:.1} GiB", usage_mb, limit_mb / 1024.0)
        } else {
            format!("{:.1} MiB / {:.0} MiB", usage_mb, limit_mb)
        }
    } else if usage > 0 {
        let usage_mb = usage as f64 / 1024.0 / 1024.0;
        format!("{:.1} MiB", usage_mb)
    } else {
        "-".to_string()
    };

    // 2. CPU Stats Calculation
    let cpu_stats = st.get("cpu_stats");
    let precpu_stats = st.get("precpu_stats");

    let cpu_total = cpu_stats
        .and_then(|c| c.get("cpu_usage"))
        .and_then(|u| u.get("total_usage"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let pre_cpu_total = precpu_stats
        .and_then(|c| c.get("cpu_usage"))
        .and_then(|u| u.get("total_usage"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let sys_total = cpu_stats
        .and_then(|c| c.get("system_cpu_usage"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let pre_sys_total = precpu_stats
        .and_then(|c| c.get("system_cpu_usage"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let online_cpus = cpu_stats
        .and_then(|c| c.get("online_cpus"))
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| {
            cpu_stats
                .and_then(|c| c.get("cpu_usage"))
                .and_then(|u| u.get("percpu_usage"))
                .and_then(|v| v.as_array())
                .map(|a| a.len() as u64)
                .unwrap_or(1)
        })
        .max(1);

    let mut cpu_percent: Option<f64> = None;

    if cpu_total > pre_cpu_total && sys_total > pre_sys_total {
        let cpu_delta = (cpu_total - pre_cpu_total) as f64;
        let sys_delta = (sys_total - pre_sys_total) as f64;
        cpu_percent = Some((cpu_delta / sys_delta) * (online_cpus as f64) * 100.0);
    } else if let Ok(mut samples) = state.docker_cpu_samples.lock() {
        if let Some((prev_cpu, prev_sys, prev_time)) = samples.get(&container_id) {
            if sys_total > *prev_sys && cpu_total >= *prev_cpu {
                let cpu_delta = (cpu_total - *prev_cpu) as f64;
                let sys_delta = (sys_total - *prev_sys) as f64;
                cpu_percent = Some((cpu_delta / sys_delta) * (online_cpus as f64) * 100.0);
            } else if prev_time.elapsed().as_millis() > 200 && cpu_total >= *prev_cpu {
                let cpu_delta_ns = (cpu_total - *prev_cpu) as f64;
                let elapsed_ns = prev_time.elapsed().as_nanos() as f64;
                if elapsed_ns > 0.0 {
                    cpu_percent = Some((cpu_delta_ns / elapsed_ns) * 100.0);
                }
            }
        }
        samples.insert(container_id.clone(), (cpu_total, sys_total, std::time::Instant::now()));
    }

    let cpu_str = match cpu_percent {
        Some(pct) => format!("{:.1}%", pct.max(0.0).min(online_cpus as f64 * 100.0)),
        None => {
            if cpu_total > 0 {
                "0.0%".to_string()
            } else {
                "-".to_string()
            }
        }
    };

    Ok(ContainerStats {
        cpu: cpu_str,
        memory: memory_str,
    })
}