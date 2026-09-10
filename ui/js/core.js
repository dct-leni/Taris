// ── Tauri v2 Core IPC Bridge ──
const invoke = window.__TAURI__?.core?.invoke || (async (cmd, args) => {
  console.log(`[Tauri Mock IPC] invoke "${cmd}" with`, args);
  if (cmd === 'get_telemetry') return { cpu: 4.2, ram: 24.5, net_rx: 120000, net_tx: 850000 };
  if (cmd === 'get_config') return {
    settings: { font_family: 'Cascadia Code', font_size: 14, theme: 'one_dark', default_shell: 'powershell' },
    hosts: []
  };
  if (cmd === 'list_local_files') return [
    { name: 'src', path: 'src', size: 'DIR', modified: 'Just now', is_dir: true, is_db: false },
    { name: 'ui', path: 'ui', size: 'DIR', modified: 'Just now', is_dir: true, is_db: false },
    { name: 'config.toml', path: 'config.toml', size: '1.2 KB', modified: 'Just now', is_dir: false, is_db: false },
    { name: 'production.db', path: 'production.db', size: '348 KB', modified: 'Sep 3 23:45', is_dir: false, is_db: true },
    { name: 'Cargo.toml', path: 'Cargo.toml', size: '395 B', modified: 'Sep 4 02:10', is_dir: false, is_db: false },
  ];
  return null;
});

const Channel = window.__TAURI__?.core?.Channel || class {
  constructor() {
    this.onmessage = () => { };
  }
};

const listen = window.__TAURI__?.event?.listen || ((evt, cb) => {
  console.log(`[Tauri Mock Event] listening to ${evt}`);
  return Promise.resolve(() => {});
});

// ── Unified Webview Logging Interceptor ──
(function setupWebviewLogging() {
  const origError = console.error;
  const origWarn = console.warn;
  let isLogging = false;

  console.error = function (...args) {
    origError.apply(console, args);
    if (isLogging) return;
    try {
      isLogging = true;
      const msg = args.map((a) => (typeof a === 'object' ? (a instanceof Error ? (a.stack || a.message) : JSON.stringify(a)) : String(a))).join(' ');
      if (window.__TAURI__?.core) {
        invoke('log_webview_event', { level: 'ERROR', target: 'webview', message: msg }).catch(() => {});
      }
    } catch (_) {} finally {
      isLogging = false;
    }
  };

  console.warn = function (...args) {
    origWarn.apply(console, args);
    if (isLogging) return;
    try {
      isLogging = true;
      const msg = args.map((a) => (typeof a === 'object' ? (a instanceof Error ? (a.stack || a.message) : JSON.stringify(a)) : String(a))).join(' ');
      if (window.__TAURI__?.core) {
        invoke('log_webview_event', { level: 'WARN', target: 'webview', message: msg }).catch(() => {});
      }
    } catch (_) {} finally {
      isLogging = false;
    }
  };

  const origInfo = console.info;
  console.info = function (...args) {
    origInfo.apply(console, args);
    if (isLogging) return;
    try {
      isLogging = true;
      const msg = args.map((a) => (typeof a === 'object' ? (a instanceof Error ? (a.stack || a.message) : JSON.stringify(a)) : String(a))).join(' ');
      if (window.__TAURI__?.core) {
        invoke('log_webview_event', { level: 'INFO', target: 'webview', message: msg }).catch(() => {});
      }
    } catch (_) {} finally {
      isLogging = false;
    }
  };

  window.addEventListener('error', (event) => {
    try {
      const loc = event.filename ? ` (${event.filename}:${event.lineno || 0}:${event.colno || 0})` : '';
      const msg = `${event.message || 'JavaScript Error'}${loc}`;
      if (window.__TAURI__?.core) {
        invoke('log_webview_event', { level: 'ERROR', target: 'webview', message: msg }).catch(() => {});
      }
    } catch (_) {}
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason;
      const msg = `Unhandled Rejection: ${reason ? (reason.stack || reason.message || String(reason)) : 'Unknown'}`;
      if (window.__TAURI__?.core) {
        invoke('log_webview_event', { level: 'ERROR', target: 'webview', message: msg }).catch(() => {});
      }
    } catch (_) {}
  });
})();

// ── Native Clipboard Bridge (Bypasses WebView2 Permissions Prompt) ──
async function getSystemClipboardText() {
  try {
    const text = await invoke('get_clipboard_text');
    if (typeof text === 'string') return text;
  } catch (e) {
    console.warn('Native get_clipboard_text error:', e);
  }
  if (navigator.clipboard && navigator.clipboard.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch { }
  }
  return '';
}

async function setSystemClipboardText(text) {
  const str = String(text || '');
  try {
    await invoke('write_clipboard_text', { text: str });
    return;
  } catch (e) {
    console.warn('Native write_clipboard_text error:', e);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(str);
    } catch { }
  }
}

// Override navigator.clipboard so any standard browser calls use native OS Win32 API without permissions prompt
if (typeof navigator !== 'undefined') {
  try {
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', { value: {}, writable: true, configurable: true });
    }
    if (navigator.clipboard) {
      navigator.clipboard.readText = () => getSystemClipboardText();
      navigator.clipboard.writeText = (text) => setSystemClipboardText(text);
    }
  } catch (err) {
    console.warn('Failed to patch navigator.clipboard:', err);
  }
}

