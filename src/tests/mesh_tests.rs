use taris_lib::mesh::netbird::{get_netbird_status, NetBirdConfig};
use taris_lib::mesh::tailscale::{get_tailscale_status, start_tailscale_forwarder, TailscaleConfig};
use taris_lib::mesh::wireguard::{decode_key_32, export_wireguard_conf, parse_wireguard_conf};

#[test]
fn test_wireguard_conf_parser_and_exporter() {
    let conf_content = r#"
# Name = Homelab Gateway
[Interface]
PrivateKey = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=
Address = 10.0.0.5/32
DNS = 1.1.1.1
ListenPort = 51820

[Peer]
PublicKey = bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=
Endpoint = vpn.homelab.org:51820
AllowedIPs = 10.0.0.0/24, 192.168.1.0/24
PersistentKeepalive = 25
"#;

    let parsed = parse_wireguard_conf(conf_content).expect("Failed to parse WG conf");
    assert_eq!(parsed.name, "Homelab Gateway");
    assert_eq!(parsed.interface_address, "10.0.0.5/32");
    assert_eq!(parsed.dns, Some("1.1.1.1".to_string()));
    assert_eq!(parsed.peer_endpoint, "vpn.homelab.org:51820");
    assert_eq!(parsed.persistent_keepalive, Some(25));
    assert_eq!(parsed.allowed_ips.len(), 2);

    let exported = export_wireguard_conf(&parsed);
    assert!(exported.contains("PrivateKey = aaaaa"));
    assert!(exported.contains("PublicKey = bbbbb"));
    assert!(exported.contains("Endpoint = vpn.homelab.org:51820"));
    assert!(exported.contains("AllowedIPs = 10.0.0.0/24, 192.168.1.0/24"));
}

#[test]
fn test_wireguard_key_decoder() {
    let key_b64 = "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE="; // 32 'a' bytes
    let decoded = decode_key_32(key_b64).expect("Should decode valid 32-byte key");
    assert_eq!(decoded, [b'a'; 32]);
}

#[tokio::test]
async fn test_tailscale_auth_key_status() {
    let config = TailscaleConfig {
        name: Some("Tailscale".to_string()),
        enabled: true,
        mode: "native".to_string(),
        auth_key: Some("tskey-auth-mock-test-key".to_string()),
        api_token: None,
        control_url: None,
        hostname: Some("taris-node".to_string()),
        socks5_port: Some(1055),
        exit_node: None,
    };

    let status = get_tailscale_status(&config).await;
    assert!(!status.backend_state.is_empty());
    assert!(status.hint.is_some());
}

#[tokio::test]
async fn test_tailscale_forwarder_bind() {
    let candidates = vec!["127.0.0.1:9".to_string()];
    let res = start_tailscale_forwarder(candidates, Some(1055)).await;
    assert!(res.is_ok());
    let port = res.unwrap();
    assert!(port > 0);
}

#[tokio::test]
async fn test_netbird_setup_key_status() {
    let config = NetBirdConfig {
        enabled: true,
        name: Some("TestNetBird".to_string()),
        management_url: "https://netbird.example.com".to_string(),
        personal_access_token: None,
        setup_key: Some("mock_test_key".to_string()),
        auto_sync_peers: true,
        exit_node: None,
        socks5_port: Some(1085),
    };

    let status = get_netbird_status(&config).await;
    assert!(status.connected);
    assert!(status.error.is_none());
    assert!(status.setup_key_info.is_some());
    assert_eq!(status.socks5_port, Some(1085));
}

#[tokio::test]
async fn test_netbird_forwarder_bind() {
    let candidates = vec!["127.0.0.1:9".to_string()];
    let res = taris_lib::mesh::netbird::start_netbird_forwarder("100.64.0.1".to_string(), 22, Some(1085), candidates).await;
    assert!(res.is_ok());
    let port = res.unwrap();
    assert!(port > 0);
}

