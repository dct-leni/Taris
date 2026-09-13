# ⚡ Taris

<img width="1391" height="869" alt="image" src="https://github.com/user-attachments/assets/40d51c18-dd8e-4fb9-b374-f7871394cdb4" />


> **A blazing-fast, 100% portable, cross-platform SSH & Homelab Studio built on Tauri v2 (Rust Backend + Hardware-Accelerated Frontend)** — featuring pure async in-process SSH/SFTP (`russh`), mobile shell protocol (`mosh`), in-band ZMODEM terminal transfers, dual-mode SFTP file explorer with in-place archive browsing, in-app code editor & SQLite database viewer, remote Docker manager, native WSL & Linux virtual machine manager, real-time socket inspector, cloud provider discovery (GCP, AWS, Azure), and built-in mesh VPN tunnels (WireGuard, Tailscale, NetBird).

---

## 📐 Layout Architecture

```
+-----------------------------------------------------------------------------------------------+
| [•] Taris | Homelab Studio                                                        — □ ✕| (30px Flush DWM Titlebar)
+---+-------------------+---+-----------------------------------------------+---+---------------+
| R | LEFT DRAWER       | ║ | CENTER WORKSPACE (Terminal, Editor, DB, Grid) | ║ | SFTP EXPLORER |
| A | (Collapsible)     | ║ | --------------------------------------------- | ║ | [x] Follow PWD|
| I | ----------------- | ║ | [ Local PC ] [ • pve-01 ] [ prod.db ✕ ]       | ║ | [ Filter    ] |
| L | HOSTS / WSL / MESH| ║ | --------------------------------------------- | ║ | > backups     |
| --| [ Filter        ] | ║ | TABLES (4)  |  table: users (42 rows)         | ║ |   prod.db 340K|
|HST| • pve-node-01     | ║ | users (42)  |  id | username | role           | ║ |   config.yaml |
|CLD| • aws-prod-ec2    | ║ | nodes  (8)  |  1  | admin    | superadmin     | ║ |   docker.yml  |
|FIL| • gmk-nas (Mesh)  | ║ | logs  (2.4k)|  2  | leni     | operator       | ║ |   archive.zip |
|NOT|                   | ║ | (In-App SQLite / AST Tree / CSV Grid Studio)  | ║ | --------------|
|DCK| WSL LINUX (Active)| ║ | --------------------------------------------- | ║ | Context Menu: |
|PRT| • Ubuntu-24.04 Up | ║ | root@pve-node-01:~# ▉                         | ║ |  Edit (In-App)|
|TUN| • Debian      Down| ║ | (Hardware-accelerated xterm.js terminal)      | ║ |  View (DB)    |
|MSH|                   | ║ |                                               | ║ |  Inspect (VFS)|
|WSL| DOCKER (Active)   | ║ |                                               | ║ |  Download, Up |
|LOG| • pihole-dns  Up  | ║ |                                               | ║ |               |
|SET| SETTINGS          | ║ |                                               | ║ |               |
+---+-------------------+---+-----------------------------------------------+---+---------------+
| pve-node-01 • id_ed25519 • 2ms (Mesh) |        CPU: 4.2%  |  RAM: 24.5%  |  Net: ↑12.4 KB/s ↓45.8 KB/s | (24px Status Bar)
+-----------------------------------------------------------------------------------------------+
```

---

## 🚀 Key Features

### 1. 100% Portable & Zero Registry Footprint
- All configurations, host bookmarks, snippets, tunnels, and keys reside in `./config.toml` and `./.ssh/` directly next to the executable.
- Fully portable across Windows, Linux, and macOS without installers, daemons, or background services.

### 2. High-Performance Terminal & Protocols
- **Pure Async SSH (`russh`)**: In-process multiplexed SSH channels for PTY, SFTP, and telemetry — eliminating C FFI dependencies and OS process wrappers.
- **Dedicated Interactive PTY Sessions**: Real login shells with genuine PAM MOTD, pre-login server auth banners (`SSH_MSG_USERAUTH_BANNER`), and strict connection lifecycle teardown on tab closure or shell `exit`.
- **Mosh Protocol Support**: Roaming-resilient Mobile Shell with client-side Predictive Local Echo for instantaneous typing over high-latency links.
- **ZMODEM Transfers & Bastion Fallback**: Seamless in-band terminal transfers (`sz`/`rz`). File Explorer transparently browses and transfers files on locked-down hosts where the SFTP subsystem is blocked.
- **Universal Host Importer**: 1-click host discovery and import from OpenSSH (`~/.ssh/config`), Windows PuTTY & KiTTY Registry, Termius JSON, MobaXterm `.ini`, FileZilla, and WSL.
- **ConPTY / OpenPTY Backend**: Native pseudo-terminal integration for local shells (PowerShell, CMD, Git Bash, WSL).
- **Hardware-Accelerated Viewport**: Powered by `xterm.js` with WebGL rendering for 120+ FPS throughput.

