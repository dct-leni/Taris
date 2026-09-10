use crc::{Crc, CRC_16_XMODEM, CRC_32_ISO_HDLC};
use serde::{Deserialize, Serialize};

pub const CRC16: Crc<u16> = Crc::<u16>::new(&CRC_16_XMODEM);
pub const CRC32: Crc<u32> = Crc::<u32>::new(&CRC_32_ISO_HDLC);

// ZMODEM Frame Types
pub const ZRQINIT: u8 = 0;   // Request receive init
pub const ZRINIT: u8 = 1;    // Receive init
pub const ZSINIT: u8 = 2;    // Send init sequence (optional)
pub const ZACK: u8 = 3;      // ACK to above
pub const ZFILE: u8 = 4;     // File name from sender
pub const ZSKIP: u8 = 5;     // Skip this file
pub const ZNAK: u8 = 6;      // Last packet was garbled
pub const ZABORT: u8 = 7;    // Abort batch
pub const ZFIN: u8 = 8;      // Finish session
pub const ZRPOS: u8 = 9;     // Resume data at this position
pub const ZDATA: u8 = 10;    // Data packet(s) follow
pub const ZEOF: u8 = 11;     // End of file
pub const ZFERR: u8 = 12;    // Fatal Read or Write error
pub const ZCRC: u8 = 13;     // Request for file CRC and response
pub const ZCHALLENGE: u8 = 14; // Receiver's Challenge
pub const ZCOMPL: u8 = 15;   // Request is complete
pub const ZCAN: u8 = 16;     // Other end canceled with CAN*5
pub const ZFREECNT: u8 = 17; // Request for free bytes on filesystem
pub const ZCOMMAND: u8 = 18; // Command from sending program

// Header Formats
pub const ZBIN: u8 = b'A';   // Binary 16-bit CRC
pub const ZHEX: u8 = b'B';   // Hex 16-bit CRC
pub const ZBIN32: u8 = b'C'; // Binary 32-bit CRC

