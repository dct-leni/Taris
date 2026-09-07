# 📋 Taris Implementation Plan (Pure Rust GPU & Homelab Suite)

> **A step-by-step development roadmap for Taris. Saved locally in `PLAN.md` so you can edit, adjust priorities, and track milestones at any time.**

---

## 🗺️ Execution Phases Overview

```
[Phase 1: UI Shell First] ──> [Phase 2: Local PTY Terminal] ──> [Phase 3: SSH Engine & Keys]
                                                                        │
[Phase 6: Settings & MCP] <── [Phase 5: Built-in VPN & Cloud] <── [Phase 4: SFTP, Editor & DB Viewer]
        │
        └──> [Phase 7: Future Request - Semantic Structured Data & Config Diff Viewer]
```

---

## 💡 Architecture Decision: GUI Framework & Zero External Dependencies
- **Selected**: **Tauri v2 (Rust Backend + Native WebGL/DWM Frontend)**
- **Strict Portability & Bare System Requirement (MANDATORY)**:
  - **Zero External Host or Local Binaries**: The app must **never** execute, wrap, or depend on external binaries (`ssh.exe`, `scp.exe`, `sftp.exe`, `python`, `python3`, `bash`, `awk`, `base64`, `sqlite3.exe`, etc.) for any internal operations, remote file management, telemetry, or data queries.
  - **Bare System Execution**: The application must run locally on a bare, clean Windows system with zero pre-installed tooling, and connect to a completely bare, minimal remote host (e.g. fresh Linux/Unix installation without Python or coreutils packages) with 100% of features functioning seamlessly.
  - **In-Process Native Implementation**:
    - SSH/SFTP/SCP operations are handled 100% in-process using embedded pure Rust libraries (`ssh2` / `rusqlite` bundled).
    - Remote file listing, file reading, file editing, and database caching operate strictly through the RFC SFTP and SCP protocol implementations.
    - Remote telemetry and container checks communicate directly through in-process SSH channels with native parsing in Rust.
  - **100% Self-Contained Single Executable**: All UI assets (HTML, CSS, JS, fonts, glyphs) and dependencies are compiled directly into `taris.exe` at compile time. Config is kept strictly adjacent in `./config.toml` for a zero-footprint portable application.
- **Why Tauri v2 over pure egui**:
  - **Native Windows DWM Dragging**: By using hardware DWM window dragging (`-webkit-app-region: drag;`), window movement is 100% hardware accelerated by Windows DWM at 240Hz with zero latency, native Windows 11 snap layouts, and smooth corner rounding.
  - **High-DPI Typography & Sharpness**: Browser engine renders typography, monospace fonts, and syntax highlighting with subpixel antialiasing matching VS Code and Zed.
  - **GPU Accelerated Rendering**: Terminal viewports utilize hardware WebGL canvas shaders for 144+ FPS throughput.


---

## 📌 Phase 1: Pure Rust UI Shell (Interactive & Testable) — [COMPLETED]
*Goal: Build the complete visual desktop shell so you can run `cargo run`, test resizing, click tabs, test collapsing, test the SQLite viewer and in-app editor layout, and verify the exact aesthetic before wiring backend logic.*

- [x] **1.1 Project Setup & Dependencies**
  - Initialize Cargo project with `eframe`, `egui`, `wgpu`, `sysinfo`.
  - Embed bundled **Cascadia Code** font bytes via `include_bytes!` for 100% self-contained typography.
  - Configure calm Nordic One Dark color palette tokens in `src/theme.rs`.
  - Integrate Font Awesome monochrome vector glyph rendering.
- [x] **1.2 Slim Header (24px)**
  - App brand: **Taris** with subtle indicator dot.
  - Live local machine telemetry query (`sysinfo`): `Local CPU: 4% | Local RAM: 18%`.
  - Minimal window controls (`—`, `□`, `✕`).
- [x] **1.3 Termius-Style Left Navigation & Collapsible Dock**
  - Far-left narrow rail (~34px) with Font Awesome monochrome icons:
    - 🖥️ `Hosts` (Homelab & Cloud instances)
    - 🐳 `Docker` (Dynamic tab; active only when Docker is detected on host)
    - 🔍 `Port & Socket Inspector` (Real-time network listeners & open file descriptors)
    - 🔀 `Port Forwarding` (Tunnels)
    - 🔑 `Keychain` (Keys & certs)
    - 🛡️ `WireGuard & Mesh` (WireGuard, Tailscale, NetBird)
    - ⚙️ `Settings` (at bottom)
  - Clicking active rail icon toggles **collapse/expand**:
    - **Collapsed**: Shows only the narrow ~34px icon rail.
    - **Expanded**: Shows the full category panel.
  - **Full-space vertical tabs**: Selected category uses the entire adjacent panel height.
