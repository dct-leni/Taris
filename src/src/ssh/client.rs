use russh::client::Handler;
use russh::keys::PublicKeyOrCertificate;

#[derive(Clone, Debug)]
pub struct TarisSshHandler {
    pub host_name: String,
    pub banner_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
}

impl TarisSshHandler {
    pub fn new(host_name: impl Into<String>) -> Self {
        Self {
            host_name: host_name.into(),
            banner_tx: None,
        }
    }

    pub fn with_banner_tx(
        host_name: impl Into<String>,
        banner_tx: tokio::sync::mpsc::UnboundedSender<String>,
    ) -> Self {
        Self {
            host_name: host_name.into(),
            banner_tx: Some(banner_tx),
        }
    }
}

impl Handler for TarisSshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // Accept-new policy: Trust and accept remote host public key
        Ok(true)
    }

    async fn auth_banner(
        &mut self,
        banner: &str,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(ref tx) = self.banner_tx {
            let _ = tx.send(banner.to_string());
        }
        Ok(())
    }
}

/// Executes a remote command asynchronously over an SSH channel and captures combined stdout/stderr.
pub async fn exec_command(
    handle: &russh::client::Handle<TarisSshHandler>,
    cmd: &str,
) -> Result<String, String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Failed to execute command '{}': {}", cmd, e))?;
    let mut output = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            russh::ChannelMsg::Data { ref data } => {
                output.extend_from_slice(data);
            }
            russh::ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                output.extend_from_slice(data);
            }
            russh::ChannelMsg::Eof => break,
            _ => {}
        }
    }
    Ok(String::from_utf8_lossy(&output).to_string())
}