### 3. Native WSL & Linux Virtual Machine Management
- **Zero-Process Registry Distro Discovery**: Reads distribution names, GUIDs, versions (WSL 1 vs WSL 2), default UID user, and filesystem base paths via `winreg` (`HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss`) without process overhead or UI stutter.
- **Virtual Disk Image Size Display**: Inspects distro storage paths and computes exact virtual disk size (`ext4.vhdx` / `.vhd`), rendering formatted size badges (e.g. `2.4 GB`, `450 MB`) in headers and path badges.
- **Strict Online Catalog & Box Importer**: Online distro discovery queries directly via `wsl.exe --list --online` to eliminate invalid non-manifest packages, with a built-in "Import Box" interface for custom `.tar`, `.tar.gz`, or `.vhdx` rootfs appliances.
- **Pure-Code Detection**: Detects WSL subsystem availability via Windows registry services (`HKLM\SYSTEM\CurrentControlSet\Services\LxssManager`) and hides WSL buttons seamlessly when not on Windows or WSL is absent.
- **Direct Terminal Attach**: Direct ConPTY shell attach (`wsl.exe -d <distro>`) without requiring SSH daemons or open ports.
- **Plan9 9P Filesystem Browsing**: Browse, edit, and sync files inside Linux distributions directly using Windows MUP/Plan9 UNC paths (`\\wsl.localhost\<distro>\`) in the built-in File Explorer.
- **Virtual Machine Lifecycle Controls**: Start, terminate individual distros, clean shutdown all micro-VMs (`wsl --shutdown`), provision new distros, or unregister disks.
- **1-Click Homelab Bookmarking**: Auto-converts WSL distros into 1-click registered hosts with custom Linux penguin badge icons.

### 4. File Explorer, Data Studio & Archives
- **Dual-Mode SFTP Explorer**: Unified local workspace and remote SFTP directory tree with path breadcrumbs, search filters, and `CF_HDROP` clipboard paste support.
- **Archive Inspector (Virtual VFS)**: Instant in-place inspection of `.zip`, `.tar.gz`, and `.7z` without downloading full archive bodies via seekable central directory readers.
- **AST Structured Tree Studio**: Deep YAML 1.2, JSON, and TOML object inspection powered by `js-yaml` and resilient fallback parsers. Supports multi-document streams (`---`), nested maps/lists (Kubernetes, Compose, Ansible), clickable expand/collapse rows, clean array indexing (`[0]`), and real-time live key/value search filtering (`#tree-search-filter`) that auto-expands matching parent nodes.
- **Multi-File Editor Tabs with Mouse-Wheel Scrolling**: In-memory buffer management preserving cursor positions, scroll offsets, and edit states per file tab. Horizontal mouse wheel scrolling over `#tab-strip` smoothly navigates overflowing tabs without crushing tab titles.
- **Live Markdown & Structured Data Studio**: Mode switcher (`Code`, `Preview`, `Tree`, `Grid`) featuring live GitHub-flavored Markdown rendering, collapsible AST trees for JSON/YAML/TOML, and virtualized sorting spreadsheet grids for CSV/TSV.
- **In-App SQLite Viewer**: Browse remote/local databases, inspect table schemas, execute custom SQL queries, and edit cells with atomic writebacks.
- **In-App Code Editor & Auto-Sync**: Syntax-highlighted config editor with `Ctrl + S` writeback and external editor watching (VS Code, Cursor, Notepad++).

### 5. Mesh VPN & Exit Node Routing (Pure In-Process)
- **Zero External Binaries**: Connect to private networks without installing external WireGuard, Tailscale, or NetBird binaries.
- **User-Space Protocol Engine**: Powered by `boringtun` user-space WireGuard tunnels and pure-code HTTPS/REST status engines.
- **Exit Node / Gateway Routing**: Route SSH, SFTP, Docker, and Port inspection connections through designated Mesh Exit Nodes.

### 6. Cloud Providers Integration (In-Memory Only)
- Native compute discovery for **Google Cloud Platform (GCP)**, **Amazon Web Services (AWS)**, and **Microsoft Azure**.
- In-memory instance browsing with zero disk footprint per run, and 1-click double-click SSH terminal attach.

### 7. Embedded Model Context Protocol (MCP) Server
- **Local AI Agent Integration**: Embedded HTTP & SSE server (`http://127.0.0.1:8765/mcp`) supporting local AI agents (Antigravity, Claude Code, Cursor).
- **Strict Credential Boundary**: Host passwords, private keys, and cloud tokens never leave Taris memory. Agents interact strictly by reference (`host_id`).
- **Comprehensive Tool Surface**: Exposes JSON-RPC 2.0 tools for `list_hosts`, `execute_command`, `list_containers`, `read_remote_file` (with ZMODEM fallback and 512KB truncation safety), `list_notes`, `add_notes`, `list_wsl_distros`, `add_wsl_distro`, and `list_cloud_instances`.
- **Pure Async Architecture**: Built directly with Tokio async TCP streaming without external HTTP frameworks. Toggleable in Settings with `config.toml` persistence.

### 8. Homelab & Dev Tools
- **Remote Docker Manager (Native Russh)**: Communicates directly with `/var/run/docker.sock` over SSH. Live container cards, CPU/RAM stats, streaming log viewers, and interactive `exec` shells running natively via `russh` credentials without prompting for passwords or spawning Windows `ssh.exe`.
- **Port & Socket Inspector**: Real-time inspection of listening TCP/UDP sockets and foreign connections (local via `netstat2`, remote via `/proc/net`).
- **Notes & Snippets**: Command notes styled as terminal window cards matching active terminal themes. Double-click to paste into terminal, right-click to copy.
- **SSH Port Forwarding**: Background TCP proxies with one-click toggles and browser launch shortcuts.

---

## 🏗️ Codebase Structure

```
SSH_Term/
├── config.toml                 # Portable configuration (adjacent to binary)
├── src/                        # Rust backend (Tauri v2)
│   ├── Cargo.toml              # Dependencies (russh, russh-sftp, boringtun, etc.)
│   ├── src/
│   │   ├── lib.rs              # App state, IPC commands, and PTY lifecycle
│   │   ├── archive/            # Seekable archive VFS (.zip, .tar.gz, .7z)
│   │   ├── cloud/              # GCP, AWS, Azure in-memory compute discovery
│   │   ├── docker.rs           # Docker/Podman REST client & container streaming
│   │   ├── editor.rs           # External editor auto-sync watcher
│   │   ├── importer/           # OpenSSH, PuTTY, KiTTY, Termius, MobaXterm, FileZilla
│   │   ├── logs.rs             # In-memory circular log buffer
│   │   ├── mcp/                # HTTP & SSE Model Context Protocol server
│   │   ├── mesh/               # WireGuard, Tailscale, and NetBird user-space tunnels
│   │   ├── mosh/               # Mosh UDP transport & Predictive Local Echo
│   │   ├── ports.rs            # Port & socket inspector (procfs & netstat2)
│   │   ├── ssh/                # Pure async russh client, session pool, and SFTP
│   │   ├── terminal/           # ZMODEM stream interceptor & frame state machine
│   │   └── wsl/                # Windows Subsystem for Linux (WSL) lifecycle & 9P VFS
│   └── tests/                  # Integration test suites (split from src code)
│       ├── archive_tests.rs    # In-memory archive creation & inspection tests
│       ├── core_tests.rs       # Config, clipboard, shell, permissions tests
│       ├── importer_tests.rs   # OpenSSH, MobaXterm, FileZilla parsing tests
│       ├── mcp_tests.rs        # MCP JSON-RPC, tools, credential isolation, and SSE tests
│       ├── mesh_tests.rs       # WireGuard, Tailscale, NetBird status & key tests
│       ├── terminal_tests.rs   # ZMODEM headers, signatures, and payload tests
│       └── wsl_tests.rs        # WSL detection, registry decoding, and host mapping tests
└── ui/                         # Modular Frontend (100% bare-system portable)
    ├── index.html              # Clean markup & script loading order (0 bundlers)
    ├── styles.css              # Custom Nordic / One Dark styling & variables
    ├── libs/                   # Bundled standalone vendor libraries (0 external npm runtime)
    │   ├── xterm.js            # Hardware-accelerated terminal
    │   ├── addon-fit.js        # Terminal viewport auto-fit
    │   ├── prism.min.js        # Multi-language live syntax highlighting
    │   └── js-yaml.min.js      # Robust YAML 1.2 parsing engine
    └── js/                     # Modular frontend architecture (16 files)
        ├── core.js             # IPC bridge, window management, splitters, tabs, mouse-wheel scroll
        ├── terminal.js         # xterm.js, themes, ZMODEM floating notifications
        ├── hosts.js            # Hosts drawer, connections, importer modal, WoL, telemetry guard
        ├── files.js            # Dual SFTP explorer, transfers widget, archive modal
        ├── editor.js           # Markdown preview, AST tree, CSV spreadsheet grid, buffer manager
        ├── database.js         # SQLite studio, query runner, table data grid
        ├── docker.js           # Container cards, live logs, exec shell (native russh)
        ├── ports.js            # Port/socket listener table & preset filters
        ├── snippets.js         # Notes drawer styled as terminal window mockups
        ├── tunnels.js          # Port forwarding drawer & TCP bridges
        ├── mesh.js             # Unified Mesh VPN drawer (WireGuard, Tailscale, NetBird)
        ├── cloud.js            # In-memory cloud compute instances & SSH connect
        ├── wsl.js              # Native WSL distro cards, disk size, VM lifecycle, 9P browsing
        ├── settings.js         # Preferences, MCP toggle, themes, fonts, cursor
        ├── logs.js             # App logs viewer & diagnostics export
        └── main.js             # App initialization & global keyboard shortcuts
```

---

## 🛠️ Tech Stack & Architecture

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Backend Core** | **Rust 2021 (Tauri v2)** | Non-blocking async runtime (`tokio`), PTY streaming, system telemetry |
| **Frontend** | **Vanilla JS + Modern CSS + HTML5** | Modular architecture under `ui/js/`, zero-bundler, 100% bare-system portable |
| **Terminal Engine** | **xterm.js + WebGL Addon** | Ultra-low latency terminal rendering |
| **SSH Protocol** | **`russh` + `russh-sftp` (Pure Async)** | In-process multiplexed SSH channels, dedicated interactive PTY, async SFTP, zero C FFI |
| **Structured Data** | **`js-yaml` + Pure JS Engine** | Comprehensive YAML 1.2, JSON, and TOML AST tree parser with search filtering |
| **Mobile Shell** | **`oryxis-mosh` + Native SSP** | UDP State Synchronization Protocol with Predictive Local Echo |
| **In-Band Transfers** | **ZMODEM Streaming Engine** | Frame interceptor, CRC-16/32 checksums, transparent SFTP fallback |
| **Archive VFS** | **`zip` + `tar` + `sevenz-rust`** | Central directory seekable readers for sub-50ms metadata inspection |
| **WSL Integration** | **`winreg` + Plan9 9P UNC + ConPTY** | Direct registry discovery, VHDX disk size calculation, VM lifecycle, zero-process distro management |
| **Mesh / VPN** | **`boringtun` + Loopback Forwarder** | Embedded WireGuard protocol engine; zero external dependencies |
| **MCP Server** | **Pure Tokio HTTP/1.1 & SSE** | JSON-RPC 2.0 AI agent integration with strict credential isolation |
| **Logging** | **In-memory bounded ring buffer** | Real-time cross-boundary unified logging (Rust backend + Webview JS) |

---

## 📦 Building & Testing

### Prerequisites
- [Rust](https://www.rust-lang.org/) (latest stable, 1.77+)
- Zero external dependencies or Node.js build tooling required.

### Running Tests
```bash
# Run all 38 integration tests across tests/
cargo test --manifest-path src/Cargo.toml --tests -- --test-threads=1
```

### Development Mode
```bash
# Run application in dev mode
cargo tauri dev --manifest-path src/Cargo.toml
```

### Production Build
```bash
# Build standalone optimized release executable
cargo tauri build --manifest-path src/Cargo.toml
```
The compiled self-contained binary will be generated in `src/target/release/taris.exe`.

---

## 📄 License
MIT License. Crafted for homelab enthusiasts and systems engineers.