// ── Global Escape Helper ──
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── WSL & Local Path Normalization Helper ──
function normalizeWslPath(path, distroName = null) {
  if (!path) return path;

  // 1. Windows DrvFs mount in WSL: /mnt/c/..., \mnt\c\..., \\wsl.localhost\<distro>\mnt\c\...
  const mntMatch = path.match(/^(?:(?:\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\\/][^\\\/]+)?[\\\/]mnt[\\\/]([a-zA-Z])(?:[\\\/](.*))?$/i);
  if (mntMatch) {
    const drive = mntMatch[1].toUpperCase();
    const rest = mntMatch[2] ? mntMatch[2].replace(/\//g, '\\') : '';
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }

  // 2. Git Bash / MSYS2 style path: /c/Users/... -> C:\Users\...
  const gitBashMatch = path.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  if (gitBashMatch) {
    const drive = gitBashMatch[1].toUpperCase();
    const rest = gitBashMatch[2] ? gitBashMatch[2].replace(/\//g, '\\') : '';
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }

  // 3. Native Linux path inside WSL (e.g. /home/user, /var/log, etc.)
  if (distroName && (path.startsWith('/') || path.startsWith('\\'))) {
    const cleanUnix = path.replace(/\\/g, '/').replace(/^\/+/, '');
    return cleanUnix ? `\\\\wsl.localhost\\${distroName}\\${cleanUnix.replace(/\//g, '\\')}` : `\\\\wsl.localhost\\${distroName}`;
  }

  // 4. Already a UNC path like \\wsl.localhost\Ubuntu\home/user
  if (path.startsWith('\\\\wsl.localhost') || path.startsWith('\\\\wsl$')) {
    return path.replace(/\//g, '\\');
  }

  return path;
}

// ── Global State ──
let appConfig = {
  settings: {
    font_family: 'Cascadia Code',
    font_size: 14,
    app_font_size: 13,
    theme: 'one_dark',
    app_theme: 'one_dark',
    terminal_theme: 'one_dark',
    default_shell: 'powershell',
    cursor_style: 'block',
    drawer_width: 240,
    sidebar_width: 310,
    sftp_col_date_width: 105,
    sftp_col_size_width: 55,
  },
  hosts: [],
  snippets: [],
  session: {
    active_view: 'local',
    active_category: 'hosts',
    rail_order: ['hosts', 'cloud', 'files', 'snippets', 'docker', 'ports', 'tunnels', 'wireguard'],
    show_host_ip: false,
  },
  file_explorer: {
    col_date: true,
    col_size: true,
    col_type: false,
    col_perms: false,
    width_date: 105,
    width_size: 55,
    width_type: 50,
    width_perms: 75,
  },
};

let persistConfigTimer = null;
let isConfigLoaded = false;
function persistConfig(immediate = false) {
  if (!appConfig || !isConfigLoaded) return;
  if (!appConfig.session) {
    appConfig.session = {
      active_view: 'local',
      active_category: activeCategory || 'hosts',
      rail_order: ['hosts', 'cloud', 'files', 'snippets', 'docker', 'ports', 'tunnels', 'wireguard'],
      show_host_ip: !!showHostIp,
    };
  }
  if (!appConfig.file_explorer) {
    appConfig.file_explorer = {
      col_date: true,
      col_size: true,
      col_type: false,
      col_perms: false,
      width_date: 105,
      width_size: 55,
      width_type: 50,
      width_perms: 75,
    };
  }
  if (immediate) {
    if (persistConfigTimer) clearTimeout(persistConfigTimer);
    invoke('save_config', { config: appConfig }).catch((err) => console.error('Failed to save config:', err));
  } else {
    if (persistConfigTimer) clearTimeout(persistConfigTimer);
    persistConfigTimer = setTimeout(() => {
      invoke('save_config', { config: appConfig }).catch((err) => console.error('Failed to save config:', err));
    }, 250);
  }
}

const KNOWN_PORTS = {
  20: 'FTP Data',
  21: 'FTP Control',
  22: 'SSH Remote Login',
  23: 'Telnet',
  25: 'SMTP Mail',
  53: 'DNS Domain Name System',
  67: 'DHCP Server',
  68: 'DHCP Client',
  69: 'TFTP',
  80: 'HTTP Web Server',
  110: 'POP3 Mail',
  111: 'RPCbind / NFS',
  123: 'NTP Time Sync',
  137: 'NetBIOS Name',
  138: 'NetBIOS Datagram',
  139: 'NetBIOS Session',
  143: 'IMAP Mail',
  161: 'SNMP Network Mgmt',
  162: 'SNMP Trap',
  389: 'LDAP Directory',
  443: 'HTTPS Secure Web',
  445: 'SMB File Sharing',
  465: 'SMTPS Secure Mail',
  514: 'Syslog',
  587: 'SMTP Submission',
  636: 'LDAPS Secure Directory',
  873: 'Rsync Sync Service',
  993: 'IMAPS Secure Mail',
  995: 'POP3S Secure Mail',
  1080: 'SOCKS Proxy',
  1194: 'OpenVPN',
  1433: 'MS SQL Server',
  1521: 'Oracle DB',
  1883: 'MQTT Broker',
  2049: 'NFS Network File System',
  2375: 'Docker Daemon API',
  2376: 'Docker Daemon (TLS)',
  3000: 'Dev / Grafana / Node',
  3306: 'MySQL / MariaDB',
  3389: 'RDP Remote Desktop',
  4000: 'Node / Hexo / Dev',
  5000: 'Flask / Registry / Synology',
  51413: 'BitTorrent Peer Port',
  5432: 'PostgreSQL Database',
  5672: 'RabbitMQ AMQP',
  5900: 'VNC Remote Desktop',
  6379: 'Redis Cache / Store',
  8000: 'Dev / FastAPI / Portainer',
  8006: 'Proxmox VE Web UI',
  8080: 'HTTP Alt / Tomcat / Proxy',
  8081: 'HTTP Alt / Dev / Nexus',
  8086: 'InfluxDB Time Series',
  8443: 'HTTPS Alt / UniFi',
  8888: 'Jupyter / Web Admin',
  9000: 'Portainer / SonarQube / PHP-FPM',
  9090: 'Prometheus Metrics / Cockpit',
  9091: 'Transmission Web UI',
  9092: 'Apache Kafka',
  9100: 'Node Exporter Metrics',
  9200: 'Elasticsearch API',
  9418: 'Git Protocol',
  9443: 'Portainer HTTPS UI',
  10000: 'Webmin / Virtualmin',
  27017: 'MongoDB Database',
  28017: 'MongoDB Web Status',
};

let currentDir = null;
let activeCategory = 'hosts';
let prevNetRx = 0;
let prevNetTx = 0;
let prevNetTime = Date.now();

// ── 1. Flush Window Caption Buttons ──
document.getElementById('btn-minimize').addEventListener('click', () => {
  invoke('window_minimize').catch(console.error);
  setTimeout(() => {
    invoke('trim_memory').catch(() => {});
  }, 200);
});

document.getElementById('btn-maximize').addEventListener('click', async () => {
  try {
    const isMax = await invoke('window_maximize');
    const maxBtnSvg = document.querySelector('#btn-maximize svg');
    if (isMax) {
      maxBtnSvg.innerHTML = '<rect x="2" y="0.5" width="7.5" height="7.5" /><rect x="0.5" y="2" width="7.5" height="7.5" fill="var(--bg-dock)" />';
    } else {
      maxBtnSvg.innerHTML = '<rect x="0.5" y="0.5" width="9" height="9" />';
    }
  } catch (e) {
    console.error(e);
  }
});

document.getElementById('btn-close').addEventListener('click', () => {
  invoke('window_close').catch(console.error);
});


// ── 7. Tabs & Views ──

function setupTabStripScroll() {
  const tabStrip = document.getElementById('tab-strip');
  if (!tabStrip || tabStrip.__wheelAttached) return;
  tabStrip.__wheelAttached = true;

  tabStrip.addEventListener('wheel', (e) => {
    // If multiple tabs overflow the window/container, scroll horizontally with mouse wheel
    if (tabStrip.scrollWidth > tabStrip.clientWidth) {
      e.preventDefault();
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      tabStrip.scrollLeft += delta;
    }
  }, { passive: false });
}

function setupTabInteractivity() {
  setupTabStripScroll();
  const tabs = document.querySelectorAll('.tab-card');

  tabs.forEach((tab) => {
    tab.onclick = (e) => {
      if (e.target.classList.contains('tab-close')) return;
      document.querySelectorAll('.tab-card').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.getAttribute('data-view');

      if (view && view.startsWith('file-')) {
        if (typeof activateEditorTab === 'function' && window.openEditorBuffers && window.openEditorBuffers[view]) {
          activateEditorTab(view);
          return;
        }
        const filePath = tab.getAttribute('data-file-path');
        const isRemote = tab.getAttribute('data-is-remote') === 'true';
        const hostId = tab.getAttribute('data-host-id');
        const host = hostId ? (appConfig.hosts || []).find((h) => h.id === hostId) : null;
        const fileName = tab.querySelector('.tab-title')?.textContent || 'file';

        if (filePath) {
          openEditorTab(fileName, filePath, isRemote, host);
        } else {
          switchView(view);
        }
        return;
      } else if (view && view.startsWith('db-')) {
        const filePath = tab.getAttribute('data-file-path');
        const isRemote = tab.getAttribute('data-is-remote') === 'true';
        const hostId = tab.getAttribute('data-host-id');
        const host = hostId ? (appConfig.hosts || []).find((h) => h.id === hostId) : null;
        const fileName = tab.querySelector('.tab-title')?.textContent || 'db';

        if (filePath && (!currentDbState || currentDbState.filePath !== filePath)) {
          openDbTab(fileName, filePath, isRemote, host);
        } else {
          switchView('db');
        }
        return;
      }

      switchView(view);
      if (typeof syncFileExplorerWithActiveTerminal === 'function') {
        syncFileExplorerWithActiveTerminal();
      }
    };

    const closeBtn = tab.querySelector('.tab-close');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        const view = tab.getAttribute('data-view');

        // Allow closing if more than 1 tab exists
        if (document.querySelectorAll('.tab-card').length > 1) {
          const wasActive = tab.classList.contains('active');
          const nextTab = tab.nextElementSibling?.classList.contains('tab-card')
            ? tab.nextElementSibling
            : tab.previousElementSibling;

          // If closing a dynamic host tab, extra local tab, docker logs/exec tab, or WSL tab, kill PTY session and remove pane
          if (view && (view.startsWith('host-') || view.startsWith('local-') || view.startsWith('docker-') || view.startsWith('wsl-'))) {
            const sessionId = `session-${view}`;
            invoke('pty_close', { sessionId }).catch(console.error);
            if (view.startsWith('host-')) {
              const hostId = view.replace('host-', '');
              const host = (appConfig.hosts || []).find((h) => h.id === hostId);
              if (host) {
                invoke('ssh_disconnect_host', { host }).catch(console.error);
              }
            } else if (view.startsWith('docker-')) {
              const hostId = tab.getAttribute('data-host-id');
              if (hostId) {
                const host = (appConfig.hosts || []).find((h) => h.id === hostId);
                if (host) {
                  invoke('ssh_disconnect_host', { host }).catch(console.error);
                }
              }
            }
            if (terminalSessions[sessionId]) {
              try { terminalSessions[sessionId].term.dispose(); } catch (err) { }
              delete terminalSessions[sessionId];
            }
            document.getElementById(`${view}-pane`)?.remove();
          }

          // If closing an editor file tab, clean up in-memory buffer
          if (view && view.startsWith('file-')) {
            if (typeof closeEditorTab === 'function') {
              closeEditorTab(view);
            }
          }

          tab.remove();
          updateHostStatusDots();
          setTimeout(() => {
            invoke('trim_memory').catch(() => {});
          }, 300);

          // If closing a WSL tab and File Explorer was in WSL mode, reset back to local files
          if (view && view.startsWith('wsl-')) {
            const hasRemainingWslTabs = Array.from(document.querySelectorAll('.tab-card')).some((t) => (t.getAttribute('data-view') || '').startsWith('wsl-'));
            if (!hasRemainingWslTabs && typeof sftpMode !== 'undefined' && sftpMode === 'wsl') {
              sftpMode = 'local';
              sftpCurrentDistro = null;
              const localPath = (typeof sftpTrueLocalPath !== 'undefined' && sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
                ? sftpTrueLocalPath
                : (typeof sftpLocalPath !== 'undefined' && sftpLocalPath && !sftpLocalPath.startsWith('\\\\wsl') && !sftpLocalPath.startsWith('/') ? sftpLocalPath : '.');
              if (typeof loadLocalFiles === 'function') {
                loadLocalFiles(localPath);
              }
              const titleEl = document.getElementById('drawer-title') || document.getElementById('sftp-header-title');
              if (titleEl && activeCategory === 'files') titleEl.textContent = 'FILES: Local Workspace';
            }
          }

          if (wasActive && nextTab) {
            nextTab.click();
          } else {
            const currentActiveTab = document.querySelector('.tab-card.active');
            const currentView = currentActiveTab?.getAttribute('data-view') || 'local';
            if (typeof syncFileExplorerWithView === 'function') {
              syncFileExplorerWithView(currentView);
            }
          }
        }
      };
    }

    // Drag-and-Drop Reordering
    tab.ondragstart = (e) => {
      e.dataTransfer.effectAllowed = 'move';
      tab.classList.add('dragging');
    };

    tab.ondragend = () => {
      tab.classList.remove('dragging');
    };

    tab.ondragover = (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.tab-card.dragging');
      if (dragging && dragging !== tab) {
        const bounding = tab.getBoundingClientRect();
        const offset = e.clientX - bounding.left;
        if (offset > bounding.width / 2) {
          tab.after(dragging);
        } else {
          tab.before(dragging);
        }
      }
    };
  });
}

function updateLocalTabTitle(shellId) {
  const localTabTitle = document.querySelector('.tab-card[data-view="local"] .tab-title');
  if (localTabTitle) {
    const shell = shellId || appConfig?.settings?.default_shell || 'powershell';
    const shellName = typeof getShellDisplayName === 'function' ? getShellDisplayName(shell) : (shell || 'PowerShell');
    localTabTitle.textContent = `Local (${shellName})`;
  }
}

function switchView(view) {
  document.querySelectorAll('.tab-card').forEach((t) => t.classList.remove('active'));
  const activeTab = document.querySelector(`.tab-card[data-view="${view}"]`);
  if (activeTab) {
    activeTab.classList.add('active');
    activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  document.querySelectorAll('.view-pane').forEach((p) => p.classList.remove('active'));

  let activeSessionId = null;

  if (view === 'local') {
    document.getElementById('local-term-pane')?.classList.add('active');
    activeSessionId = 'session-local';
    updateLocalTabTitle(appConfig?.settings?.default_shell);
    initTerminalSession('session-local', 'terminal-container-local', appConfig?.settings?.default_shell || 'powershell');
    // Sync status bar
    const hName = document.getElementById('status-host-name');
    if (hName) hName.textContent = 'Local Machine';
    const sLat = document.getElementById('status-latency');
    if (sLat) sLat.textContent = typeof getShellDisplayName === 'function' ? getShellDisplayName(appConfig?.settings?.default_shell) : 'Local';
    const cBadge = document.getElementById('status-conn-badge');
    if (cBadge) cBadge.textContent = '(localhost)';
  } else if (view && view.startsWith('local-')) {
    const pane = document.getElementById(`${view}-pane`);
    if (pane) {
      pane.classList.add('active');
      activeSessionId = `session-${view}`;
      initTerminalSession(activeSessionId, `terminal-container-${view}`, appConfig.settings.default_shell || 'powershell');
      // Sync status bar
      const hName = document.getElementById('status-host-name');
      if (hName) hName.textContent = 'Local Shell';
      const sLat = document.getElementById('status-latency');
      if (sLat) sLat.textContent = getShellDisplayName(appConfig.settings.default_shell);
      const cBadge = document.getElementById('status-conn-badge');
      if (cBadge) cBadge.textContent = `(${view})`;
    }
  } else if (view && view.startsWith('host-')) {
    const pane = document.getElementById(`${view}-pane`);
    if (pane) {
      pane.classList.add('active');
      activeSessionId = `session-${view}`;
    }
    const hostId = view.replace('host-', '');
    const host = (appConfig.hosts || []).find((h) => h.id === hostId);
    if (host) {
      const hName = document.getElementById('status-host-name');
      if (hName) hName.textContent = host.name;
      const sLat = document.getElementById('status-latency');
      if (sLat) sLat.textContent = 'SSH';
      const cBadge = document.getElementById('status-conn-badge');
      if (cBadge) cBadge.textContent = `(${host.user}@${host.host}:${host.port || 22})`;
    }
  } else if (view === 'editor' || (view && view.startsWith('file-'))) {
    document.getElementById('editor-pane')?.classList.add('active');
    const activeTab = document.querySelector(`.tab-card[data-view="${view}"]`) || document.querySelector('.tab-card.active');
    const filePath = activeTab?.getAttribute('data-file-path') || currentlyOpenFile?.path || 'No file';
    const displayFileName = filePath.split(/[\\/]/).pop() || filePath;
    const isRemote = activeTab?.getAttribute('data-is-remote') === 'true';
    const hName = document.getElementById('status-host-name');
    if (hName) hName.textContent = isRemote ? 'Remote Editor' : 'Local Editor';
    const sLat = document.getElementById('status-latency');
    if (sLat) sLat.textContent = 'FILE';
    const cBadge = document.getElementById('status-conn-badge');
    if (cBadge) cBadge.textContent = `(${displayFileName})`;
  } else if (view === 'db' || (view && view.startsWith('db-'))) {
    document.getElementById('db-pane')?.classList.add('active');
    const activeTab = document.querySelector('.tab-card.active');
    const filePath = activeTab?.getAttribute('data-file-path') || document.getElementById('db-active-file')?.textContent || 'Database';
    const displayDbName = filePath.split(/[\\/]/).pop() || filePath;
    const hName = document.getElementById('status-host-name');
    if (hName) hName.textContent = 'Database Viewer';
    const sLat = document.getElementById('status-latency');
    if (sLat) sLat.textContent = 'SQLITE';
    const cBadge = document.getElementById('status-conn-badge');
    if (cBadge) cBadge.textContent = `(${displayDbName})`;
  } else if (view && (view.startsWith('docker-logs-') || view.startsWith('docker-exec-'))) {
    const pane = document.getElementById(`${view}-pane`);
    if (pane) {
      pane.classList.add('active');
      activeSessionId = `session-${view}`;
      const isLogs = view.startsWith('docker-logs-');
      const activeTab = document.querySelector(`.tab-card[data-view="${view}"]`);
      const hostId = activeTab?.getAttribute('data-host-id');
      const host = hostId ? (appConfig.hosts || []).find((h) => h.id === hostId) : null;
      const hName = document.getElementById('status-host-name');
      if (hName) hName.textContent = host ? host.name : 'Docker';
      const sLat = document.getElementById('status-latency');
      if (sLat) sLat.textContent = isLogs ? 'LOGS' : 'EXEC';
      const cBadge = document.getElementById('status-conn-badge');
      if (cBadge) cBadge.textContent = `(${view.slice(12)})`;
    }
  } else if (view && view.startsWith('wsl-')) {
    const pane = document.getElementById(`${view}-pane`);
    if (pane) {
      pane.classList.add('active');
      activeSessionId = `session-${view}`;
      const activeTab = document.querySelector(`.tab-card[data-view="${view}"]`);
      const distroTitle = activeTab?.querySelector('.tab-title')?.textContent?.replace(/^WSL:\s*/, '') || view.replace('wsl-', '');
      const hName = document.getElementById('status-host-name');
      if (hName) hName.textContent = `WSL: ${distroTitle}`;
      const sLat = document.getElementById('status-latency');
      if (sLat) sLat.textContent = 'WSL';
      const cBadge = document.getElementById('status-conn-badge');
      if (cBadge) cBadge.textContent = `(${distroTitle})`;
    }
  } else {
    const pane = document.getElementById(`${view}-pane`);
    if (pane) {
      pane.classList.add('active');
      activeSessionId = `session-${view}`;
    }
  }

  // Update Docker and Port scanner button state according to active tab view
  updateDockerButtonState(view);
  updatePortsButtonState(view);

  // Synchronize File Explorer (SFTP) with active tab view
  syncFileExplorerWithView(view);

  if (!appConfig.session) appConfig.session = {};
  appConfig.session.active_view = view;

  // Safely fit, force redraw of characters, and focus the active terminal session only
  if (activeSessionId && terminalSessions[activeSessionId]) {
    const sess = terminalSessions[activeSessionId];
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resizeSession(sess);
        try {
          sess.term.refresh(0, sess.term.rows - 1);
          sess.term.scrollToBottom();
        } catch (e) { }
        sess.term.focus();
      });
    });
  }

  // Update telemetry visibility and trigger remote fetch if connected host
  updateRemoteTelemetry();
}

