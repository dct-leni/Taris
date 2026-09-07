pub mod keys;
pub mod pool;
pub mod session;
pub mod sftp;

// Public re-exports for easy consumption across the codebase
pub use keys::{
    check_ssh_key_permissions, fix_ssh_key_permissions, pick_ssh_key_file, resolve_ssh_key_path,
    KeyPermissionStatus,
};
pub use pool::{PooledSession, SshSessionPool};
pub use session::{open_ssh2_session, open_ssh2_session_with_target};
pub use sftp::{
    delete_remote_file, delete_remote_recursive, list_remote_files, read_remote_file,
    resolve_sftp_path, sftp_download_file, sftp_upload_file, write_remote_file, RemoteDirList,
};
