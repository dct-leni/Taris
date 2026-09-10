use std::path::PathBuf;
use taris_lib::docker::query_docker_remote;
use taris_lib::ssh::keys::{check_ssh_key_permissions, fix_ssh_key_permissions};
use taris_lib::ssh::session::open_russh_session;
use taris_lib::clipboard_utils;
use taris_lib::{
    cleanup_unused_icons, delete_local_file_path, discover_available_shells, find_git_bash,
    is_command_in_path, load_or_init_config, AppConfig, HostConfig, SettingsConfig,
};

#[tokio::test]
async fn test_open_russh_session() {
    let host = HostConfig {
        id: "test".into(),
        name: "test-server".into(),
        host: "127.0.0.1".into(),
        port: 22,
        user: "testuser".into(),
        auth_type: "password".into(),
        key_path: None,
        password: Some("testpass".into()),
        has_docker: true,
        icon: "".into(),
        docker_port: None,
        enable_port_scan: true,
        mac_address: None,
        cloud_provider: None,
        cloud_project_id: None,
        cloud_zone: None,
        cloud_instance_id: None,
        network_route: None,
        protocol: None,
    };
    let _ = open_russh_session(&host).await;
}

#[test]
fn test_config_resolution() {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut found = None;
    if cwd.join("config.toml").exists() {
        found = Some(cwd.join("config.toml"));
    }
    if found.is_none() {
        if let Some(parent) = cwd.parent() {
            let p = parent.join("config.toml");
            if p.exists() {
                found = Some(p);
            }
        }
    }
    assert!(found.is_some(), "config.toml should be found in workspace");
    let cfg = load_or_init_config(&found.unwrap());
    assert!(cfg.hosts.len() >= 2, "Expected at least 2 hosts in config");
    assert!(cfg.netbird.is_some(), "Expected netbird configured");
}

#[test]
fn test_is_command_in_path() {
    #[cfg(target_os = "windows")]
    {
        assert!(is_command_in_path("cmd"), "cmd should be in PATH on Windows");
        assert!(is_command_in_path("cmd.exe"), "cmd.exe should be in PATH on Windows");
    }
    #[cfg(not(target_os = "windows"))]
    {
        assert!(is_command_in_path("sh"), "sh should be in PATH on Unix");
    }
}

#[test]
fn test_clipboard_reader() {
    let res = clipboard_utils::get_files();
    assert!(res.is_ok());
}

#[test]
fn test_clipboard_text() {
    let sample = "Taris clipboard integration test";
    let write_res = clipboard_utils::set_text(sample);
    assert!(write_res.is_ok());
    let read_res = clipboard_utils::get_text();
    assert!(read_res.is_ok());
    assert_eq!(read_res.unwrap(), sample);
}

