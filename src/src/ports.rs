use serde::{Deserialize, Serialize};
use std::io::Read;
use crate::{AppState, HostConfig};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocketEntry {
    pub protocol: String,
    pub local_addr: String,
    pub local_ip: String,
    pub local_port: u16,
    pub foreign_addr: String,
    pub remote_ip: String,
    pub foreign_port: u16,
    pub state: String,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub is_docker: bool,
    pub is_loopback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortInspectionResult {
    pub sockets: Vec<SocketEntry>,
}

fn parse_hex_ip4(hex: &str) -> String {
    if let Ok(num) = u32::from_str_radix(hex, 16) {
        let b = num.to_le_bytes();
        format!("{}.{}.{}.{}", b[0], b[1], b[2], b[3])
    } else {
        hex.to_string()
    }
}

fn parse_hex_ip(hex: &str) -> String {
    if hex.len() == 32 {
        if hex.chars().all(|c| c == '0') {
            return "::".to_string();
        }
        if hex == "00000000000000000000000001000000" {
            return "::1".to_string();
        }
        if hex.len() == 32 && &hex[..24] == "0000000000000000FFFF0000" {
            return parse_hex_ip4(&hex[24..32]);
        }
        return "::".to_string();
    }
    parse_hex_ip4(hex)
}

fn parse_hex_port(hex: &str) -> u16 {
    u16::from_str_radix(hex, 16).unwrap_or(0)
}

fn tcp_state_name(st: &str) -> &'static str {
    match st {
        "01" => "ESTABLISHED",
        "02" => "SYN_SENT",
        "03" => "SYN_RECV",
        "04" => "FIN_WAIT1",
        "05" => "FIN_WAIT2",
        "06" => "TIME_WAIT",
        "07" => "CLOSE",
        "08" => "CLOSE_WAIT",
        "09" => "LAST_ACK",
        "0A" => "LISTEN",
        "0B" => "CLOSING",
        _ => "UNKNOWN",
    }
}

pub(crate) fn parse_proc_net_entries(content: &str, protocol: &str, out: &mut Vec<SocketEntry>) {
    for line in content.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 4 {
            continue;
        }
        let local_parts: Vec<&str> = parts[1].split(':').collect();
        let rem_parts: Vec<&str> = parts[2].split(':').collect();
        let state_hex = parts[3];

        if local_parts.len() == 2 && rem_parts.len() == 2 {
            let local_ip = parse_hex_ip(local_parts[0]);
            let local_port = parse_hex_port(local_parts[1]);
            let rem_ip = parse_hex_ip(rem_parts[0]);
            let rem_port = parse_hex_port(rem_parts[1]);

            let state = if protocol.starts_with("UDP") {
                "UNCONN".to_string()
            } else {
                tcp_state_name(state_hex).to_string()
            };

            let is_loopback = local_ip.starts_with("127.") || local_ip == "::1";

            out.push(SocketEntry {
                protocol: protocol.to_string(),
                local_addr: local_ip.clone(),
                local_ip,
                local_port,
                foreign_addr: rem_ip.clone(),
                remote_ip: rem_ip,
                foreign_port: rem_port,
                state,
                pid: None,
                process_name: None,
                is_docker: false,
                is_loopback,
            });
        }
    }
}

#[tauri::command]
pub async fn get_port_inspection(
    state: tauri::State<'_, AppState>,
    host: Option<HostConfig>,
) -> Result<PortInspectionResult, String> {
    if let Some(h) = host {
        if !h.enable_port_scan {
            return Ok(PortInspectionResult { sockets: vec![] });
        }
        let sess = state.take_ssh_session(&h)?;
        let mut sockets = Vec::new();

        let query_res = (|| -> Result<String, String> {
            let mut ch = sess.channel_session().map_err(|e| format!("Channel error: {}", e))?;
            ch.exec("cat /proc/net/tcp 2>/dev/null; echo '---TCP6---'; cat /proc/net/tcp6 2>/dev/null; echo '---UDP---'; cat /proc/net/udp 2>/dev/null; echo '---UDP6---'; cat /proc/net/udp6 2>/dev/null")
                .map_err(|e| format!("Exec error: {}", e))?;
            let mut out = String::new();
            ch.read_to_string(&mut out).map_err(|e| format!("Read error: {}", e))?;
            let _ = ch.wait_close();
            Ok(out)
        })();

        if let Ok(content) = query_res {
            state.return_ssh_session(&h, sess);
            let mut parts = content.split("---TCP6---");
            if let Some(tcp) = parts.next() {
                parse_proc_net_entries(tcp, "TCP", &mut sockets);
            }
            if let Some(rest) = parts.next() {
                let mut parts2 = rest.split("---UDP---");
                if let Some(tcp6) = parts2.next() {
                    parse_proc_net_entries(tcp6, "TCP6", &mut sockets);
                }
                if let Some(rest2) = parts2.next() {
                    let mut parts3 = rest2.split("---UDP6---");
                    if let Some(udp) = parts3.next() {
                        parse_proc_net_entries(udp, "UDP", &mut sockets);
                    }
                    if let Some(udp6) = parts3.next() {
                        parse_proc_net_entries(udp6, "UDP6", &mut sockets);
                    }
                }
            }
        }

        sockets.sort_by_key(|s| (s.local_port, s.protocol.clone()));

        Ok(PortInspectionResult { sockets })
    } else {
        use netstat2::*;
        let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
        let proto_flags = ProtocolFlags::TCP | ProtocolFlags::UDP;

        let sys = sysinfo::System::new_with_specifics(
            sysinfo::RefreshKind::new().with_processes(sysinfo::ProcessRefreshKind::new())
        );
        let sockets_info = get_sockets_info(af_flags, proto_flags)
            .map_err(|e| format!("Failed to inspect local sockets: {}", e))?;

        let mut sockets = Vec::new();
        for s in sockets_info {
            let (protocol, local_addr, local_port, foreign_addr, foreign_port, state) = match s.protocol_socket_info {
                ProtocolSocketInfo::Tcp(tcp) => {
                    let state_str = format!("{:?}", tcp.state).to_uppercase();
                    let proto = if tcp.local_addr.is_ipv6() { "TCP6" } else { "TCP" };
                    (proto.to_string(), tcp.local_addr.to_string(), tcp.local_port, tcp.remote_addr.to_string(), tcp.remote_port, state_str)
                }
                ProtocolSocketInfo::Udp(udp) => {
                    let proto = if udp.local_addr.is_ipv6() { "UDP6" } else { "UDP" };
                    (proto.to_string(), udp.local_addr.to_string(), udp.local_port, "*".to_string(), 0, "UNCONN".to_string())
                }
            };

            let pid = s.associated_pids.first().copied();
            let process_name = pid.and_then(|p| {
                sys.process(sysinfo::Pid::from(p as usize)).map(|proc| proc.name().to_string())
            });

            let is_loopback = local_addr.starts_with("127.") || local_addr == "::1";
            let is_docker = process_name.as_deref().map(|n| {
                let low = n.to_lowercase();
                low.contains("docker") || low.contains("podman")
            }).unwrap_or(false);

            sockets.push(SocketEntry {
                protocol,
                local_addr: local_addr.clone(),
                local_ip: local_addr,
                local_port,
                foreign_addr: foreign_addr.clone(),
                remote_ip: foreign_addr,
                foreign_port,
                state,
                pid,
                process_name,
                is_docker,
                is_loopback,
            });
        }

        sockets.sort_by_key(|s| (s.local_port, s.protocol.clone()));

        Ok(PortInspectionResult { sockets })
    }
}
