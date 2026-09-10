use crate::{AppState, SnippetItem};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpStatus {
    pub active: bool,
    pub port: u16,
    pub url: String,
}

pub struct McpServerHandle {
    pub port: u16,
    pub shutdown_tx: broadcast::Sender<()>,
}

/// Dispatches JSON-RPC 2.0 MCP protocol requests.
pub async fn handle_mcp_jsonrpc(state: &AppState, request_json: &str) -> Value {
    let req: Value = match serde_json::from_str(request_json) {
        Ok(v) => v,
        Err(_) => {
            return json!({
                "jsonrpc": "2.0",
                "id": null,
                "error": { "code": -32700, "message": "Parse error" }
            });
        }
    };

    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let method = match req.get("method").and_then(|m| m.as_str()) {
        Some(m) => m,
        None => {
            return json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32600, "message": "Invalid Request: missing method" }
            });
        }
    };

    match method {
        "initialize" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {
                        "name": "taris",
                        "version": "0.1.0"
                    },
                    "capabilities": {
                        "tools": {}
                    }
                }
            })
        }
        "notifications/initialized" => {
            json!({ "jsonrpc": "2.0", "result": {} })
        }
        "ping" => {
            json!({ "jsonrpc": "2.0", "id": id, "result": {} })
        }
        "tools/list" => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "tools": [
                        {
                            "name": "list_hosts",
                            "description": "List all registered host bookmarks in Taris without exposing credentials or private keys.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "execute_command",
                            "description": "Execute a shell command on a registered host via Taris's active SSH session.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "host_id": { "type": "string", "description": "The ID or name of the host from list_hosts" },
                                    "command": { "type": "string", "description": "The shell command to execute" }
                                },
                                "required": ["host_id", "command"]
                            }
                        },
                        {
                            "name": "list_containers",
                            "description": "List running Docker or Podman containers on a target host or local system.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "host_id": { "type": "string", "description": "Optional host ID (defaults to local/first docker host)" }
                                }
                            }
                        },
                        {
                            "name": "read_remote_file",
                            "description": "Read remote file content from a registered host via SFTP or in-band transfer fallback.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "host_id": { "type": "string", "description": "The ID or name of the target host" },
                                    "remote_path": { "type": "string", "description": "Absolute or relative path to the remote file" }
                                },
                                "required": ["host_id", "remote_path"]
                            }
                        },
                        {
                            "name": "list_notes",
                            "description": "List command snippets, notes, and aliases stored in Taris.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "add_notes",
                            "description": "Add a new command snippet/alias note to Taris.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "title": { "type": "string", "description": "Title of the snippet" },
                                    "command": { "type": "string", "description": "Command line text" },
                                    "tags": { "type": "string", "description": "Optional comma-separated tags" }
                                },
                                "required": ["title", "command"]
                            }
                        },
                        {
                            "name": "list_wsl_distros",
                            "description": "List installed WSL distributions on the Windows host.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {}
                            }
                        },
                        {
                            "name": "add_wsl_distro",
                            "description": "Provision or install a new WSL distribution (e.g. Ubuntu, Debian, Alpine).",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "distro_name": { "type": "string", "description": "Name of the distribution to install" }
                                },
                                "required": ["distro_name"]
                            }
                        },
                        {
                            "name": "list_cloud_instances",
                            "description": "List cloud compute instances discovered from configured GCP, AWS, or Azure accounts.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "provider": { "type": "string", "description": "Cloud provider: gcp, aws, or azure (default: gcp)" },
                                    "project_id": { "type": "string", "description": "Project ID or region" }
                                }
                            }
                        }
                    ]
                }
            })
        }
        "tools/call" => {
            let params = req.get("params").cloned().unwrap_or(Value::Null);
            let tool_name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));

            let tool_result = execute_mcp_tool(state, tool_name, &args).await;
            match tool_result {
                Ok(text) => {
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": text
                                }
                            ]
                        }
                    })
                }
                Err(err) => {
                    json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "isError": true,
                            "content": [
                                {
                                    "type": "text",
                                    "text": format!("Error executing {}: {}", tool_name, err)
                                }
                            ]
                        }
                    })
                }
            }
        }
        _ => {
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("Method '{}' not found", method) }
            })
        }
    }
}

