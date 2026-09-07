use std::path::PathBuf;
use super::{CloudAuthStatus, CloudInstance, CloudProject};

fn resolve_sa_content(service_account_path_or_json: Option<&str>) -> Option<String> {
    let raw = service_account_path_or_json?.trim();
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with('{') {
        Some(raw.to_string())
    } else {
        let p = PathBuf::from(raw);
        std::fs::read_to_string(&p).ok()
    }
}

pub fn check_gcp_auth(
    service_account_path_or_json: Option<&str>,
    access_token: Option<&str>,
    account_email: Option<&str>,
) -> CloudAuthStatus {
    // 1. Check provided service account path or raw JSON
    if let Some(content) = resolve_sa_content(service_account_path_or_json) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            let client_email = v.get("client_email").and_then(|s| s.as_str()).map(|s| s.to_string());
            let project_id = v.get("project_id").and_then(|s| s.as_str()).map(|s| s.to_string());
            return CloudAuthStatus {
                provider: "gcp".into(),
                is_authenticated: true,
                auth_method: "service_account_file".into(),
                account: client_email,
                message: format!("Service Account ({})", project_id.unwrap_or_else(|| "GCP".into())),
            };
        }
    }

    // 2. Check provided access token
    if let Some(token) = access_token {
        if !token.trim().is_empty() {
            return CloudAuthStatus {
                provider: "gcp".into(),
                is_authenticated: true,
                auth_method: "access_token".into(),
                account: account_email.map(|s| s.to_string()).or_else(|| Some("GCP Token User".into())),
                message: "Authenticated via short-lived access token".into(),
            };
        }
    }

    // 3. Check local Google Application Default Credentials (ADC) JSON
    let adc_paths = [
        std::env::var("APPDATA").ok().map(|p| PathBuf::from(p).join("gcloud").join("application_default_credentials.json")),
        std::env::var("USERPROFILE").ok().map(|p| PathBuf::from(p).join(".config").join("gcloud").join("application_default_credentials.json")),
        std::env::var("HOME").ok().map(|p| PathBuf::from(p).join(".config").join("gcloud").join("application_default_credentials.json")),
    ];
    for path_opt in adc_paths.iter().flatten() {
        if path_opt.exists() {
            if let Ok(content) = std::fs::read_to_string(path_opt) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    let client_email = v.get("client_email").and_then(|s| s.as_str())
                        .or_else(|| v.get("account").and_then(|s| s.as_str()))
                        .map(|s| s.to_string());
                    return CloudAuthStatus {
                        provider: "gcp".into(),
                        is_authenticated: true,
                        auth_method: "local_adc".into(),
                        account: client_email.or_else(|| Some("Local ADC Account".into())),
                        message: "Authenticated via local Google Cloud ADC".into(),
                    };
                }
            }
        }
    }

    // 4. Check stored OAuth / Email
    if let Some(email) = account_email {
        return CloudAuthStatus {
            provider: "gcp".into(),
            is_authenticated: true,
            auth_method: "oauth_stored".into(),
            account: Some(email.to_string()),
            message: format!("Authenticated with Google ({})", email),
        };
    }

    // 5. Check gcloud CLI
    #[cfg(target_os = "windows")]
    let gcloud_cmd = std::process::Command::new("cmd").args(["/C", "gcloud", "config", "get-value", "account"]).output();
    #[cfg(not(target_os = "windows"))]
    let gcloud_cmd = std::process::Command::new("gcloud").args(["config", "get-value", "account"]).output();

    if let Ok(output) = gcloud_cmd {
        if output.status.success() {
            let acc = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !acc.is_empty() && acc != "(unset)" {
                return CloudAuthStatus {
                    provider: "gcp".into(),
                    is_authenticated: true,
                    auth_method: "gcloud_cli".into(),
                    account: Some(acc.clone()),
                    message: format!("Authenticated via gcloud CLI ({})", acc),
                };
            }
        }
    }

    CloudAuthStatus {
        provider: "gcp".into(),
        is_authenticated: false,
        auth_method: "none".into(),
        account: None,
        message: "Not authenticated with GCP. Configure Service Account Key path or access token.".into(),
    }
}

