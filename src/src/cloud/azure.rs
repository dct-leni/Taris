use std::path::PathBuf;
use super::{CloudAuthStatus, CloudInstance, CloudProject};

pub fn check_azure_auth(
    subscription_id: Option<&str>,
    _client_id: Option<&str>,
    access_token: Option<&str>,
) -> CloudAuthStatus {
    if let Some(tok) = access_token {
        if !tok.trim().is_empty() {
            return CloudAuthStatus {
                provider: "azure".into(),
                is_authenticated: true,
                auth_method: "access_token".into(),
                account: Some("Azure Access Token".into()),
                message: "Authenticated via short-lived Azure bearer token".into(),
            };
        }
    }

    let az_paths = [
        std::env::var("USERPROFILE").ok().map(|p| PathBuf::from(p).join(".azure").join("accessTokens.json")),
        std::env::var("HOME").ok().map(|p| PathBuf::from(p).join(".azure").join("accessTokens.json")),
    ];
    for path_opt in az_paths.iter().flatten() {
        if path_opt.exists() {
            return CloudAuthStatus {
                provider: "azure".into(),
                is_authenticated: true,
                auth_method: "azure_cli".into(),
                account: Some("Azure CLI Account".into()),
                message: "Authenticated via local Azure CLI credentials".into(),
            };
        }
    }

    if let Some(sub) = subscription_id {
        if !sub.trim().is_empty() {
            return CloudAuthStatus {
                provider: "azure".into(),
                is_authenticated: true,
                auth_method: "service_principal".into(),
                account: Some(sub.to_string()),
                message: format!("Configured Subscription ({})", sub),
            };
        }
    }

    CloudAuthStatus {
        provider: "azure".into(),
        is_authenticated: false,
        auth_method: "none".into(),
        account: None,
        message: "No Azure credentials found. Run 'az login' or configure credentials.".into(),
    }
}

pub async fn list_azure_projects(
    subscription_id: Option<&str>,
) -> Result<Vec<CloudProject>, String> {
    let mut list = Vec::new();

    #[cfg(target_os = "windows")]
    let cmd_res = std::process::Command::new("cmd").args(["/C", "az", "account", "list", "--output", "json"]).output();
    #[cfg(not(target_os = "windows"))]
    let cmd_res = std::process::Command::new("az").args(["account", "list", "--output", "json"]).output();

    if let Ok(output) = cmd_res {
        if output.status.success() {
            if let Ok(arr) = serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout) {
                for item in arr {
                    let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let name = item.get("name").and_then(|s| s.as_str()).unwrap_or(&id).to_string();
                    if !id.is_empty() {
                        list.push(CloudProject {
                            id,
                            name,
                            provider: "azure".into(),
                        });
                    }
                }
            }
        }
    }

    if list.is_empty() {
        if let Some(sub) = subscription_id {
            if !sub.is_empty() {
                list.push(CloudProject {
                    id: sub.to_string(),
                    name: format!("Subscription ({})", sub),
                    provider: "azure".into(),
                });
            }
        }
    }

    if list.is_empty() {
        list.push(CloudProject {
            id: "default-sub".into(),
            name: "Default Azure Subscription".into(),
            provider: "azure".into(),
        });
    }

    Ok(list)
}

pub async fn list_azure_instances(
    subscription_id: &str,
) -> Result<Vec<CloudInstance>, String> {
    let mut instances = Vec::new();

    let mut args = vec!["vm", "list", "-d", "--output", "json"];
    let sub_arg;
    if !subscription_id.is_empty() && subscription_id != "default-sub" {
        sub_arg = subscription_id.to_string();
        args.push("--subscription");
        args.push(&sub_arg);
    }

    #[cfg(target_os = "windows")]
    let cmd_res = std::process::Command::new("cmd").args([&["/C", "az"], &args[..]].concat()).output();
    #[cfg(not(target_os = "windows"))]
    let cmd_res = std::process::Command::new("az").args(&args).output();

    if let Ok(output) = cmd_res {
        if output.status.success() {
            if let Ok(arr) = serde_json::from_slice::<Vec<serde_json::Value>>(&output.stdout) {
                for item in arr {
                    let name = item.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let id = item.get("id").and_then(|s| s.as_str()).unwrap_or(&name).to_string();
                    let power = item.get("powerState").and_then(|s| s.as_str()).unwrap_or("unknown").to_string();
                    let status = if power.to_lowercase().contains("running") {
                        "RUNNING".to_string()
                    } else {
                        "STOPPED".to_string()
                    };
                    let location = item.get("location").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    let private_ips = item.get("privateIps").and_then(|s| s.as_str()).map(|s| s.to_string());
                    let public_ips = item.get("publicIps").and_then(|s| s.as_str()).map(|s| s.to_string());

                    if !name.is_empty() {
                        instances.push(CloudInstance {
                            id,
                            name,
                            status,
                            zone: location,
                            internal_ip: private_ips,
                            external_ip: public_ips,
                            machine_type: None,
                            provider: "azure".into(),
                            project_id: subscription_id.to_string(),
                        });
                    }
                }
            }
        }
    }

    Ok(instances)
}