async fn execute_mcp_tool(state: &AppState, tool_name: &str, args: &Value) -> Result<String, String> {
    let cfg = crate::load_or_init_config(&state.config_path);

    match tool_name {
        "list_hosts" => {
            // Security: Strip passwords, tokens, and raw private keys
            let sanitized: Vec<Value> = cfg.hosts.iter().map(|h| {
                json!({
                    "id": h.id,
                    "name": h.name,
                    "host": h.host,
                    "port": h.port,
                    "user": h.user,
                    "auth_type": h.auth_type,
                    "has_docker": h.has_docker,
                    "protocol": h.protocol.as_deref().unwrap_or("ssh"),
                    "network_route": h.network_route.as_deref().unwrap_or("direct"),
                    "has_key": h.key_path.is_some(),
                })
            }).collect();
            serde_json::to_string_pretty(&sanitized).map_err(|e| e.to_string())
        }
        "execute_command" => {
            let host_id = args.get("host_id").and_then(|v| v.as_str()).ok_or("Missing 'host_id'")?;
            let command = args.get("command").and_then(|v| v.as_str()).ok_or("Missing 'command'")?;

            let host = cfg.hosts.iter().find(|h| h.id == host_id || h.name.eq_ignore_ascii_case(host_id))
                .ok_or_else(|| format!("Host '{}' not found in config", host_id))?;

            let handle = state.get_russh_session(host).await?;
            crate::ssh::client::exec_command(&handle, command).await
        }
        "list_containers" => {
            let target_host = if let Some(hid) = args.get("host_id").and_then(|v| v.as_str()) {
                cfg.hosts.iter().find(|h| h.id == hid || h.name.eq_ignore_ascii_case(hid))
            } else {
                cfg.hosts.iter().find(|h| h.has_docker)
            };

            if let Some(host) = target_host {
                let handle = state.get_russh_session(host).await?;
                let port = host.docker_port.unwrap_or(2375);
                crate::docker::query_docker_remote(&handle, port, "GET", "/containers/json?all=1").await
            } else {
                Err("No host with Docker found. Specify a valid 'host_id'.".into())
            }
        }
        "read_remote_file" => {
            let host_id = args.get("host_id").and_then(|v| v.as_str()).ok_or("Missing 'host_id'")?;
            let remote_path = args.get("remote_path").and_then(|v| v.as_str()).ok_or("Missing 'remote_path'")?;

            let host = cfg.hosts.iter().find(|h| h.id == host_id || h.name.eq_ignore_ascii_case(host_id))
                .ok_or_else(|| format!("Host '{}' not found in config", host_id))?;

            // Try SFTP first, fallback to SSH command if SFTP disabled
            match state.get_sftp_session(host).await {
                Ok(sftp) => {
                    let canon_path = crate::ssh::sftp::resolve_sftp_path(&sftp, remote_path).await;
                    match sftp.open(&canon_path).await {
                        Ok(mut file) => {
                            let mut buf = Vec::new();
                            let mut chunk = [0u8; 8192];
                            while let Ok(n) = file.read(&mut chunk).await {
                                if n == 0 { break; }
                                buf.extend_from_slice(&chunk[..n]);
                                if buf.len() > 512 * 1024 { // 512KB cap for AI agent tool output
                                    buf.extend_from_slice(b"\n...[truncated: file exceeds 512KB limit]...");
                                    break;
                                }
                            }
                            Ok(String::from_utf8_lossy(&buf).to_string())
                        }
                        Err(e) => Err(format!("SFTP read error: {}", e))
                    }
                }
                Err(_) => {
                    let handle = state.get_russh_session(host).await?;
                    crate::ssh::sftp::read_remote_file_ssh_fallback(&handle, remote_path).await
                }
            }
        }
        "list_notes" => {
            serde_json::to_string_pretty(&cfg.snippets).map_err(|e| e.to_string())
        }
        "add_notes" => {
            let title = args.get("title").and_then(|v| v.as_str()).ok_or("Missing 'title'")?;
            let command = args.get("command").and_then(|v| v.as_str()).ok_or("Missing 'command'")?;
            let tags = args.get("tags").and_then(|v| v.as_str()).map(|s| s.to_string());

            let mut updated_cfg = cfg.clone();
            let new_snippet = SnippetItem {
                id: format!("snip-{}", updated_cfg.snippets.len() + 1),
                title: title.to_string(),
                command: command.to_string(),
                tags,
            };
            updated_cfg.snippets.push(new_snippet);

            let toml_str = toml::to_string_pretty(&updated_cfg).map_err(|e| e.to_string())?;
            std::fs::write(&state.config_path, toml_str).map_err(|e| e.to_string())?;

            Ok(format!("Added snippet '{}' successfully.", title))
        }
        "list_wsl_distros" => {
            #[cfg(windows)]
            {
                let output = std::process::Command::new("wsl.exe")
                    .args(["-l", "-q"])
                    .output()
                    .map_err(|e| format!("Failed to execute wsl.exe: {}", e))?;
                let text = String::from_utf16_lossy(
                    &output.stdout.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<u16>>()
                );
                let distros: Vec<&str> = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
                Ok(json!({ "distros": distros }).to_string())
            }
            #[cfg(not(windows))]
            {
                Ok(json!({ "distros": [], "note": "WSL is available only on Windows" }).to_string())
            }
        }
        "add_wsl_distro" => {
            let _distro = args.get("distro_name").and_then(|v| v.as_str()).ok_or("Missing 'distro_name'")?;
            #[cfg(windows)]
            {
                std::process::Command::new("wsl.exe")
                    .args(["--install", _distro, "--no-launch"])
                    .spawn()
                    .map_err(|e| format!("Failed to spawn wsl installation: {}", e))?;
                Ok(format!("Triggered installation for WSL distribution '{}'.", _distro))
            }
            #[cfg(not(windows))]
            {
                Err("WSL is supported only on Windows hosts.".into())
            }
        }
        "list_cloud_instances" => {
            let provider = args.get("provider").and_then(|v| v.as_str()).unwrap_or("gcp").to_lowercase();
            let project_id = args.get("project_id").and_then(|v| v.as_str())
                .or_else(|| cfg.cloud_auth.gcp_default_project.as_deref())
                .unwrap_or("default");

            match provider.as_str() {
                "gcp" => {
                    let sa_ref = cfg.cloud_auth.gcp_service_account_path.as_deref()
                        .or(cfg.cloud_auth.gcp_service_account_json.as_deref());
                    match crate::cloud::gcp::list_gcp_instances(project_id, sa_ref, cfg.cloud_auth.gcp_access_token.as_deref()).await {
                        Ok(instances) => serde_json::to_string_pretty(&instances).map_err(|e| e.to_string()),
                        Err(e) => Ok(json!({ "provider": "gcp", "instances": [], "status": e }).to_string()),
                    }
                }
                "aws" => {
                    match crate::cloud::aws::list_aws_instances(project_id, cfg.cloud_auth.aws_profile.as_deref()).await {
                        Ok(instances) => serde_json::to_string_pretty(&instances).map_err(|e| e.to_string()),
                        Err(e) => Ok(json!({ "provider": "aws", "instances": [], "status": e }).to_string()),
                    }
                }
                "azure" => {
                    match crate::cloud::azure::list_azure_instances(project_id).await {
                        Ok(instances) => serde_json::to_string_pretty(&instances).map_err(|e| e.to_string()),
                        Err(e) => Ok(json!({ "provider": "azure", "instances": [], "status": e }).to_string()),
                    }
                }
                _ => Err(format!("Unknown cloud provider '{}'. Supported: gcp, aws, azure", provider)),
            }
        }
        _ => Err(format!("Unknown tool '{}'", tool_name)),
    }
}