- [x] **1.4 Resizable 3-Column Splitters**
  - Implement draggable splitter handles between Left Sidebar, Center Workspace, and Right Sidebar.
  - Minimum/maximum width limits with smooth `col-resize` feedback.
- [x] **1.5 Center Workspace: Tabbed Terminal, In-App Editor & SQLite Viewer Mock**
  - Tab bar: `[ 💻 Local PC ]`, `[ 🟢 pve-node-01 ✕ ]`, `[ 🗄️ production.db ✕ ]`, `[ 📄 config.yaml ✕ ]`, `[ + ]`.
  - Simulated terminal viewport with Cascadia Code font, calm prompt, and command output.
  - In-app SQLite viewer layout mock: tables sidebar, interactive data table with columns and mock rows.
  - In-app code editor tab layout mock with syntax coloring and line numbers.
- [x] **1.6 Right Sidebar: SFTP Explorer**
  - Directory tree showing files, permissions, sizes.
  - Text-only right-click context menu (`Edit (In-App)`, `View (Database)`, `Edit (External)`, `Download`, `Upload`, `Copy`, `Paste`, `Delete`).
- [x] **1.7 Bottom Status Bar (20px)**
  - Active host name, key, and latency badges (`● 2ms (Tailscale)`).
  - Multi-threaded transfer progress bar component: `↓ config.yaml (65%) [████░░] 1.2 MB/s`.

---

## 📌 Phase 2: Local Terminal (PTY) Core — [COMPLETED]
*Goal: Make the internal terminal live and interactive for your local machine.*

- [x] **2.1 Pseudo-Terminal Integration (`portable-pty`)**
  - Spawn local interactive shell (PowerShell on Windows, bash/zsh on Linux/macOS) with ConPTY support.
  - Bidirectional stdin/stdout streaming over background threads and Tauri IPC events (`pty-write`, `pty-data`).
- [x] **2.2 ANSI Grid & Parser (`xterm.js` v5.5)**
  - Full VT100 / ANSI escape sequence parsing (colors, cursor movements, clear screen, htop, vim, tmux).
  - High-performance WebGL / canvas terminal rendering embedded into `ui/libs/`.
- [x] **2.3 Terminal Resizing & Fit Addon**
  - Integrated `FitAddon` to dynamically calculate rows and columns on window resize and splitter dragging.
  - Automatically signals `pty_resize` to backend ConPTY.

---

## 📌 Phase 3: Portable Storage & Async SSH Connection Pool — [COMPLETED]
*Goal: Connect to real remote servers with SSH keys and maintain parallel sessions.*

- [x] **3.1 Portable Configuration Engine (`./config.toml`)**
  - Zero external registry or `%APPDATA%` footprint; config stored next to binary in `./config.toml`.
  - SSH keys stored in `./.ssh/` directory next to executable.
  - Live configuration loading, updating, and saving via Tauri IPC (`get_config`, `save_config`).
- [x] **3.2 Remote SSH PTY Client**
  - Direct connection to remote SSH servers via PTY shell command with key or password authentication.
  - Live session streaming and multi-terminal tab attachment.
- [x] **3.3 Host Management & Universal Icon Picker**
  - In-app "+ Add Host" modal dialog with Host, Port, Username, Auth Type (Key vs Password), and Font Awesome icon picker.
  - Delete host functionality and real-time drawer updates.
- [x] **3.4 Settings & Studio Preferences Panel (Full Left Drawer)**
  - Settings seamlessly occupies the entire left section with organized cards for App Appearance, Terminal Styling, Shell Configuration, and Portable Footprint.
  - 10 popular color themes: **One Dark Pro**, **Tokyo Night**, **Dracula**, **Catppuccin Mocha**, **Nord Arctic**, **Monokai Pro**, **Solarized Dark**, **Gruvbox Dark**, **Synthwave '84**, **Alacritty Dark** with dropdown and 2-column quick buttons.
  - Font size dropdowns: Independent **App UI Font Size** (11px–16px, scales entire interface) and **Terminal Font Size** (11px–20px).
  - Cursor style dropdown (Block, Underline, Bar) and Font Family selector (Cascadia Code, Fira Code, Consolas, Segoe UI).
  - Automated SSH password detection & auto-injection for password-authenticated hosts.
  - Host editing & password configuration with in-app live preview.
  - Zero history corruption or buffer mangling during tab switching.
  - All mock data removed: live `sysinfo` CPU/RAM and Network RX/TX throughput, real local filesystem explorer.


