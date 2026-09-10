use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IconDef {
    pub id: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub w: Option<u32>,
    #[serde(default)]
    pub h: Option<u32>,
    pub d: String,
    #[serde(default)]
    pub terms: Option<String>,
    #[serde(default)]
    pub src: Option<String>,
}

static ICONS_MAP: OnceLock<HashMap<String, IconDef>> = OnceLock::new();

fn get_icons_map() -> &'static HashMap<String, IconDef> {
    ICONS_MAP.get_or_init(|| {
        let raw = include_str!("../../assets/icons.json");
        match serde_json::from_str::<Vec<IconDef>>(raw) {
            Ok(icons) => {
                let mut map = HashMap::with_capacity(icons.len());
                for icon in icons {
                    map.insert(icon.id.to_lowercase(), icon);
                }
                map
            }
            Err(e) => {
                eprintln!("[error] Failed to parse icons.json: {}", e);
                HashMap::new()
            }
        }
    })
}

#[tauri::command]
pub fn get_host_icons(ids: Vec<String>) -> HashMap<String, IconDef> {
    let map = get_icons_map();
    let mut result = HashMap::new();
    for id in ids {
        let clean = id.trim().to_lowercase();
        let clean = clean.strip_prefix("icons/").unwrap_or(&clean);
        let clean = clean.strip_suffix(".svg").unwrap_or(clean);
        if let Some(def) = map.get(clean) {
            result.insert(clean.to_string(), def.clone());
        }
    }
    result
}

#[tauri::command]
pub fn trim_memory() {
    #[cfg(target_os = "windows")]
    unsafe {
        extern "system" {
            fn GetCurrentProcess() -> *mut std::ffi::c_void;
            fn SetProcessWorkingSetSize(
                h_process: *mut std::ffi::c_void,
                min: usize,
                max: usize,
            ) -> i32;
        }
        let proc = GetCurrentProcess();
        SetProcessWorkingSetSize(proc, usize::MAX, usize::MAX);
    }

    #[cfg(target_os = "linux")]
    unsafe {
        extern "C" {
            fn malloc_trim(pad: usize) -> i32;
        }
        malloc_trim(0);
    }

    #[cfg(target_os = "macos")]
    unsafe {
        extern "C" {
            fn malloc_zone_pressure_relief(zone: *mut std::ffi::c_void, goal: usize) -> usize;
        }
        malloc_zone_pressure_relief(std::ptr::null_mut(), 0);
    }
}
