// UTF-8 stream chunk decoder for terminal PTY output.
// Safely preserves incomplete multi-byte UTF-8 sequences across chunk/packet boundaries
// preventing character corruption (\u{FFFD}) in progress bars and status displays.

pub struct Utf8ChunkDecoder {
    buf: Vec<u8>,
}

impl Default for Utf8ChunkDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl Utf8ChunkDecoder {
    pub fn new() -> Self {
        Self {
            buf: Vec::with_capacity(1024),
        }
    }

    /// Feeds raw bytes and returns decoded valid UTF-8 string chunk if any.
    /// Incomplete multi-byte codepoints at the end of the input (1-3 bytes)
    /// are retained in the internal buffer for the subsequent chunk.
    pub fn feed(&mut self, input: &[u8]) -> Option<String> {
        if input.is_empty() && self.buf.is_empty() {
            return None;
        }

        let slice = if self.buf.is_empty() {
            input
        } else {
            self.buf.extend_from_slice(input);
            &self.buf[..]
        };

        match std::str::from_utf8(slice) {
            Ok(valid) => {
                let res = valid.to_string();
                self.buf.clear();
                if res.is_empty() {
                    None
                } else {
                    Some(res)
                }
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                if e.error_len().is_none() {
                    // Incomplete UTF-8 sequence at the end of the slice.
                    let valid_str = if valid_up_to > 0 {
                        // Safe: bytes up to valid_up_to are guaranteed valid UTF-8
                        unsafe { std::str::from_utf8_unchecked(&slice[..valid_up_to]) }.to_string()
                    } else {
                        String::new()
                    };

                    let remainder = slice[valid_up_to..].to_vec();
                    self.buf = remainder;

                    if valid_str.is_empty() {
                        None
                    } else {
                        Some(valid_str)
                    }
                } else {
                    // Genuinely invalid byte sequence encountered in stream.
                    // Fall back to lossy conversion to guarantee progress without buffer bloat.
                    let lossy_str = String::from_utf8_lossy(slice).to_string();
                    self.buf.clear();
                    if lossy_str.is_empty() {
                        None
                    } else {
                        Some(lossy_str)
                    }
                }
            }
        }
    }

    /// Flush any remaining buffered bytes (e.g. on EOF or connection close).
    pub fn flush(&mut self) -> Option<String> {
        if self.buf.is_empty() {
            None
        } else {
            let s = String::from_utf8_lossy(&self.buf).to_string();
            self.buf.clear();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
    }
}