---

## 📌 Phase 4: Modern File & Data Management — [COMPLETED]
*Goal: Remote file management, lightweight in-app code editing, and full SQLite database inspection.*

- [x] **4.1 Asynchronous SFTP Explorer**
  - Query remote and local directories with parent folder navigation (`..`), breadcrumb path bar, search filter, and customizable columns.
- [x] **4.2 In-App SQLite & Database Viewer Tab (`rusqlite`)**
  - Double-clicking or opening any `.sqlite`, `.sqlite3`, or `.db` file (local or remote via automatic cache download) opens a dedicated Database Studio tab in the center workspace.
  - Left sub-pane listing database tables and live row counts (`SELECT count(*) FROM table`).
  - Interactive SQL query runner with execution duration timing and formatted data table grid.
- [x] **4.4 In-App Code Editor Tab**
  - Center tab with line numbers, status indicators (`✓ Saved` / `● Modified`), language badge, and live syntax highlighting for YAML, TOML, JSON, Bash, Dockerfile, SQL, Python, and Rust.
  - Instant writeback via `write_local_file` and base64 binary-safe `write_remote_file` over SSH (`Ctrl + S` or Save button).
- [x] **4.5 External Editor Auto-Sync Option (WinSCP / MobaXterm Style)**
  - Auto-discovery of installed editors (Zed, VS Code, Notepad++, Sublime Text, Cursor, Notepad) on system.
  - Dropdown in Settings drawer (`config.toml` persistence) and dynamic context menu label.
  - Right-click option on SFTP file items: `Edit in External Editor` (downloads to local cache, launches editor, watches file for modifications, uploads back to remote via native SFTP on save, and triggers in-app notification).
- [x] **4.6 Multi-Threaded Transfers & Clipboard Paste**
  - High-performance chunked SFTP streaming (`sftp_upload_file`, `sftp_download_file`) emitting real-time transfer progress, speed (KB/s, MB/s), and completion status.
  - Interactive bottom status bar transfer widget with live progress bar and spinner.
  - Native Win32 `CF_HDROP` clipboard listener: pressing `Ctrl + V` inside SFTP uploads or copies files copied from Windows Explorer directly into the current directory.

---

## 📌 Phase 5: Homelab Tools (Docker, Port Scanner, Mesh VPN & Cloud)
*Goal: Remote Docker inspection, real-time port/socket discovery, native mesh clients, and cloud tunnels.*

- [x] **5.1 Remote & Local Docker / Podman Tab**
  - Active for local and remote host when Docker or Podman is detected.
  - Configurable Docker / Podman port in Settings (default `2375`), persisted in `config.toml`.
  - Zero external CLI wraps: communicates directly with Docker / Podman daemon over HTTP REST API (supporting TCP port forwarding over SSH, Windows Named Pipe `\\.\pipe\docker_engine`, and Unix sockets).
  - Displays container cards in the left panel with status pills (🟢 `Up 4d (healthy)`, 🔴 `Exited`), real-time memory usage (`441.7 MiB / 512 MiB`), image tag, and action buttons.
  - Double-clicking container or clicking **Logs** streams `docker logs -f --tail 200 <container>` in a center workspace tab.
  - **Exec** button launches an interactive shell terminal (`docker exec -it <container> sh`) in a dedicated tab.
  - Controls to Start, Stop, and Restart containers.

- [x] **5.2 Real-Time Port & Socket Inspector**
  - Available for local and remote hosts with ZERO external tools/binaries/CLI wrappers.
  - 100% Cross-platform (Windows, Linux, macOS).
  - Local scanning via in-process `netstat2` crate and `sysinfo`.
  - Remote scanning over SFTP reading kernel procfs (`/proc/net/tcp`, `/proc/net/tcp6`, `/proc/net/udp`, `/proc/net/udp6`).
  - Output in the left panel: Open TCP/UDP ports, protocol badges, state pills, and associated process names.
  - Preset filters:
    - `All`
    - `Docker`
    - `127.0.0.1` (Loopback)
    - `Foreign` (listeners with active foreign connections)
