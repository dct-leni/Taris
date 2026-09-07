use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

const MAX_LOG_ENTRIES: usize = 1500;
static LOG_ID_COUNTER: AtomicU64 = AtomicU64::new(1);
static LOG_BUFFER: OnceLock<Mutex<VecDeque<LogEntry>>> = OnceLock::new();

fn get_buffer() -> &'static Mutex<VecDeque<LogEntry>> {
    LOG_BUFFER.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_LOG_ENTRIES)))
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogEntry {
    pub id: u64,
    pub timestamp: String,
    pub level: String,  // "ERROR", "WARN", "INFO", "DEBUG"
    pub source: String, // "rust" or "webview"
    pub target: String, // e.g. "ssh", "mesh", "docker", "ports", "config", "ui"
    pub message: String,
}

pub fn add_log(level: &str, source: &str, target: &str, message: &str) {
    let id = LOG_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = Local::now().format("%H:%M:%S%.3f").to_string();

    let entry = LogEntry {
        id,
        timestamp: timestamp.clone(),
        level: level.to_uppercase(),
        source: source.to_string(),
        target: target.to_string(),
        message: message.to_string(),
    };

    // Print to developer console / stdout
    match level.to_uppercase().as_str() {
        "ERROR" => eprintln!("[{}] [ERROR] [{}:{}] {}", timestamp, source, target, message),
        "WARN" => eprintln!("[{}] [WARN] [{}:{}] {}", timestamp, source, target, message),
        _ => println!("[{}] [{}] [{}:{}] {}", timestamp, level.to_uppercase(), source, target, message),
    }

    if let Ok(mut buf) = get_buffer().lock() {
        if buf.len() >= MAX_LOG_ENTRIES {
            buf.pop_front();
        }
        buf.push_back(entry);
    }
}

#[macro_export]
macro_rules! log_error {
    ($target:expr, $($arg:tt)+) => {
        $crate::logs::add_log("ERROR", "rust", $target, &format!($($arg)+))
    };
}

#[macro_export]
macro_rules! log_warn {
    ($target:expr, $($arg:tt)+) => {
        $crate::logs::add_log("WARN", "rust", $target, &format!($($arg)+))
    };
}

#[macro_export]
macro_rules! log_info {
    ($target:expr, $($arg:tt)+) => {
        $crate::logs::add_log("INFO", "rust", $target, &format!($($arg)+))
    };
}

#[macro_export]
macro_rules! log_debug {
    ($target:expr, $($arg:tt)+) => {
        $crate::logs::add_log("DEBUG", "rust", $target, &format!($($arg)+))
    };
}

// ── Tauri Commands ──

#[tauri::command]
pub fn get_app_logs(since_id: Option<u64>, limit: Option<usize>) -> Vec<LogEntry> {
    let buf = get_buffer().lock().unwrap();
    let max = limit.unwrap_or(500);

    match since_id {
        Some(sid) => buf
            .iter()
            .filter(|e| e.id > sid)
            .cloned()
            .take(max)
            .collect(),
        None => {
            let total = buf.len();
            let skip = if total > max { total - max } else { 0 };
            buf.iter().skip(skip).cloned().collect()
        }
    }
}

#[tauri::command]
pub fn log_webview_event(level: String, target: String, message: String) -> Result<(), String> {
    add_log(&level, "webview", &target, &message);
    Ok(())
}

#[tauri::command]
pub fn clear_app_logs() -> Result<(), String> {
    if let Ok(mut buf) = get_buffer().lock() {
        buf.clear();
    }
    Ok(())
}

#[tauri::command]
pub fn export_app_logs_text() -> Result<String, String> {
    let buf = get_buffer().lock().map_err(|e| e.to_string())?;
    let mut out = String::with_capacity(buf.len() * 100);
    out.push_str("# Taris Application Logs Export\n");
    out.push_str(&format!("# Exported At: {}\n", Local::now().to_rfc3339()));
    out.push_str("# ------------------------------------------------------------\n");

    for entry in buf.iter() {
        out.push_str(&format!(
            "[{}] [{:5}] [{}:{}] {}\n",
            entry.timestamp, entry.level, entry.source, entry.target, entry.message
        ));
    }
    Ok(out)
}
