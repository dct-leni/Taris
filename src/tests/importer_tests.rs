use taris_lib::importer::{parse_filezilla_xml, parse_mobaxterm_ini, parse_openssh_config};

#[test]
fn test_parse_openssh_config() {
    let conf = r#"
Host production
    HostName 10.0.0.1
    User admin
    Port 2200
    IdentityFile ~/.ssh/prod.pem

Host staging
    HostName 10.0.0.2
    User dev
"#;
    let hosts = parse_openssh_config(conf);
    assert_eq!(hosts.len(), 2);
    assert_eq!(hosts[0].name, "production");
    assert_eq!(hosts[0].host, "10.0.0.1");
    assert_eq!(hosts[0].port, 2200);
    assert_eq!(hosts[0].user, "admin");
    assert!(hosts[0].key_path.is_some());

    assert_eq!(hosts[1].name, "staging");
    assert_eq!(hosts[1].host, "10.0.0.2");
    assert_eq!(hosts[1].port, 22);
    assert_eq!(hosts[1].user, "dev");
}

#[test]
fn test_parse_mobaxterm_ini() {
    let ini = r#"
[Bookmarks]
SubRep=
My NAS = #109#0%192.168.1.10%22%root%%%0%0%0%%-1%0%0%0%%1080%%0%0%1#MobaFont%10%0%0%0%15%236,236,236%0,0,0%180,180,180%0%0%0%
"#;
    let hosts = parse_mobaxterm_ini(ini);
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].name, "My NAS");
    assert_eq!(hosts[0].host, "192.168.1.10");
    assert_eq!(hosts[0].port, 22);
    assert_eq!(hosts[0].user, "root");
}

#[test]
fn test_parse_filezilla_xml() {
    let xml = r#"
<FileZilla3>
    <Servers>
        <Server>
            <Host>ftp.example.com</Host>
            <Port>2222</Port>
            <Protocol>1</Protocol>
            <Type>0</Type>
            <User>myuser</User>
            <Name>Example SFTP</Name>
        </Server>
    </Servers>
</FileZilla3>
"#;
    let hosts = parse_filezilla_xml(xml);
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].name, "Example SFTP");
    assert_eq!(hosts[0].host, "ftp.example.com");
    assert_eq!(hosts[0].port, 2222);
    assert_eq!(hosts[0].user, "myuser");
}