pub const ZPAD: u8 = b'*';
pub const ZDLE: u8 = 0x18;   // Ctrl-X

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ZmodemEvent {
    DownloadOffer {
        filename: String,
        size: u64,
    },
    UploadRequest,
    Progress {
        bytes_transferred: u64,
        total_bytes: u64,
        percentage: f32,
    },
    Complete {
        filename: String,
        success: bool,
        message: String,
    },
    Canceled {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ZmodemState {
    Idle,
    AwaitingFileHeader,
    ReceivingData {
        filename: String,
        size: u64,
        transferred: u64,
    },
    SendingFile {
        filename: String,
        size: u64,
        transferred: u64,
    },
    Finished,
}

pub struct ZmodemDetector {
    pub state: ZmodemState,
    buffer: Vec<u8>,
}

impl Default for ZmodemDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl ZmodemDetector {
    pub fn new() -> Self {
        Self {
            state: ZmodemState::Idle,
            buffer: Vec::with_capacity(4096),
        }
    }

    /// Check if a slice has the ZMODEM signature (`**\x18B` or `*\x18A` or `*\x18C`)
    pub fn has_zmodem_signature(bytes: &[u8]) -> bool {
        if bytes.len() < 3 {
            return false;
        }
        for i in 0..bytes.len() - 2 {
            if bytes[i] == ZPAD && bytes[i + 1] == ZDLE && (bytes[i + 2] == ZHEX || bytes[i + 2] == ZBIN || bytes[i + 2] == ZBIN32) {
                return true;
            }
            if i + 3 < bytes.len() && bytes[i] == ZPAD && bytes[i + 1] == ZPAD && bytes[i + 2] == ZDLE && bytes[i + 3] == ZHEX {
                return true;
            }
        }
        false
    }

    /// Feeds incoming data, filters out ZMODEM control sequences from terminal display,
    /// and emits state machine events.
    pub fn feed(&mut self, incoming: &[u8]) -> (Vec<u8>, Option<ZmodemEvent>) {
        // If completely idle and no signature found, return original data directly
        if self.state == ZmodemState::Idle && !Self::has_zmodem_signature(incoming) {
            return (incoming.to_vec(), None);
        }

        self.buffer.extend_from_slice(incoming);

        // Check for CAN (5 consecutive Ctrl-X)
        if self.buffer.windows(5).any(|w| w == [0x18, 0x18, 0x18, 0x18, 0x18]) {
            self.state = ZmodemState::Idle;
            self.buffer.clear();
            return (
                Vec::new(),
                Some(ZmodemEvent::Canceled {
                    reason: "Transfer canceled by remote (CAN received)".into(),
                }),
            );
        }

        let mut event = None;
        let mut terminal_out = Vec::new();

        // Scan buffer for headers
        while !self.buffer.is_empty() {
            if let Some(pos) = self.find_header_start() {
                // Any bytes before header belong to terminal output
                if pos > 0 {
                    terminal_out.extend_from_slice(&self.buffer[..pos]);
                    self.buffer.drain(..pos);
                }

                // Try to parse header from start of buffer
                match self.try_parse_header() {
                    Ok(Some((header_type, flags, consumed))) => {
                        self.buffer.drain(..consumed);
                        let ev = self.handle_header(header_type, flags);
                        if ev.is_some() {
                            event = ev;
                        }
                    }
                    Ok(None) => {
                        // Incomplete header in buffer, wait for more data
                        break;
                    }
                    Err(_) => {
                        // Malformed header, skip 1 byte and continue
                        terminal_out.push(self.buffer[0]);
                        self.buffer.remove(0);
                    }
                }
            } else {
                // No header start found, flush buffer to terminal output
                terminal_out.append(&mut self.buffer);
                break;
            }
        }

        (terminal_out, event)
    }

    fn find_header_start(&self) -> Option<usize> {
        let b = &self.buffer;
        if b.len() < 3 {
            return None;
        }
        for i in 0..b.len() - 2 {
            if b[i] == ZPAD && b[i + 1] == ZDLE && (b[i + 2] == ZHEX || b[i + 2] == ZBIN || b[i + 2] == ZBIN32) {
                return Some(i);
            }
            if i + 3 < b.len() && b[i] == ZPAD && b[i + 1] == ZPAD && b[i + 2] == ZDLE && b[i + 3] == ZHEX {
                return Some(i);
            }
        }
        None
    }

    fn try_parse_header(&self) -> Result<Option<(u8, [u8; 4], usize)>, String> {
        let b = &self.buffer;
        if b.starts_with(&[ZPAD, ZPAD, ZDLE, ZHEX]) {
            // Hex Header format: **\x18B + 2 hex digits type + 8 hex digits flags + 4 hex digits crc + \r\n
            if b.len() < 20 {
                return Ok(None); // Need more bytes
            }
            let hex_str = std::str::from_utf8(&b[4..18]).map_err(|e| e.to_string())?;
            let header_type = u8::from_str_radix(&hex_str[0..2], 16).map_err(|e| e.to_string())?;
            let mut flags = [0u8; 4];
            for i in 0..4 {
                let s = &hex_str[2 + i * 2..4 + i * 2];
                flags[i] = u8::from_str_radix(s, 16).map_err(|e| e.to_string())?;
            }

            let mut consumed = 18;
            while consumed < b.len() && (b[consumed] == b'\r' || b[consumed] == 0x8a || b[consumed] == b'\n' || b[consumed] == 0x11) {
                consumed += 1;
            }
            return Ok(Some((header_type, flags, consumed)));
        }

        if b.starts_with(&[ZPAD, ZDLE, ZBIN]) {
            // Binary 16 Header: *\x18A + type (1 byte) + flags (4 bytes) + crc (2 bytes)
            if b.len() < 8 {
                return Ok(None);
            }
            let header_type = b[3];
            let mut flags = [0u8; 4];
            flags.copy_from_slice(&b[4..8]);
            return Ok(Some((header_type, flags, 10.min(b.len()))));
        }

        Ok(None)
    }

    fn handle_header(&mut self, header_type: u8, _flags: [u8; 4]) -> Option<ZmodemEvent> {
        match header_type {
            ZRQINIT => {
                // Remote invoked `sz` (send) - wants to send a file to us
                self.state = ZmodemState::AwaitingFileHeader;
                Some(ZmodemEvent::DownloadOffer {
                    filename: "incoming_transfer".into(),
                    size: 0,
                })
            }
            ZRINIT => {
                // Remote invoked `rz` (receive) - ready to receive a file from us
                self.state = ZmodemState::Idle;
                Some(ZmodemEvent::UploadRequest)
            }
            ZFILE => {
                // Extract file info from buffer if available
                self.state = ZmodemState::ReceivingData {
                    filename: "file.bin".into(),
                    size: 0,
                    transferred: 0,
                };
                None
            }
            ZFIN => {
                let prev_state = self.state.clone();
                self.state = ZmodemState::Finished;
                let filename = match prev_state {
                    ZmodemState::ReceivingData { filename, .. } => filename,
                    ZmodemState::SendingFile { filename, .. } => filename,
                    _ => "transfer".into(),
                };
                Some(ZmodemEvent::Complete {
                    filename,
                    success: true,
                    message: "ZMODEM transfer completed successfully".into(),
                })
            }
            _ => None,
        }
    }
}

/// Helper: construct a standard ZMODEM Hex Header
pub fn build_hex_header(header_type: u8, flags: [u8; 4]) -> Vec<u8> {
    let mut data = Vec::with_capacity(32);
    data.extend_from_slice(&[ZPAD, ZPAD, ZDLE, ZHEX]);

    let mut check_bytes = Vec::with_capacity(5);
    check_bytes.push(header_type);
    check_bytes.extend_from_slice(&flags);

    let crc = CRC16.checksum(&check_bytes);

    let hex_body = format!(
        "{:02x}{:02x}{:02x}{:02x}{:02x}{:04x}\r\n",
        header_type, flags[0], flags[1], flags[2], flags[3], crc
    );
    data.extend_from_slice(hex_body.as_bytes());

    if header_type != ZFIN && header_type != ZACK {
        data.push(0x11); // XON
    }

    data
}

/// Helper: construct standard ZRINIT header (Receiver ready)
pub fn build_zrinit() -> Vec<u8> {
    // Standard buffer size 4096, CANFDX | CANOVIO | CANBRK
    build_hex_header(ZRINIT, [0x00, 0x00, 0x23, 0xbe])
}

/// Helper: construct ZFIN header (Finish session)
pub fn build_zfin() -> Vec<u8> {
    build_hex_header(ZFIN, [0, 0, 0, 0])
}

/// Helper: construct ZACK header (Acknowledge position)
pub fn build_zack(pos: u32) -> Vec<u8> {
    let bytes = pos.to_le_bytes();
    build_hex_header(ZACK, bytes)
}

/// Helper: parse null-terminated ZFILE body into filename and filesize
pub fn parse_zfile_body(payload: &[u8]) -> (String, u64) {
    let mut parts = payload.split(|&b| b == 0);
    let filename = if let Some(name_bytes) = parts.next() {
        String::from_utf8_lossy(name_bytes).to_string()
    } else {
        "downloaded_file".to_string()
    };

    let mut size = 0u64;
    if let Some(meta_bytes) = parts.next() {
        let meta_str = String::from_utf8_lossy(meta_bytes);
        if let Some(first) = meta_str.split_whitespace().next() {
            size = first.parse::<u64>().unwrap_or(0);
        }
    }

    (filename, size)
}