pub async fn list_gcp_projects(
    service_account_path_or_json: Option<&str>,
    access_token: Option<&str>,
    default_project: Option<&str>,
) -> Result<Vec<CloudProject>, String> {
    let mut projects = Vec::new();

    // 1. Try gcloud projects list
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("cmd");
    #[cfg(target_os = "windows")]
    cmd.args(["/C", "gcloud", "projects", "list", "--format=json"]);
    #[cfg(not(target_os = "windows"))]
    let mut cmd = std::process::Command::new("gcloud");
    #[cfg(not(target_os = "windows"))]
    cmd.args(["projects", "list", "--format=json"]);

    if let Some(val) = service_account_path_or_json {
        let trimmed = val.trim();
        if !trimmed.starts_with('{') && !trimmed.is_empty() {
            cmd.env("GOOGLE_APPLICATION_CREDENTIALS", trimmed);
        }
    }
    if let Some(tok) = access_token {
        let trimmed = tok.trim();
        if !trimmed.is_empty() {
            cmd.env("CLOUDSDK_AUTH_ACCESS_TOKEN", trimmed);
        }
    }

    let gcloud_cmd = cmd.output();

    if let Ok(output) = gcloud_cmd {
        if output.status.success() {
            if let Ok(arr) = serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout) {
                for item in arr {
                    let pid = item.get("projectId").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let name = item.get("name").and_then(|s| s.as_str()).unwrap_or(&pid).to_string();
                    if !pid.is_empty() {
                        projects.push(CloudProject {
                            id: pid,
                            name,
                            provider: "gcp".into(),
                        });
                    }
                }
            }
        }
    }

    // 2. If Service Account JSON/file contains project_id, include it
    if let Some(content) = resolve_sa_content(service_account_path_or_json) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(pid) = v.get("project_id").and_then(|s| s.as_str()) {
                if !projects.iter().any(|p| p.id == pid) {
                    projects.push(CloudProject {
                        id: pid.to_string(),
                        name: pid.to_string(),
                        provider: "gcp".into(),
                    });
                }
            }
        }
    }

    // 3. If default project configured, ensure it is included
    if let Some(dp) = default_project {
        if !dp.is_empty() && !projects.iter().any(|p| p.id == dp) {
            projects.push(CloudProject {
                id: dp.to_string(),
                name: dp.to_string(),
                provider: "gcp".into(),
            });
        }
    }

    // 4. Check gcloud config get-value project
    #[cfg(target_os = "windows")]
    let def_proj_cmd = std::process::Command::new("cmd").args(["/C", "gcloud", "config", "get-value", "project"]).output();
    #[cfg(not(target_os = "windows"))]
    let def_proj_cmd = std::process::Command::new("gcloud").args(["config", "get-value", "project"]).output();

    if let Ok(output) = def_proj_cmd {
        if output.status.success() {
            let pid = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !pid.is_empty() && pid != "(unset)" && !projects.iter().any(|p| p.id == pid) {
                projects.insert(0, CloudProject {
                    id: pid.clone(),
                    name: pid,
                    provider: "gcp".into(),
                });
            }
        }
    }

    if projects.is_empty() {
        // Fallback default homelab project placeholder if no project listed
        projects.push(CloudProject {
            id: "default".into(),
            name: "Default Project".into(),
            provider: "gcp".into(),
        });
    }

    Ok(projects)
}

