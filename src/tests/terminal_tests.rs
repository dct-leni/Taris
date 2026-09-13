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

#[test]
fn test_utf8_chunk_decoder_complete() {
    use taris_lib::terminal::Utf8ChunkDecoder;
    let mut decoder = Utf8ChunkDecoder::new();
    let text = "Hello world! ✔ Progress: [████] 100%\r\n";
    let decoded = decoder.feed(text.as_bytes());
    assert_eq!(decoded.as_deref(), Some(text));
    assert!(decoder.flush().is_none());
}

#[test]
fn test_utf8_chunk_decoder_split_multibyte() {
    use taris_lib::terminal::Utf8ChunkDecoder;
    let mut decoder = Utf8ChunkDecoder::new();
    
    // '█' is 3 bytes: 0xE2 0x96 0x88
    // Chunk 1: "Progress: [" + 0xE2 0x96 (incomplete 2 bytes)
    let mut chunk1 = b"Progress: [".to_vec();
    chunk1.push(0xE2);
    chunk1.push(0x96);

    let decoded1 = decoder.feed(&chunk1);
    assert_eq!(decoded1.as_deref(), Some("Progress: ["));

    // Chunk 2: 0x88 (completes '█') + "] Done\r\n"
    let mut chunk2 = vec![0x88];
    chunk2.extend_from_slice(b"] Done\r\n");

    let decoded2 = decoder.feed(&chunk2);
    assert_eq!(decoded2.as_deref(), Some("█] Done\r\n"));
    assert!(decoder.flush().is_none());
}

#[test]
fn test_utf8_chunk_decoder_split_checkmark_and_spinner() {
    use taris_lib::terminal::Utf8ChunkDecoder;
    let mut decoder = Utf8ChunkDecoder::new();

    // '✔' is 3 bytes: 0xE2 0x9C 0x94
    // Send 1 byte in chunk 1, 2 bytes in chunk 2
    let decoded1 = decoder.feed(&[0xE2]);
    assert_eq!(decoded1, None);

    let decoded2 = decoder.feed(&[0x9C, 0x94, b' ']);
    assert_eq!(decoded2.as_deref(), Some("✔ "));
}
