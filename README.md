# ⚡ Taris

> **A blazing-fast, 100% portable, cross-platform SSH & Homelab Studio built on Tauri v2 (Rust Backend + Hardware-Accelerated Frontend)** — featuring ConPTY/OpenPTY terminals, dual-mode SFTP file explorer, in-app code editor & SQLite database viewer, remote Docker container manager, real-time port & socket inspector, Cloud provider integration (GCP, AWS, Azure), and built-in Mesh VPN tunnels (WireGuard, Tailscale, NetBird) with Exit Node routing.

---

## 📐 Layout Architecture

```
+-----------------------------------------------------------------------------------------------+
| ● Taris | ⚡ Homelab Studio                                                        — □ ✕| (30px Flush DWM Titlebar)
+---+-------------------+---+-----------------------------------------------+---+---------------+
| R | LEFT DRAWER       | ║ | 💻 CENTER WORKSPACE (Terminal, Editor, DB)    | ║ | SFTP EXPLORER |
| A | (Collapsible)     | ║ | --------------------------------------------- | ║ | [x] Follow PWD|
| I | ----------------- | ║ | [ Local PC ] [ ● pve-01 ] [ 🗄️ prod.db ✕ ]    | ║ | [ 🔍 Filter]  |
| L | HOSTS / MESH      | ║ | --------------------------------------------- | ║ | 📁 backups    |
| --| [ 🔍 Filter]      | ║ | TABLES (4)  |  table: users (42 rows)         | ║ | 🗄️ prod.db340K|
| 🖥️| ● pve-node-01     | ║ | users (42)  |  id | username | role           | ║ | 📄 config.yaml|
| ☁️| ● aws-prod-ec2    | ║ | nodes  (8)  |  1  | admin    | superadmin     | ║ | 📄 docker.yml |
| 📁| ● gmk-nas (Mesh)  | ║ | logs  (2.4k)|  2  | leni     | operator       | ║ | --------------|
| 📝|                   | ║ | *(In-App SQLite Viewer: search, edit, save)*  | ║ | [Clean Text   |
| 🐳| DOCKER (Active)   | ║ | --------------------------------------------- | ║ |  Right-Click: |
| 🔍| ● pihole-dns  Up4d| ║ | root@pve-node-01:~# ▉                         | ║ |  Edit (In-App)|
| 🔀| ● nginx-proxy Up4d| ║ | *(Hardware-accelerated xterm.js terminal)*     | ║ |  View (DB)    |
| 🛡️|                   | ║ |                                               | ║ |  Download, Up]|
| 🐛| APP LOGS (Opt)    | ║ |                                               | ║ |               |
| ⚙️| SETTINGS          | ║ |                                               | ║ |               |
+---+-------------------+---+-----------------------------------------------+---+---------------+
| pve-node-01 • id_ed25519 • 2ms (Mesh) |        CPU: 4.2%  |  RAM: 24.5%  |  Net: ↑12.4 KB/s ↓45.8 KB/s | (24px Status Bar)
+-----------------------------------------------------------------------------------------------+
```

---

## 🚀 Key Features

### 1. 100% Portable & Zero Registry Footprint
- All configurations, host bookmarks, snippets, tunnels, and keys reside in `./config.toml` and `./.ssh/` directly next to the executable.
- Fully portable across Windows, Linux, and macOS without installers, daemons, or background services.

### 2. High-Performance Terminal
- **ConPTY / OpenPTY Backend**: Native pseudo-terminal integration in pure Rust with direct streaming IPC.
- **Hardware-Accelerated Frontend**: Powered by `xterm.js` with WebGL rendering for 120+ FPS throughput.
- **Robust 30s Timeout Guard**: Guaranteed non-blocking connection attempts (`-o ConnectTimeout=30`); never freezes or locks the UI on unreachable hosts.
- **Session Pooling**: Fast connection multiplexing (`ssh2`) with automatic session reuse and keepalive heartbeat monitoring.

### 3. Mesh VPN & Exit Node Routing (Pure In-Process)
- **Zero External Binaries**: Connect to private home/work networks without installing external WireGuard, Tailscale, or NetBird binaries.
- **Pure-Rust User-Space Engine**: Powered by `boringtun` user-space WireGuard tunnels with loopback TCP proxy bridging.
- **Exit Node / Gateway Routing**: Route all SSH, SFTP, Docker, and Port inspection connections through your designated Mesh Exit Node (e.g. `0.0.0.0/0`).
- **Unified Management**: Single panel for WireGuard profiles, Tailscale auth keys, and NetBird management setup keys.

