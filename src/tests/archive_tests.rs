use taris_lib::archive::read_zip_entries;

#[test]
fn test_zip_in_memory_creation_and_inspection() {
    use std::io::Write;
    let mut buf = Vec::new();
    {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        writer.start_file("docs/readme.txt", options).unwrap();
        writer.write_all(b"Hello Taris Zip VFS!").unwrap();
        writer.add_directory("scripts/", options).unwrap();
        writer.finish().unwrap();
    }

    let reader = std::io::Cursor::new(buf);
    let entries = read_zip_entries(reader).unwrap();

    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].path, "docs/readme.txt");
    assert_eq!(entries[0].name, "readme.txt");
    assert_eq!(entries[0].size, 20);
    assert!(!entries[0].is_dir);

    assert_eq!(entries[1].path, "scripts/");
    assert_eq!(entries[1].name, "scripts");
    assert!(entries[1].is_dir);
}
