use taris_lib::terminal::zmodem::{
    build_zrinit, parse_zfile_body, ZmodemDetector, ZmodemState, ZDLE, ZHEX, ZPAD,
};

#[test]
fn test_zmodem_signature_detection() {
    assert!(ZmodemDetector::has_zmodem_signature(b"**\x18B00000000000000\r\x8a\x11"));
    assert!(ZmodemDetector::has_zmodem_signature(b"*\x18A\x01\0\0\0\0\0\0"));
    assert!(!ZmodemDetector::has_zmodem_signature(b"Hello world from bash\r\n"));
}

#[test]
fn test_zmodem_feed_idle_passthrough() {
    let mut detector = ZmodemDetector::new();
    let (out, ev) = detector.feed(b"ls -la /tmp\r\n");
    assert_eq!(out, b"ls -la /tmp\r\n");
    assert!(ev.is_none());
    assert_eq!(detector.state, ZmodemState::Idle);
}

#[test]
fn test_zmodem_hex_header_generation() {
    let header = build_zrinit();
    assert!(header.starts_with(&[ZPAD, ZPAD, ZDLE, ZHEX]));
    assert!(header.ends_with(&[0x11]));
}

#[test]
fn test_parse_zfile_payload() {
    let payload = b"archive.tar.gz\0 1048576 0755 0\0";
    let (name, size) = parse_zfile_body(payload);
    assert_eq!(name, "archive.tar.gz");
    assert_eq!(size, 1048576);
}