- [x] **5.3 Unified Mesh VPN Drawer (WireGuard, Tailscale, NetBird)**
  - Single unified drawer view combining all mesh network types without subtabs.
  - Large WireGuard configuration textarea comfortably fitting 10+ lines (`rows="12"`, `min-height: 220px; monospace`).
  - Adaptive Add Mesh Network modal with dynamic field switching per type.
  - **Strict Mutual Exclusion**: Only one active mesh/VPN connection allowed at any time (backend automatically drains and cancels existing active tunnels upon activating any network).
  - Modular architecture (`src/src/mesh/mod.rs`, `wireguard.rs`, `tailscale.rs`, `netbird.rs`).
- [x] **5.4 Dedicated Cloud Providers Drawer (GCP, AWS, Azure — In-Memory Only)**
  - Removed cloud configuration fields from Add Host modal for streamlined host addition.
  - Dedicated Cloud activity rail button (`#rail-btn-cloud`) and drawer.
  - Top settings gear button (⚙️) for provider credential configuration (GCP Service Account JSON/gcloud, AWS credentials/profiles, Azure tokens/CLI).
  - Live in-memory project/region and compute instance exploration (GCP Compute Engine, AWS EC2, Azure VMs).
  - **Held Strictly in Memory**: Projects and compute instances are never saved to disk (`config.toml`), retaining zero disk footprint per run.
  - **Double-Click SSH**: Double-clicking any cloud instance launches an SSH session in a new tab using native metadata/tunneling.
  - Modular architecture (`src/src/cloud/mod.rs`, `gcp.rs`, `aws.rs`, `azure.rs`).
- [x] **5.5 SSH Port Forwarding (Tunnels) & Wake-on-LAN (WoL)**
  - Async TCP proxy (`tokio::net::TcpListener`) with one-click toggles.
  - UDP magic packet sender broadcasting to host MAC addresses.
- [x] **5.6 Codebase Modularization**
  - Split `lib.rs` into specialized domain modules (`mesh/`, `cloud/`, `docker.rs`, `ports.rs`, `editor.rs`).

---

## 📌 Phase 6: Settings & Model Context Protocol (MCP)
*Goal: Complete customization and AI agent integration.*

- [x] **6.1 Settings Panel (⚙️)**
  - Terminal color scheme loader (parse iTerm2 `.itermcolors` and Termius JSON palettes).
  - Terminal cursor settings (shape, blink, scrollback buffer size).
- [ ] **6.2 HTTP Model Context Protocol (MCP) Server**
  - Built-in HTTP server (`http://127.0.0.1:8765/mcp`).
  - **Disabled by default**; enabled via toggle in Settings.
  - Exposes tools for AI agents (Antigravity, Claude Code): `list_hosts`, `execute_command`, `list_containers`, `read_remote_file`.
  - Make sure instance credentials/ssh keys/token won't be exposed, AI should be able to get hosts from Taris and connect to it using the credentials stored in Taris. (No need to create new ssh key/token/credential)

---

## 📌 Phase 7: Future Request (Last Phase) — Semantic Structured Data & Config Diff Viewer
*Goal: Intelligent config comparison and semantic diffing.*

- [ ] **7.1 Multi-Format Structured Data Diff Viewer**
  - Side-by-side or unified diff viewer for structured formats: YAML, JSON, TOML.
- [ ] **7.2 Semantic Key Reordering Detection**
  - Parser parses abstract syntax trees (AST) of structured configs.
  - If a key like `database.port` is moved from line 5 to line 40, mark it visually as **"reordered"** rather than deleted and re-added.
- [ ] **7.3 3-Way Remote Config Merge**
  - Resolve remote vs local config conflicts visually before uploading.

---

## 🧪 Verification & Acceptance Criteria
1. `cargo run` launches instantly (<15ms) on Windows using DirectX 12 / wgpu.
2. Memory consumption remains < 20 MB.
3. Resizable splitters, collapsible icon dock, and vertical category tabs function smoothly.
4. SQLite viewer opens `.db` files, displays tables and rows, and allows editing with commit save.
5. Double-clicking a Docker container in the left panel streams logs into a center tab.
6. Real-time port/socket scanner groups listeners with one-click filter presets.
