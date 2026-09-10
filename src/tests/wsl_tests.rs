use taris_lib::wsl::{create_wsl_host_config, decode_utf16_or_utf8, get_wsl_status, is_wsl_installed, WslDistro};

#[test]
fn test_wsl_detection() {
    let installed = is_wsl_installed();
    // Verify that the call is non-blocking, does not panic, and returns boolean
    #[cfg(not(target_os = "windows"))]
    assert!(!installed, "WSL should report not installed on non-Windows");

    let status = get_wsl_status();
    assert_eq!(status.is_installed, installed);
}

#[test]
fn test_wsl_create_host_config() {
    let distro = WslDistro {
        id: "{12345678-ABCD-EF01-2345-6789ABCDEF01}".into(),
        name: "Ubuntu-24.04".into(),
        version: 2,
        base_path: "C:\\Users\\test\\AppData\\Local\\Packages\\CanonicalGroupLimited...".into(),
        default_uid: 1000,
        is_default: true,
        state: "Stopped".into(),
        plan9_path: r"\\wsl.localhost\Ubuntu-24.04".into(),
        ip_address: None,
        image_size: Some(1024 * 1024 * 1024),
        image_size_formatted: Some("1.0 GB".into()),
    };

    let host = create_wsl_host_config(&distro);
    assert_eq!(host.id, "wsl-ubuntu-24.04");
    assert_eq!(host.name, "Ubuntu-24.04 (WSL)");
    assert_eq!(host.icon, "\u{f17c}"); // Linux penguin
    assert_eq!(host.protocol, Some("wsl:Ubuntu-24.04".into()));
    assert_eq!(host.user, "user");
}

#[test]
fn test_wsl_root_user_mapping() {
    let distro_root = WslDistro {
        id: "{11111111-2222-3333-4444-555555555555}".into(),
        name: "Alpine".into(),
        version: 2,
        base_path: "C:\\WSL\\Alpine".into(),
        default_uid: 0,
        is_default: false,
        state: "Running".into(),
        plan9_path: r"\\wsl.localhost\Alpine".into(),
        ip_address: None,
        image_size: None,
        image_size_formatted: None,
    };

    let host_root = create_wsl_host_config(&distro_root);
    assert_eq!(host_root.user, "root");
    assert_eq!(host_root.protocol, Some("wsl:Alpine".into()));
}

#[test]
fn test_wsl_plan9_path_format() {
    let distro = WslDistro {
        id: "test-guid".into(),
        name: "Debian".into(),
        version: 2,
        base_path: "C:\\WSL\\Debian".into(),
        default_uid: 1000,
        is_default: false,
        state: "Stopped".into(),
        plan9_path: format!(r"\\wsl.localhost\{}", "Debian"),
        ip_address: None,
        image_size: None,
        image_size_formatted: None,
    };

    assert_eq!(distro.plan9_path, r"\\wsl.localhost\Debian");
}

#[test]
fn test_normalize_wsl_mount_paths() {
    #[cfg(target_os = "windows")]
    {
        use taris_lib::normalize_local_path;
        assert_eq!(
            normalize_local_path(r"\\wsl.localhost\Ubuntu-26.04\mnt/c/Users/Leni/Desktop/Projects/SSH_Term"),
            r"C:\Users\Leni\Desktop\Projects\SSH_Term"
        );
        assert_eq!(
            normalize_local_path(r"\\wsl.localhost\Ubuntu-26.04\mnt\c\Users\Leni"),
            r"C:\Users\Leni"
        );
        assert_eq!(
            normalize_local_path("/mnt/c/Users/Leni/Desktop/Projects/SSH_Term"),
            r"C:\Users\Leni\Desktop\Projects\SSH_Term"
        );
        assert_eq!(
            normalize_local_path("/mnt/d/games"),
            r"D:\games"
        );
        assert_eq!(
            normalize_local_path("/mnt/c"),
            r"C:\"
        );
        assert_eq!(
            normalize_local_path(r"\\wsl.localhost\Ubuntu-26.04\home\leni"),
            r"\\wsl.localhost\Ubuntu-26.04\home\leni"
        );
        assert_eq!(
            normalize_local_path("/c/Users/Leni"),
            r"C:\Users\Leni"
        );
    }
}

#[test]
fn test_wsl_decode_utf16_and_utf8() {
    // 1. Test UTF-16LE encoded bytes (e.g. from wsl.exe CLI on Windows)
    let sample = "Ubuntu\r\nDebian\r\n";
    let utf16_bytes: Vec<u8> = sample
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();

    let decoded = decode_utf16_or_utf8(&utf16_bytes);
    assert_eq!(decoded, sample);

    // 2. Test standard UTF-8 bytes
    let utf8_bytes = b"ArchLinux\r\nKali\r\n";
    let decoded_utf8 = decode_utf16_or_utf8(utf8_bytes);
    assert_eq!(decoded_utf8, "ArchLinux\r\nKali\r\n");
}

#[tokio::test]
async fn test_wsl_get_available_distros() {
    use taris_lib::wsl::get_available_wsl_distros;
    let distros = get_available_wsl_distros().await;
    #[cfg(target_os = "windows")]
    if taris_lib::wsl::is_wsl_installed() {
        assert!(!distros.is_empty(), "WSL online distros should not be empty when WSL is installed");
        assert!(distros.iter().any(|d| d.name.to_lowercase().contains("ubuntu")), "Must contain Ubuntu");
    }
}

#[tokio::test]
async fn test_wsl_import_validation() {
    use taris_lib::wsl::import_wsl_distro;
    // Empty distro name should fail validation
    let res = import_wsl_distro("", "C:\\WSL\\test", "C:\\test.tar").await;
    assert!(res.is_err(), "Empty distro name must return Err");

    // Empty file path should fail validation
    let res2 = import_wsl_distro("test-box", "C:\\WSL\\test", "").await;
    assert!(res2.is_err(), "Empty file path must return Err");
}
