use std::path::PathBuf;
use super::{CloudAuthStatus, CloudInstance, CloudProject};

pub fn check_aws_auth(
    access_key_id: Option<&str>,
    _secret_access_key: Option<&str>,
    session_token: Option<&str>,
    profile: Option<&str>,
) -> CloudAuthStatus {
    if let Some(tok) = session_token {
        if !tok.trim().is_empty() {
            return CloudAuthStatus {
                provider: "aws".into(),
                is_authenticated: true,
                auth_method: "session_token".into(),
                account: Some("AWS STS Session".into()),
                message: "Authenticated via short-lived AWS session token".into(),
            };
        }
    }

    let mut profiles = Vec::new();
    let creds_paths = [
        std::env::var("USERPROFILE").ok().map(|p| PathBuf::from(p).join(".aws").join("credentials")),
        std::env::var("HOME").ok().map(|p| PathBuf::from(p).join(".aws").join("credentials")),
    ];
    for path_opt in creds_paths.iter().flatten() {
        if path_opt.exists() {
            if let Ok(content) = std::fs::read_to_string(path_opt) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with('[') && trimmed.ends_with(']') {
                        let prof = trimmed[1..trimmed.len() - 1].trim().to_string();
                        if !prof.is_empty() {
                            profiles.push(prof);
                        }
                    }
                }
            }
        }
    }

    if !profiles.is_empty() {
        let active_prof = profile.map(|s| s.to_string()).unwrap_or_else(|| profiles.first().cloned().unwrap_or_else(|| "default".into()));
        return CloudAuthStatus {
            provider: "aws".into(),
            is_authenticated: true,
            auth_method: "aws_credentials".into(),
            account: Some(active_prof.clone()),
            message: format!("Profile '{}' in ~/.aws/credentials", active_prof),
        };
    }

    if let Some(key) = access_key_id {
        if !key.trim().is_empty() {
            return CloudAuthStatus {
                provider: "aws".into(),
                is_authenticated: true,
                auth_method: "custom_keys".into(),
                account: Some(key.to_string()),
                message: "Custom AWS API Keys Configured".into(),
            };
        }
    }

    CloudAuthStatus {
        provider: "aws".into(),
        is_authenticated: false,
        auth_method: "none".into(),
        account: None,
        message: "No AWS credentials found. Configure keys or ~/.aws/credentials.".into(),
    }
}

pub async fn list_aws_projects(
    profile: Option<&str>,
    default_region: Option<&str>,
) -> Result<Vec<CloudProject>, String> {
    let mut list = Vec::new();
    let regions = [
        "us-east-1", "us-east-2", "us-west-1", "us-west-2",
        "eu-west-1", "eu-central-1", "ap-southeast-1", "ap-northeast-1",
    ];

    let prof_prefix = profile.map(|p| format!("{} - ", p)).unwrap_or_default();
    let selected_region = default_region.unwrap_or("us-east-1");

    // Put selected/default region at the top
    list.push(CloudProject {
        id: selected_region.to_string(),
        name: format!("{}Region: {}", prof_prefix, selected_region),
        provider: "aws".into(),
    });

    for r in regions {
        if r != selected_region {
            list.push(CloudProject {
                id: r.to_string(),
                name: format!("{}Region: {}", prof_prefix, r),
                provider: "aws".into(),
            });
        }
    }

    Ok(list)
}

pub async fn list_aws_instances(
    region: &str,
    profile: Option<&str>,
) -> Result<Vec<CloudInstance>, String> {
    let mut instances = Vec::new();

    let mut args = vec!["ec2", "describe-instances", "--region", region, "--output", "json"];
    let prof_str;
    if let Some(p) = profile {
        if !p.is_empty() {
            prof_str = p.to_string();
            args.push("--profile");
            args.push(&prof_str);
        }
    }

    #[cfg(target_os = "windows")]
    let cmd_res = std::process::Command::new("aws").args(&args).output();
    #[cfg(not(target_os = "windows"))]
    let cmd_res = std::process::Command::new("aws").args(&args).output();

    if let Ok(output) = cmd_res {
        if output.status.success() {
            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                if let Some(reservations) = v.get("Reservations").and_then(|r| r.as_array()) {
                    for res in reservations {
                        if let Some(inst_arr) = res.get("Instances").and_then(|i| i.as_array()) {
                            for item in inst_arr {
                                let inst_id = item.get("InstanceId").and_then(|s| s.as_str()).unwrap_or("").to_string();
                                let mut name = inst_id.clone();

                                if let Some(tags) = item.get("Tags").and_then(|t| t.as_array()) {
                                    for t in tags {
                                        if t.get("Key").and_then(|s| s.as_str()) == Some("Name") {
                                            if let Some(n) = t.get("Value").and_then(|s| s.as_str()) {
                                                name = n.to_string();
                                            }
                                        }
                                    }
                                }

                                let state = item.get("State").and_then(|s| s.get("Name")).and_then(|s| s.as_str()).unwrap_or("unknown").to_uppercase();
                                let zone = item.get("Placement").and_then(|p| p.get("AvailabilityZone")).and_then(|s| s.as_str()).unwrap_or(region).to_string();
                                let itype = item.get("InstanceType").and_then(|s| s.as_str()).map(|s| s.to_string());
                                let private_ip = item.get("PrivateIpAddress").and_then(|s| s.as_str()).map(|s| s.to_string());
                                let public_ip = item.get("PublicIpAddress").and_then(|s| s.as_str()).map(|s| s.to_string());

                                if !inst_id.is_empty() {
                                    instances.push(CloudInstance {
                                        id: inst_id,
                                        name,
                                        status: state,
                                        zone,
                                        internal_ip: private_ip,
                                        external_ip: public_ip,
                                        machine_type: itype,
                                        provider: "aws".into(),
                                        project_id: region.to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(instances)
}

pub fn start_aws_ssm_tunnel(
    instance_id: &str,
    region: &str,
    profile: Option<&str>,
) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to bind local port: {}", e))?;
    let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);

    let mut cmd = std::process::Command::new("aws");
    cmd.args([
        "ssm",
        "start-session",
        "--target",
        instance_id,
        "--document-name",
        "AWS-StartPortForwardingSession",
        "--parameters",
        &format!("portNumber=[\"22\"],localPortNumber=[\"{}\"]", local_port),
    ]);
    if !region.is_empty() {
        cmd.args(["--region", region]);
    }
    if let Some(prof) = profile {
        if !prof.is_empty() {
            cmd.args(["--profile", prof]);
        }
    }
    let _ = cmd.spawn();

    std::thread::sleep(std::time::Duration::from_millis(600));
    Ok(local_port)
}