### 4. Cloud Providers Integration
- Native cloud compute discovery for **Google Cloud Platform (GCP)**, **Amazon Web Services (AWS)**, and **Microsoft Azure**.
- Automatically lists instances across projects/regions, fetches external/internal IPs, and connects with one click.

### 5. Unified App Logs & Diagnostics
- **Settings Toggle**: Optional debug menu (default: disabled) enabled via Settings.
- **Unified Ring Buffer**: In-memory bounded circular log buffer (1,500 entries) capturing Rust backend logs and Tauri webview errors/warnings.
- **Diagnostics Controls**: Filter by level (`ERROR`, `WARN`, `INFO`, `DEBUG`), search by text, copy to clipboard, or export to `.txt`.

### 6. Homelab & Dev Tools
- **Remote Docker Manager**: Automatically detects `/var/run/docker.sock` over SSH. Live container cards, CPU/RAM stats, streaming log viewers, and interactive `exec` shell.
- **Port & Socket Inspector**: Real-time inspection of listening TCP/UDP ports, UNIX domain sockets, and foreign connections.
- **Dual-Mode SFTP Explorer**: Unified local workspace and remote SFTP file tree with instant drag-and-drop, inline file rename, permissions editing, and file upload/download.
- **In-App SQLite Viewer**: Open and edit remote `.db`, `.sqlite`, and `.sqlite3` databases directly inside Taris with table schema browsing, query filtering, and cell editing.
- **In-App Code Editor**: Quick-edit configs (`.yaml`, `.json`, `.toml`, `.sh`, `.conf`) with syntax highlighting and instant `Ctrl+S` writeback.
- **Notes & Snippets**: Quick-access aliases and command notes. Double-click to paste into active terminal, right-click to copy.

---

## 🛠️ Tech Stack & Architecture

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend Core** | **Rust 2021 (Tauri v2)** | Non-blocking async runtime (`tokio`), PTY streaming, system telemetry |
| **Frontend** | **Vanilla JS + Modern CSS + HTML5** | High-performance, zero-framework bloat, hardware-rendered UI |
| **Terminal Engine** | **xterm.js + WebGL Addon** | Ultra-low latency terminal rendering |
| **SSH Protocol** | **`ssh2` + OpenSSH ConPTY** | Connection pooling, SFTP subsystem, ConPTY process spawning |
| **Mesh / VPN** | **`boringtun` + Loopback Forwarder** | Embedded WireGuard protocol engine; zero external dependencies |
| **Logging** | **In-memory bounded ring buffer** | Real-time cross-boundary unified logging (Rust backend + Webview JS) |

---

## 📦 Building & Running

### Prerequisites
- [Rust](https://www.rust-lang.org/) (latest stable, 1.77+)
- [Node.js](https://nodejs.org/) (v18+ recommended)

### Development Mode
```bash
# Clone the repository
git clone https://github.com/username/SSH_Term.git
cd SSH_Term

# Run the Tauri application in dev mode
cargo tauri dev
```

### Production Build
```bash
# Build standalone optimized release executable
cargo tauri build
```
The compiled self-contained binary will be generated in `src/target/release/` (e.g. `taris.exe` on Windows).

---

## ⚙️ Configuration

Taris is completely portable. All configuration is stored in `config.toml` located in the application working directory:

```toml
[settings]
font_family = "Cascadia Code"
font_size = 14
app_font_size = 13
theme = "one_dark"
terminal_theme = "one_dark"
default_shell = "powershell"
cursor_style = "block"
docker_port = 2375
enable_ssh_compression = false
enable_app_logs = false          # Set to true or toggle via Settings to enable App Logs

[[hosts]]
id = "host-1"
name = "Homelab Server"
host = "192.168.1.100"
port = 22
user = "root"
auth_type = "key"
key_path = "./.ssh/id_ed25519"
network_route = "direct"         # "direct" or "mesh"
has_docker = true
enable_port_scan = true
```

---

## 📄 License
MIT License. Crafted for homelab enthusiasts and systems engineers.
