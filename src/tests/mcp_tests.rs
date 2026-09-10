use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use taris_lib::mcp::{handle_mcp_jsonrpc, start_mcp_server};
use taris_lib::ssh::SshSessionPool;
use taris_lib::{AppConfig, AppState, HostConfig};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::broadcast;

fn create_test_state() -> (AppState, std::path::PathBuf) {
    let temp_dir = std::env::temp_dir().join(format!(
        "taris_mcp_test_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);
    let config_path = temp_dir.join("config.toml");

    let mut cfg = AppConfig::default();
    cfg.hosts.push(HostConfig {
        id: "prod-bastion".into(),
        name: "Production Bastion".into(),
        host: "10.0.0.1".into(),
        port: 2222,
        user: "admin".into(),
        auth_type: "password".into(),
        key_path: Some("/home/admin/.ssh/id_ed25519".into()),
        password: Some("SUPER_SECRET_PASSWORD_123".into()),
        has_docker: true,
        icon: "\u{f233}".into(),
        docker_port: Some(2375),
        enable_port_scan: false,
        mac_address: None,
        cloud_provider: Some("gcp".into()),
        cloud_project_id: Some("prod-proj".into()),
        cloud_zone: Some("us-central1-a".into()),
        cloud_instance_id: None,
        network_route: Some("direct".into()),
        protocol: Some("ssh".into()),
    });

    std::fs::write(&config_path, toml::to_string_pretty(&cfg).unwrap()).unwrap();

    let state = AppState {
        pty_sessions: Arc::new(Mutex::new(HashMap::new())),
        config_path: config_path.clone(),
        ssh_pool: SshSessionPool::new(),
        docker_cpu_samples: Arc::new(Mutex::new(HashMap::new())),
        active_tunnels: Arc::new(Mutex::new(HashMap::new())),
        mesh: Arc::new(taris_lib::mesh::MeshState::default()),
        mcp_handle: Arc::new(Mutex::new(None)),
    };

    (state, temp_dir)
}

#[tokio::test]
async fn test_mcp_protocol_initialize_and_ping() {
    let (state, temp_dir) = create_test_state();

    let init_req = r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#;
    let res = handle_mcp_jsonrpc(&state, init_req).await;
    assert_eq!(res["jsonrpc"], "2.0");
    assert_eq!(res["id"], 1);
    assert_eq!(res["result"]["protocolVersion"], "2024-11-05");
    assert_eq!(res["result"]["serverInfo"]["name"], "taris");

    let ping_req = r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#;
    let ping_res = handle_mcp_jsonrpc(&state, ping_req).await;
    assert_eq!(ping_res["id"], 2);

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_mcp_tools_list() {
    let (state, temp_dir) = create_test_state();

    let req = r#"{"jsonrpc":"2.0","id":10,"method":"tools/list"}"#;
    let res = handle_mcp_jsonrpc(&state, req).await;
    assert_eq!(res["id"], 10);

    let tools = res["result"]["tools"].as_array().expect("tools array");
    let tool_names: Vec<&str> = tools
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();

    assert!(tool_names.contains(&"list_hosts"), "missing list_hosts");
    assert!(tool_names.contains(&"execute_command"), "missing execute_command");
    assert!(tool_names.contains(&"list_containers"), "missing list_containers");
    assert!(tool_names.contains(&"read_remote_file"), "missing read_remote_file");
    assert!(tool_names.contains(&"list_notes"), "missing list_notes");
    assert!(tool_names.contains(&"add_notes"), "missing add_notes");
    assert!(tool_names.contains(&"list_wsl_distros"), "missing list_wsl_distros");
    assert!(tool_names.contains(&"add_wsl_distro"), "missing add_wsl_distro");
    assert!(tool_names.contains(&"list_cloud_instances"), "missing list_cloud_instances");

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_mcp_credential_boundary_isolation() {
    let (state, temp_dir) = create_test_state();

    let req = r#"{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"list_hosts","arguments":{}}}"#;
    let res = handle_mcp_jsonrpc(&state, req).await;
    assert_eq!(res["id"], 20);

    let text = res["result"]["content"][0]["text"].as_str().expect("text output");

    // Must contain safe fields
    assert!(text.contains("prod-bastion"), "Should contain host ID");
    assert!(text.contains("Production Bastion"), "Should contain host name");
    assert!(text.contains("10.0.0.1"), "Should contain host address");
    assert!(text.contains("has_key"), "Should contain key presence flag");

    // MUST NEVER leak credentials or private keys
    assert!(!text.contains("SUPER_SECRET_PASSWORD_123"), "CRITICAL: Password leaked in MCP tool!");
    assert!(!text.contains("id_ed25519"), "CRITICAL: Key path leaked in MCP tool!");

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_mcp_notes_crud() {
    let (state, temp_dir) = create_test_state();

    // 1. List notes initially
    let list_req = r#"{"jsonrpc":"2.0","id":30,"method":"tools/call","params":{"name":"list_notes","arguments":{}}}"#;
    let list_res = handle_mcp_jsonrpc(&state, list_req).await;
    let text = list_res["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("Docker PS"), "Should contain default snippet");

    // 2. Add note
    let add_req = r#"{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"add_notes","arguments":{"title":"MCP Test Note","command":"echo hello mcp","tags":"ai,test"}}}"#;
    let add_res = handle_mcp_jsonrpc(&state, add_req).await;
    assert!(add_res["result"]["content"][0]["text"].as_str().unwrap().contains("successfully"));

    // 3. List again to verify persistence in config
    let list_req2 = r#"{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"list_notes","arguments":{}}}"#;
    let list_res2 = handle_mcp_jsonrpc(&state, list_req2).await;
    let text2 = list_res2["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text2.contains("MCP Test Note"), "Should contain newly added snippet");
    assert!(text2.contains("echo hello mcp"), "Should contain command text");

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_mcp_http_and_sse_server_endpoint() {
    let (state, temp_dir) = create_test_state();
    let port = 18765;
    let (shutdown_tx, shutdown_rx) = broadcast::channel(1);

    let state_clone = state.clone();
    let server_handle = tokio::spawn(async move {
        start_mcp_server(state_clone, port, shutdown_rx).await
    });

    // Give the server a moment to bind
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // 1. HTTP GET discovery
    let mut stream = TcpStream::connect(format!("127.0.0.1:{}", port)).await.expect("connect");
    let req = format!("GET /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n", port);
    stream.write_all(req.as_bytes()).await.unwrap();
    let mut resp = String::new();
    stream.read_to_string(&mut resp).await.unwrap();
    assert!(resp.contains("200 OK"), "GET /mcp should return 200 OK");
    assert!(resp.contains(r#""protocol":"mcp""#), "Should contain MCP protocol marker");

    // 2. HTTP POST JSON-RPC
    let mut stream_post = TcpStream::connect(format!("127.0.0.1:{}", port)).await.expect("connect");
    let body = r#"{"jsonrpc":"2.0","id":100,"method":"tools/list"}"#;
    let post_req = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}",
        port,
        body.len(),
        body
    );
    stream_post.write_all(post_req.as_bytes()).await.unwrap();
    let mut post_resp = String::new();
    stream_post.read_to_string(&mut post_resp).await.unwrap();
    assert!(post_resp.contains("200 OK"), "POST /mcp should return 200 OK");
    assert!(post_resp.contains("list_hosts"), "POST response should contain list_hosts");

    // 3. SSE Endpoint test
    let mut stream_sse = TcpStream::connect(format!("127.0.0.1:{}", port)).await.expect("connect");
    let sse_req = format!(
        "GET /mcp HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAccept: text/event-stream\r\nConnection: keep-alive\r\n\r\n",
        port
    );
    stream_sse.write_all(sse_req.as_bytes()).await.unwrap();
    let mut sse_header_buf = [0u8; 512];
    let n = stream_sse.read(&mut sse_header_buf).await.unwrap();
    let sse_str = String::from_utf8_lossy(&sse_header_buf[..n]);
    assert!(sse_str.contains("text/event-stream"), "SSE request should return text/event-stream");
    assert!(sse_str.contains("event: endpoint"), "SSE response should send endpoint event");

    // 4. Shutdown cleanly
    let _ = shutdown_tx.send(());
    let _ = tokio::time::timeout(std::time::Duration::from_millis(500), server_handle).await;
    let _ = std::fs::remove_dir_all(&temp_dir);
}