/// Spawns the lightweight HTTP listener on `127.0.0.1:<port>/mcp`.
pub async fn start_mcp_server(
    state: AppState,
    port: u16,
    mut shutdown_rx: broadcast::Receiver<()>,
) -> Result<(), String> {
    let addr = format!("127.0.0.1:{}", port);
    let listener = TcpListener::bind(&addr).await
        .map_err(|e| format!("Failed to bind MCP server to {}: {}", addr, e))?;

    let state = Arc::new(state);
    crate::log_info!("mcp", "HTTP Model Context Protocol (MCP) server listening on http://{}/mcp", addr);

    loop {
        tokio::select! {
            _ = shutdown_rx.recv() => {
                crate::log_info!("mcp", "MCP server shutting down on port {}", port);
                break;
            }
            res = listener.accept() => {
                let (mut socket, _client_addr) = match res {
                    Ok(pair) => pair,
                    Err(_) => continue,
                };

                let state_clone = Arc::clone(&state);
                tokio::spawn(async move {
                    let mut buffer = [0u8; 16384];
                    let mut total_read = 0;

                    // Read HTTP request header
                    while total_read < buffer.len() {
                        match socket.read(&mut buffer[total_read..]).await {
                            Ok(0) => break,
                            Ok(n) => {
                                total_read += n;
                                if buffer[..total_read].windows(4).any(|w| w == b"\r\n\r\n") {
                                    break;
                                }
                            }
                            Err(_) => return,
                        }
                    }

                    let raw_req = String::from_utf8_lossy(&buffer[..total_read]);
                    let mut header_lines = raw_req.split("\r\n\r\n");
                    let headers = header_lines.next().unwrap_or("");
                    let body_preview = header_lines.next().unwrap_or("");

                    let first_line = headers.lines().next().unwrap_or("");
                    let parts: Vec<&str> = first_line.split_whitespace().collect();
                    if parts.len() < 2 { return; }
                    let method = parts[0];
                    let path = parts[1];

                    // Handle CORS preflight
                    if method == "OPTIONS" {
                        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization\r\nConnection: close\r\n\r\n";
                        let _ = socket.write_all(resp.as_bytes()).await;
                        return;
                    }

                    if !path.starts_with("/mcp") {
                        let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found";
                        let _ = socket.write_all(not_found.as_bytes()).await;
                        return;
                    }

                    if method == "GET" {
                        if headers.to_ascii_lowercase().contains("text/event-stream") {
                            let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\nevent: endpoint\r\ndata: /mcp\r\n\r\n";
                            let _ = socket.write_all(resp.as_bytes()).await;
                            let mut buf = [0u8; 1];
                            let _ = socket.read(&mut buf).await;
                            return;
                        }

                        // Health check & endpoint discovery
                        let payload = json!({
                            "status": "ok",
                            "name": "taris",
                            "protocol": "mcp",
                            "endpoint": "/mcp",
                            "version": "0.1.0"
                        }).to_string();
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            payload.len(),
                            payload
                        );
                        let _ = socket.write_all(resp.as_bytes()).await;
                        return;
                    }

                    if method == "POST" {
                        // Parse Content-Length to ensure complete body
                        let content_len = headers.lines()
                            .find(|l| l.to_ascii_lowercase().starts_with("content-length:"))
                            .and_then(|l| l.split(':').nth(1))
                            .and_then(|s| s.trim().parse::<usize>().ok())
                            .unwrap_or(body_preview.len());

                        let mut full_body = body_preview.as_bytes().to_vec();
                        while full_body.len() < content_len {
                            let mut chunk = [0u8; 4096];
                            match socket.read(&mut chunk).await {
                                Ok(0) => break,
                                Ok(n) => full_body.extend_from_slice(&chunk[..n]),
                                Err(_) => break,
                            }
                        }

                        let body_str = String::from_utf8_lossy(&full_body);
                        let rpc_res = handle_mcp_jsonrpc(&state_clone, &body_str).await;
                        let resp_body = rpc_res.to_string();

                        let http_resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            resp_body.len(),
                            resp_body
                        );
                        let _ = socket.write_all(http_resp.as_bytes()).await;
                    }
                });
            }
        }
    }

    Ok(())
}