document.getElementById('add-tab-btn').addEventListener('click', () => {
  const count = document.querySelectorAll('.tab-card').length + 1;
  const viewId = `local-${count}`;
  const newTab = document.createElement('div');
  newTab.className = 'tab-card';
  newTab.setAttribute('data-view', viewId);
  newTab.draggable = true;
  const shellName = typeof getShellDisplayName === 'function' ? getShellDisplayName(appConfig?.settings?.default_shell) : 'Shell';
  newTab.innerHTML = `
    <i class="fa">&#xf120;</i>
    <span class="tab-title">${escapeHtml(shellName)} ${count}</span>
    <span class="tab-close">✕</span>
  `;

  // Create corresponding pane
  const newPane = document.createElement('div');
  newPane.id = `${viewId}-pane`;
  newPane.className = 'view-pane';
  newPane.innerHTML = `<div id="terminal-container-${viewId}" class="xterm-view-wrapper"></div>`;
  document.getElementById('center-workspace').appendChild(newPane);

  document.getElementById('add-tab-btn').before(newTab);
  setupTabInteractivity();
  newTab.click();
});


// ── 8. Resizable Splitters (High Performance 60-240Hz Dragging) ──
function setupSplitters() {
  const leftResizer = document.getElementById('left-resizer');
  const leftDrawer = document.getElementById('left-drawer');

  let activeDrag = null; // 'left'
  let pendingWidth = null;
  let rafId = null;
  let resizeTimer = null;

  const scheduleTerminalResize = () => {
    if (!resizeTimer) {
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        resizeActiveTerminal();
      }, 50);
    }
  };

  const onMouseMove = (e) => {
    if (!activeDrag) return;
    if (activeDrag === 'left') {
      const newWidth = Math.max(160, Math.min(500, e.clientX - 48));
      pendingWidth = newWidth;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          if (leftDrawer && pendingWidth !== null) {
            leftDrawer.style.width = `${pendingWidth}px`;
          }
          rafId = null;
        });
      }
    }
    scheduleTerminalResize();
  };

  const onMouseUp = () => {
    if (!activeDrag) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (resizeTimer) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }

    let sizeChanged = false;
    if (activeDrag === 'left' && leftDrawer && pendingWidth !== null) {
      leftDrawer.style.width = `${pendingWidth}px`;
      if (!appConfig.settings) appConfig.settings = {};
      if (appConfig.settings.drawer_width !== pendingWidth) {
        appConfig.settings.drawer_width = pendingWidth;
        sizeChanged = true;
      }
    }

    if (sizeChanged) {
      persistConfig();
    }

    leftResizer?.classList.remove('dragging');
    document.body.classList.remove('is-resizing');

    activeDrag = null;
    pendingWidth = null;

    // Final layout sync
    setTimeout(() => {
      resizeAllTerminals();
    }, 15);
  };

  if (leftResizer && leftDrawer) {
    leftResizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      activeDrag = 'left';
      leftResizer.classList.add('dragging');
      document.body.classList.add('is-resizing');
    });
  }

  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('mouseup', onMouseUp);
}


