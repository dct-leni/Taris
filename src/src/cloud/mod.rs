pub mod aws;
pub mod azure;
pub mod gcp;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct CloudAuthConfig {
    // GCP
    pub gcp_service_account_path: Option<String>,
    pub gcp_service_account_json: Option<String>,
    pub gcp_access_token: Option<String>,
    pub gcp_refresh_token: Option<String>,
    pub gcp_account_email: Option<String>,
    pub gcp_default_project: Option<String>,

    // AWS
    pub aws_profile: Option<String>,
    pub aws_access_key_id: Option<String>,
    pub aws_secret_access_key: Option<String>,
    pub aws_session_token: Option<String>,
    pub aws_region: Option<String>,

    // Azure
    pub azure_subscription_id: Option<String>,
    pub azure_tenant_id: Option<String>,
    pub azure_client_id: Option<String>,
    pub azure_client_secret: Option<String>,
    pub azure_access_token: Option<String>,
    pub azure_default_resource_group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudAuthStatus {
    pub provider: String,
    pub is_authenticated: bool,
    pub auth_method: String,
    pub account: Option<String>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudProject {
    pub id: String,
    pub name: String,
    pub provider: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudInstance {
    pub id: String,
    pub name: String,
    pub status: String,
    pub zone: String,
    pub internal_ip: Option<String>,
    pub external_ip: Option<String>,
    pub machine_type: Option<String>,
    pub provider: String,
    pub project_id: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CloudSshEndpoint {
    pub host: String,
    pub port: u16,
    pub tunnel_type: String,
}

// ── Cloud Tauri Commands ──

#[tauri::command]
pub async fn pick_cloud_key_file() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(|| {
        let dialog = rfd::FileDialog::new()
            .set_title("Select Cloud Key or Credentials File")
            .add_filter("Key & JSON Files (*.json, *.pem, *.key)", &["json", "pem", "key"])
            .add_filter("All Files (*.*)", &["*"]);

        let picked = dialog.pick_file();
        if let Some(path) = picked {
            Ok(Some(path.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn check_cloud_auth(
    state: tauri::State<'_, crate::AppState>,
    provider: String,
) -> Result<CloudAuthStatus, String> {
    let cfg = crate::load_or_init_config(&state.config_path);
    let p = provider.to_lowercase();
    match p.as_str() {
        "gcp" => {
            let sa_ref = cfg.cloud_auth.gcp_service_account_path.as_deref()
                .or(cfg.cloud_auth.gcp_service_account_json.as_deref());
            Ok(gcp::check_gcp_auth(
                sa_ref,
                cfg.cloud_auth.gcp_access_token.as_deref(),
                cfg.cloud_auth.gcp_account_email.as_deref(),
            ))
        }
        "aws" => Ok(aws::check_aws_auth(
            cfg.cloud_auth.aws_access_key_id.as_deref(),
            cfg.cloud_auth.aws_secret_access_key.as_deref(),
            cfg.cloud_auth.aws_session_token.as_deref(),
            cfg.cloud_auth.aws_profile.as_deref(),
        )),
        "azure" => Ok(azure::check_azure_auth(
            cfg.cloud_auth.azure_subscription_id.as_deref(),
            cfg.cloud_auth.azure_client_id.as_deref(),
            cfg.cloud_auth.azure_access_token.as_deref(),
        )),
        _ => Err(format!("Unknown cloud provider: {}", provider)),
    }
}

#[tauri::command]
pub fn save_cloud_credentials(
    state: tauri::State<'_, crate::AppState>,
    mut config: CloudAuthConfig,
) -> Result<bool, String> {
    // Explicitly enforce that service account private keys are never stored in config
    config.gcp_service_account_json = None;
    let mut cfg = crate::load_or_init_config(&state.config_path);
    cfg.cloud_auth = config;
    if let Ok(serialized) = toml::to_string_pretty(&cfg) {
        let _ = std::fs::write(&state.config_path, serialized);
    }
    Ok(true)
}

#[tauri::command]
pub fn get_cloud_credentials(
    state: tauri::State<'_, crate::AppState>,
) -> CloudAuthConfig {
    let cfg = crate::load_or_init_config(&state.config_path);
    cfg.cloud_auth
}

#[tauri::command]
pub async fn list_cloud_projects(
    state: tauri::State<'_, crate::AppState>,
    provider: String,
) -> Result<Vec<CloudProject>, String> {
    let cfg = crate::load_or_init_config(&state.config_path);
    let p = provider.to_lowercase();
    match p.as_str() {
        "gcp" => {
            let sa_ref = cfg.cloud_auth.gcp_service_account_path.as_deref()
                .or(cfg.cloud_auth.gcp_service_account_json.as_deref());
            gcp::list_gcp_projects(
                sa_ref,
                cfg.cloud_auth.gcp_access_token.as_deref(),
                cfg.cloud_auth.gcp_default_project.as_deref(),
            ).await
        }
        "aws" => aws::list_aws_projects(
            cfg.cloud_auth.aws_profile.as_deref(),
            cfg.cloud_auth.aws_region.as_deref(),
        ).await,
        "azure" => azure::list_azure_projects(
            cfg.cloud_auth.azure_subscription_id.as_deref(),
        ).await,
        _ => Err(format!("Unknown cloud provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn list_cloud_instances(
    state: tauri::State<'_, crate::AppState>,
    provider: String,
    project_id: String,
) -> Result<Vec<CloudInstance>, String> {
    let cfg = crate::load_or_init_config(&state.config_path);
    let p = provider.to_lowercase();
    match p.as_str() {
        "gcp" => {
            let sa_ref = cfg.cloud_auth.gcp_service_account_path.as_deref()
                .or(cfg.cloud_auth.gcp_service_account_json.as_deref());
            gcp::list_gcp_instances(
                &project_id,
                sa_ref,
                cfg.cloud_auth.gcp_access_token.as_deref(),
            ).await
        }
        "aws" => aws::list_aws_instances(
            &project_id,
            cfg.cloud_auth.aws_profile.as_deref(),
        ).await,
        "azure" => azure::list_azure_instances(
            &project_id,
        ).await,
        _ => Err(format!("Unknown cloud provider: {}", provider)),
    }
}

#[tauri::command]
pub fn get_cloud_instance_ssh_endpoint(
    state: tauri::State<'_, crate::AppState>,
    instance: CloudInstance,
) -> Result<CloudSshEndpoint, String> {
    let cfg = crate::load_or_init_config(&state.config_path);

    // 1. If external IP is directly available, connect directly
    if let Some(ref ext_ip) = instance.external_ip {
        if !ext_ip.trim().is_empty() {
            return Ok(CloudSshEndpoint {
                host: ext_ip.clone(),
                port: 22,
                tunnel_type: "Direct".into(),
            });
        }
    }

    // 2. Otherwise route through Cloud Native Tunnel
    match instance.provider.as_str() {
        "gcp" => {
            let port = gcp::start_gcp_iap_tunnel(&instance.project_id, &instance.zone, &instance.name)?;
            Ok(CloudSshEndpoint {
                host: "127.0.0.1".into(),
                port,
                tunnel_type: "GCP_IAP".into(),
            })
        }
        "aws" => {
            let port = aws::start_aws_ssm_tunnel(&instance.id, &instance.project_id, cfg.cloud_auth.aws_profile.as_deref())?;
            Ok(CloudSshEndpoint {
                host: "127.0.0.1".into(),
                port,
                tunnel_type: "AWS_SSM".into(),
            })
        }
        "azure" => {
            if let Some(ref int_ip) = instance.internal_ip {
                Ok(CloudSshEndpoint {
                    host: int_ip.clone(),
                    port: 22,
                    tunnel_type: "Azure_Internal".into(),
                })
            } else {
                Err("No IP found for Azure VM".into())
            }
        }
        _ => Err(format!("Unsupported provider tunnel: {}", instance.provider)),
    }
}