pub async fn list_gcp_instances(
    project_id: &str,
    service_account_path_or_json: Option<&str>,
    access_token: Option<&str>,
) -> Result<Vec<CloudInstance>, String> {
    let mut instances = Vec::new();

    // Query compute instances via gcloud
    let proj_arg = format!("--project={}", project_id);
    #[cfg(target_os = "windows")]
    let mut cmd = std::process::Command::new("cmd");
    #[cfg(target_os = "windows")]
    cmd.args(["/C", "gcloud", "compute", "instances", "list", &proj_arg, "--format=json"]);
    #[cfg(not(target_os = "windows"))]
    let mut cmd = std::process::Command::new("gcloud");
    #[cfg(not(target_os = "windows"))]
    cmd.args(["compute", "instances", "list", &proj_arg, "--format=json"]);

    if let Some(val) = service_account_path_or_json {
        let trimmed = val.trim();
        if !trimmed.starts_with('{') && !trimmed.is_empty() {
            cmd.env("GOOGLE_APPLICATION_CREDENTIALS", trimmed);
        }
    }
    if let Some(tok) = access_token {
        let trimmed = tok.trim();
        if !trimmed.is_empty() {
            cmd.env("CLOUDSDK_AUTH_ACCESS_TOKEN", trimmed);
        }
    }

    let gcloud_cmd = cmd.output();

    if let Ok(output) = gcloud_cmd {
        if output.status.success() {
            if let Ok(arr) = serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout) {
                for item in arr {
                    let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let name = item.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let status = item.get("status").and_then(|s| s.as_str()).unwrap_or("UNKNOWN").to_string();
                    let zone_url = item.get("zone").and_then(|s| s.as_str()).unwrap_or("");
                    let zone = zone_url.split('/').last().unwrap_or("").to_string();

                    let machine_url = item.get("machineType").and_then(|s| s.as_str()).unwrap_or("");
                    let machine_type = machine_url.split('/').last().map(|s| s.to_string());

                    // IP addresses
                    let mut internal_ip = None;
                    let mut external_ip = None;
                    if let Some(ifaces) = item.get("networkInterfaces").and_then(|v| v.as_array()) {
                        if let Some(first_iface) = ifaces.first() {
                            internal_ip = first_iface.get("networkIP").and_then(|s| s.as_str()).map(|s| s.to_string());
                            if let Some(access_configs) = first_iface.get("accessConfigs").and_then(|v| v.as_array()) {
                                if let Some(first_ac) = access_configs.first() {
                                    external_ip = first_ac.get("natIP").and_then(|s| s.as_str()).map(|s| s.to_string());
                                }
                            }
                        }
                    }

                    if !name.is_empty() {
                        instances.push(CloudInstance {
                            id: if id.is_empty() { name.clone() } else { id },
                            name,
                            status,
                            zone,
                            internal_ip,
                            external_ip,
                            machine_type,
                            provider: "gcp".into(),
                            project_id: project_id.to_string(),
                        });
                    }
                }
            }
        } else {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("gcloud compute instances list failed: {}", err));
        }
    } else {
        return Err("gcloud CLI not found or failed to execute".into());
    }

    Ok(instances)
}

pub fn start_gcp_iap_tunnel(
    project_id: &str,
    zone: &str,
    instance_name: &str,
) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local port: {}", e))?;
    let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);

    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("cmd");
        cmd.args([
            "/C",
            "gcloud",
            "compute",
            "start-iap-tunnel",
            instance_name,
            "22",
            &format!("--local-host-port=127.0.0.1:{}", local_port),
        ]);
        if !project_id.is_empty() {
            cmd.args([&format!("--project={}", project_id)]);
        }
        if !zone.is_empty() {
            cmd.args([&format!("--zone={}", zone)]);
        }
        let _ = cmd.spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = std::process::Command::new("gcloud");
        cmd.args([
            "compute",
            "start-iap-tunnel",
            instance_name,
            "22",
            &format!("--local-host-port=127.0.0.1:{}", local_port),
        ]);
        if !project_id.is_empty() {
            cmd.args([&format!("--project={}", project_id)]);
        }
        if !zone.is_empty() {
            cmd.args([&format!("--zone={}", zone)]);
        }
        let _ = cmd.spawn();
    }

    std::thread::sleep(std::time::Duration::from_millis(600));
    Ok(local_port)
}