// ── 13. Unified Desktop Context Menu (Terminal & SFTP Explorer) ──
let currentTargetSession = null;

function setupControlledContextMenu() {
  const termMenu = document.getElementById('terminal-context-menu');
  const sftpMenu = document.getElementById('sftp-context-menu');
  const colMenu = document.getElementById('sftp-col-context-menu');
  const hostMenu = document.getElementById('host-context-menu');

  const copyBtn = document.getElementById('ctx-menu-copy');
  const pasteBtn = document.getElementById('ctx-menu-paste');
  const selectAllBtn = document.getElementById('ctx-menu-select-all');
  const clearBtn = document.getElementById('ctx-menu-clear');

  const btnOpenBuiltIn = document.getElementById('sftp-ctx-open-built-in');
  const btnOpenExternal = document.getElementById('sftp-ctx-open-external');
  const btnOpenNative = document.getElementById('sftp-ctx-open-native');
  const lblNative = document.getElementById('sftp-ctx-native-label');
  const btnDownload = document.getElementById('sftp-ctx-download');
  const btnPaste = document.getElementById('sftp-ctx-paste');
  const btnCopyPath = document.getElementById('sftp-ctx-copy-path');
  const btnRefresh = document.getElementById('sftp-ctx-refresh');
  const btnDelete = document.getElementById('sftp-ctx-delete');
  const dividerDelete = document.getElementById('sftp-ctx-delete-divider');

  const hideAllContextMenus = () => {
    termMenu?.classList.add('hidden');
    sftpMenu?.classList.add('hidden');
    colMenu?.classList.add('hidden');
    hostMenu?.classList.add('hidden');
    currentTargetSession = null;
  };

  // 1. Single global right-click interceptor
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();

    const hostItem = e.target.closest('.host-item');
    if (hostItem && hostMenu) {
      hideAllContextMenus();
      const hostId = hostItem.getAttribute('data-id');
      const host = (appConfig.hosts || []).find((h) => h.id === hostId);
      if (host) {
        showHostContextMenu(e.clientX, e.clientY, host);
        return;
      }
    }

    const sftpHeader = e.target.closest('#sftp-col-header, #sftp-col-context-menu');
    const sftpSidebar = e.target.closest('#drawer-files, #sftp-context-menu, #sftp-file-list');
    const termWrapper = e.target.closest('.xterm-view-wrapper, .xterm, #terminal-context-menu');

    // ── Case 0: Right-Click on SFTP Column Header ──
    if (sftpHeader && colMenu) {
      hideAllContextMenus();
      const menuWidth = 180;
      const menuHeight = 220;
      let x = e.clientX;
      let y = e.clientY;
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
      colMenu.style.left = `${Math.max(8, x)}px`;
      colMenu.style.top = `${Math.max(8, y)}px`;
      colMenu.classList.remove('hidden');
      applyFileColumnVisibility();
      return;
    }

    // ── Case A: Right-Click inside SFTP File Explorer List ──
    if (sftpSidebar && sftpMenu) {
      termMenu?.classList.add('hidden');
      colMenu?.classList.add('hidden');

      const row = e.target.closest('.file-row');
      if (row && row.fileData) {
        document.querySelectorAll('#sftp-file-list .file-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        selectedSftpItem = {
          file: row.fileData,
          isRemote: sftpMode === 'remote',
          host: sftpCurrentHost,
        };
      } else {
        selectedSftpItem = null;
      }

      const isFile = selectedSftpItem && !selectedSftpItem.file.is_dir;
      const isDir = selectedSftpItem && selectedSftpItem.file.is_dir;
      const hasSelection = isFile || isDir;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.includes('Mac');
      if (lblNative) {
        if (isMac) {
          lblNative.textContent = isFile ? 'Reveal in Finder' : 'Open in Finder';
        } else {
          lblNative.textContent = isFile ? 'Reveal in File Explorer' : 'Open in File Explorer';
        }
      }

      if (btnOpenBuiltIn) btnOpenBuiltIn.style.display = isFile ? 'flex' : 'none';
      if (btnOpenExternal) btnOpenExternal.style.display = isFile ? 'flex' : 'none';
      if (btnOpenNative) btnOpenNative.style.display = (sftpMode === 'local' || (sftpMode === 'remote' && isFile)) ? 'flex' : 'none';
      if (btnDownload) btnDownload.style.display = (isFile && sftpMode === 'remote') ? 'flex' : 'none';
      if (btnCopyPath) btnCopyPath.style.display = hasSelection ? 'flex' : 'none';
      if (btnPaste) btnPaste.style.display = 'flex';
      if (btnRefresh) btnRefresh.style.display = 'flex';
      if (btnDelete) btnDelete.style.display = hasSelection ? 'flex' : 'none';
      if (dividerDelete) dividerDelete.style.display = hasSelection ? 'block' : 'none';

      sftpMenu.classList.remove('hidden');
      const menuWidth = sftpMenu.offsetWidth || 190;
      const menuHeight = sftpMenu.offsetHeight || 190;
      const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
      const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
      sftpMenu.style.left = `${Math.max(8, x)}px`;
      sftpMenu.style.top = `${Math.max(8, y)}px`;
      return;
    }

    // ── Case B: Right-Click inside Terminal Containers ──
    if (termWrapper && termMenu) {
      sftpMenu?.classList.add('hidden');

      let targetSess = null;
      for (const sess of Object.values(terminalSessions)) {
        const container = document.getElementById(sess.containerId);
        if (container && (container === termWrapper || container.contains(termWrapper))) {
          targetSess = sess;
          break;
        }
      }
      if (!targetSess) {
        const activeTab = document.querySelector('.tab-card.active');
        const view = activeTab?.getAttribute('data-view');
        if (view) {
          targetSess = terminalSessions[`session-${view}`] || terminalSessions[view];
        }
      }

      if (!targetSess) {
        hideAllContextMenus();
        return;
      }

      currentTargetSession = targetSess;
      const hasSelection = targetSess.term.hasSelection();
      copyBtn?.classList.toggle('disabled', !hasSelection);

      termMenu.classList.remove('hidden');
      const menuWidth = termMenu.offsetWidth || 180;
      const menuHeight = termMenu.offsetHeight || 135;
      const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8);
      const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8);
      termMenu.style.left = `${Math.max(8, x)}px`;
      termMenu.style.top = `${Math.max(8, y)}px`;
      return;
    }

    // ── Case C: Anywhere else ──
    hideAllContextMenus();
  });

  // Terminal Menu Item Actions
  copyBtn?.addEventListener('click', () => {
    if (currentTargetSession && currentTargetSession.term.hasSelection()) {
      const text = currentTargetSession.term.getSelection();
      setSystemClipboardText(text);
    }
    hideAllContextMenus();
  });

  pasteBtn?.addEventListener('click', () => {
    if (currentTargetSession) {
      const sess = currentTargetSession;
      getSystemClipboardText().then((text) => {
        if (text) {
          invoke('pty_write', { sessionId: sess.sessionId, data: text }).catch(console.error);
        }
      }).catch(console.error);
    }
    hideAllContextMenus();
  });

  selectAllBtn?.addEventListener('click', () => {
    if (currentTargetSession) {
      currentTargetSession.term.selectAll();
    }
    hideAllContextMenus();
  });

  clearBtn?.addEventListener('click', () => {
    if (currentTargetSession) {
      currentTargetSession.term.clear();
    }
    hideAllContextMenus();
  });

  // SFTP Menu Item Actions
  btnOpenBuiltIn?.addEventListener('click', () => {
    if (selectedSftpItem && !selectedSftpItem.file.is_dir) {
      if (selectedSftpItem.file.is_db) {
        openDbTab(selectedSftpItem.file.name, selectedSftpItem.file.path, selectedSftpItem.isRemote, selectedSftpItem.host);
      } else {
        openEditorTab(selectedSftpItem.file.name, selectedSftpItem.file.path, selectedSftpItem.isRemote, selectedSftpItem.host);
      }
    }
    hideAllContextMenus();
  });

  btnOpenExternal?.addEventListener('click', async () => {
    if (selectedSftpItem && !selectedSftpItem.file.is_dir) {
      const item = selectedSftpItem;
      hideAllContextMenus();
      await openFileInExternalEditor(item.file, item.isRemote, item.host);
    } else {
      hideAllContextMenus();
    }
  });

  btnOpenNative?.addEventListener('click', async () => {
    hideAllContextMenus();
    if (selectedSftpItem) {
      const item = selectedSftpItem;
      await openInNativeExplorer(item.file, item.isRemote, item.host);
    } else {
      const currentDir = sftpMode === 'local' ? (sftpLocalPath || sftpCurrentPath) : sftpCurrentPath;
      if (sftpMode === 'local' && currentDir) {
        await openInNativeExplorer({ name: currentDir, path: currentDir, is_dir: true }, false, null);
      } else {
        showToast('Remote SSH directories cannot be opened in native File Explorer.', 'info');
      }
    }
  });

  btnDownload?.addEventListener('click', async () => {
    if (selectedSftpItem && selectedSftpItem.isRemote) {
      const item = selectedSftpItem;
      hideAllContextMenus();
      await downloadRemoteFile(item.file, item.host);
    } else {
      hideAllContextMenus();
    }
  });

  btnCopyPath?.addEventListener('click', () => {
    if (selectedSftpItem) {
      setSystemClipboardText(selectedSftpItem.file.path).then(() => {
        showToast(`Copied path: ${selectedSftpItem.file.path}`, 'info');
      }).catch(console.error);
    }
    hideAllContextMenus();
  });

  btnPaste?.addEventListener('click', async () => {
    const targetDir = selectedSftpItem && selectedSftpItem.file.is_dir ? selectedSftpItem.file.path : sftpCurrentPath;
    hideAllContextMenus();
    await pasteClipboardFiles(targetDir);
  });

  btnRefresh?.addEventListener('click', () => {
    hideAllContextMenus();
    const target = getActiveTargetInfo();
    if (target.isRemote && target.host) {
      loadRemoteFiles(target.host, sftpCurrentPath);
    } else if (target.isWsl && target.distro) {
      const uncPath = (sftpCurrentPath && sftpCurrentPath.startsWith(`\\\\wsl.localhost\\${target.distro}`))
        ? sftpCurrentPath
        : `\\\\wsl.localhost\\${target.distro}`;
      loadLocalFiles(uncPath);
    } else {
      const localPath = (typeof sftpTrueLocalPath !== 'undefined' && sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
        ? sftpTrueLocalPath
        : (typeof sftpLocalPath !== 'undefined' && sftpLocalPath && !sftpLocalPath.startsWith('\\\\wsl') && !sftpLocalPath.startsWith('/') ? sftpLocalPath : '.');
      loadLocalFiles(localPath);
    }
  });

  btnDelete?.addEventListener('click', async () => {
    if (selectedSftpItem) {
      const item = selectedSftpItem;
      hideAllContextMenus();
      await deleteSftpItem(item);
    } else {
      hideAllContextMenus();
    }
  });

  // Hide on outside left-click or Escape key (no blur listener)
  window.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      const inTerm = termMenu && termMenu.contains(e.target);
      const inSftp = sftpMenu && sftpMenu.contains(e.target);
      const inCol = colMenu && colMenu.contains(e.target);
      if (!inTerm && !inSftp && !inCol) {
        hideAllContextMenus();
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideAllContextMenus();
    }
  });

  window.addEventListener('resize', hideAllContextMenus);
}