#[test]
fn test_delete_local_file_and_dir() {
    let temp_dir = std::env::temp_dir().join("taris_delete_test");
    let _ = std::fs::create_dir_all(&temp_dir);
    let test_file = temp_dir.join("temp_to_delete.txt");
    std::fs::write(&test_file, "hello delete").unwrap();
    assert!(test_file.exists());

    let res = delete_local_file_path(&test_file.to_string_lossy());
    assert!(res.is_ok());
    assert!(!test_file.exists());

    let sub_dir = temp_dir.join("sub_folder");
    std::fs::create_dir_all(&sub_dir).unwrap();
    std::fs::write(sub_dir.join("child.txt"), "child data").unwrap();
    assert!(sub_dir.exists());

    let res_dir = delete_local_file_path(&sub_dir.to_string_lossy());
    assert!(res_dir.is_ok());
    assert!(!sub_dir.exists());

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn test_remote_docker_and_ports() {
    let host = HostConfig {
        id: "test".into(),
        name: "test-server".into(),
        host: "127.0.0.1".into(),
        port: 22,
        user: "testuser".into(),
        auth_type: "password".into(),
        key_path: None,
        password: Some("testpass".into()),
        has_docker: true,
        icon: "".into(),
        docker_port: Some(2375),
        enable_port_scan: true,
        mac_address: None,
        cloud_provider: None,
        cloud_project_id: None,
        cloud_zone: None,
        cloud_instance_id: None,
        network_route: None,
        protocol: None,
    };
    if let Ok(handle) = open_russh_session(&host).await {
        let containers_res = query_docker_remote(&handle, 2375, "GET", "/containers/json?all=1").await;
        if let Ok(body) = containers_res {
            assert!(body.starts_with('['));
            println!("Containers JSON returned, length: {}", body.len());
        }
    }
}

#[test]
fn test_local_netstat2() {
    use netstat2::*;
    let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto_flags = ProtocolFlags::TCP | ProtocolFlags::UDP;
    let sockets = get_sockets_info(af_flags, proto_flags).unwrap();
    println!("netstat2 total active sockets found: {}", sockets.len());
    assert!(!sockets.is_empty());
    for s in sockets.iter().take(5) {
        match &s.protocol_socket_info {
            ProtocolSocketInfo::Tcp(tcp) => {
                println!(
                    "  TCP {}:{} -> {}:{} State: {:?} PIDs: {:?}",
                    tcp.local_addr, tcp.local_port, tcp.remote_addr, tcp.remote_port, tcp.state, s.associated_pids
                );
            }
            ProtocolSocketInfo::Udp(udp) => {
                println!("  UDP {}:{} PIDs: {:?}", udp.local_addr, udp.local_port, s.associated_pids);
            }
        }
    }
}

#[test]
fn test_snippet_and_icon_cleanup() {
    let temp_dir = std::env::temp_dir().join("taris_test_icons");
    let _ = std::fs::create_dir_all(&temp_dir);
    let config_file = temp_dir.join("config.toml");
    let ui_icons_dir = temp_dir.join("ui").join("icons");
    let _ = std::fs::create_dir_all(&ui_icons_dir);

    // Create 2 test icons: 1 used, 1 unused
    let used_icon_path = ui_icons_dir.join("used_node.svg");
    let unused_icon_path = ui_icons_dir.join("unused_trash.svg");
    std::fs::write(&used_icon_path, "<svg>used</svg>").unwrap();
    std::fs::write(&unused_icon_path, "<svg>unused</svg>").unwrap();

    let hosts = vec![HostConfig {
        id: "host-1".into(),
        name: "Server 1".into(),
        host: "10.0.0.1".into(),
        port: 22,
        user: "root".into(),
        auth_type: "key".into(),
        key_path: None,
        password: None,
        has_docker: false,
        icon: "icons/used_node.svg".into(),
        docker_port: None,
        enable_port_scan: true,
        mac_address: None,
        cloud_provider: None,
        cloud_project_id: None,
        cloud_zone: None,
        cloud_instance_id: None,
        network_route: None,
        protocol: None,
    }];

    cleanup_unused_icons(&config_file, &hosts);

    assert!(used_icon_path.exists(), "Used icon should NOT be deleted");
    assert!(!unused_icon_path.exists(), "Unused icon SHOULD be deleted by cleanup");

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_parse_workspace_config() {
    let content = if std::path::Path::new("config.example.toml").exists() {
        std::fs::read_to_string("config.example.toml").unwrap()
    } else {
        include_str!("../../config.example.toml").to_string()
    };
    let res = toml::from_str::<AppConfig>(&content);
    match res {
        Ok(c) => {
            println!("SUCCESS! Hosts len = {}", c.hosts.len());
            assert_eq!(c.settings.app_theme, "one_dark");
            assert_eq!(c.settings.terminal_theme, "one_dark");
        }
        Err(e) => panic!("FAILED TO PARSE: {}", e),
    }
}

#[test]
fn test_theme_and_cursor_settings() {
    let toml_str = r#"
        font_family = "Cascadia Code"
        font_size = 14
        theme = "dracula"
        app_theme = "tokyo_night"
        terminal_theme = "nord"
        default_shell = "powershell"
        cursor_blink = true
    "#;
    let s: SettingsConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(s.app_theme, "tokyo_night");
    assert_eq!(s.terminal_theme, "nord");
    assert_eq!(s.theme, "dracula");
    assert_eq!(s.enable_multiplexing, true);
    assert_eq!(s.enable_ssh_compression, false);
}

#[test]
fn test_discover_available_shells() {
    let shells = discover_available_shells();
    println!("Discovered shells: {:?}", shells);
    assert!(!shells.is_empty(), "Should discover at least one shell");
    let has_ps = shells.iter().any(|s| s.id == "powershell");
    assert!(has_ps, "Should find PowerShell");
    let has_git_bash = shells.iter().any(|s| s.id == "git-bash");
    if find_git_bash().is_some() {
        assert!(has_git_bash, "Should detect Git Bash if it is installed on system");
    }
}

#[test]
fn test_ssh_key_permissions() {
    let temp_dir = std::env::temp_dir().join("taris_perm_test");
    let _ = std::fs::create_dir_all(&temp_dir);
    let test_key = temp_dir.join("test_dummy_key.pem");
    std::fs::write(&test_key, "dummy key content").unwrap();

    let path_str = test_key.to_string_lossy().to_string();
    let check_res = check_ssh_key_permissions(path_str.clone()).unwrap();
    assert!(check_res.exists);

    let fix_res = fix_ssh_key_permissions(path_str.clone()).unwrap();
    assert!(fix_res.exists);
    assert!(!fix_res.too_open, "Permissions must be secured after fix: {}", fix_res.details);

    let _ = std::fs::remove_file(test_key);
    let _ = std::fs::remove_dir_all(temp_dir);
}
