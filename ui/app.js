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
        invoke('log_webview_event', { level: 'ERROR', source: 'webview', message: msg }).catch(() => {});
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
        invoke('log_webview_event', { level: 'WARN', source: 'webview', message: msg }).catch(() => {});
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
        invoke('log_webview_event', { level: 'ERROR', source: 'webview', message: msg }).catch(() => {});
      }
    } catch (_) {}
  });

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event.reason;
      const msg = `Unhandled Rejection: ${reason ? (reason.stack || reason.message || String(reason)) : 'Unknown'}`;
      if (window.__TAURI__?.core) {
        invoke('log_webview_event', { level: 'ERROR', source: 'webview', message: msg }).catch(() => {});
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

// ── 2. Terminal Engine (xterm.js + ConPTY Channel Streaming) ──
const terminalSessions = {};

const THEMES = {
  one_dark: {
    background: '#191b20',
    foreground: '#abb2bf',
    cursor: '#61afef',
    cursorAccent: '#191b20',
    selectionBackground: '#3e4451',
    black: '#1e2127',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#ffffff',
  },
  tokyo_night: {
    background: '#1a1b26',
    foreground: '#a9b1d6',
    cursor: '#7aa2f7',
    cursorAccent: '#1a1b26',
    selectionBackground: '#33467c',
    black: '#32344a',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#c0caf5',
    brightBlack: '#444b6a',
    brightRed: '#ff7a93',
    brightGreen: '#b9f27c',
    brightYellow: '#ff9e64',
    brightBlue: '#7da6ff',
    brightMagenta: '#bb9af7',
    brightCyan: '#0db9d7',
    brightWhite: '#acb0d0',
  },
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#bd93f9',
    cursorAccent: '#282a36',
    selectionBackground: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  catppuccin: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#89b4fa',
    cursorAccent: '#1e1e2e',
    selectionBackground: '#585b70',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  nord: {
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#88c0d0',
    cursorAccent: '#2e3440',
    selectionBackground: '#434c5e',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#eceff4',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },
  monokai_pro: {
    background: '#2d2a2e',
    foreground: '#fcfcfa',
    cursor: '#ffd866',
    cursorAccent: '#2d2a2e',
    selectionBackground: '#403e41',
    black: '#221f22',
    red: '#ff6188',
    green: '#a9dc76',
    yellow: '#ffd866',
    blue: '#fc9867',
    magenta: '#ab9df2',
    cyan: '#78dce8',
    white: '#fcfcfa',
    brightBlack: '#727072',
    brightRed: '#ff6188',
    brightGreen: '#a9dc76',
    brightYellow: '#ffd866',
    brightBlue: '#fc9867',
    brightMagenta: '#ab9df2',
    brightCyan: '#78dce8',
    brightWhite: '#ffffff',
  },
  solarized_dark: {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  gruvbox_dark: {
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    cursorAccent: '#282828',
    selectionBackground: '#3c3836',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2',
  },
  synthwave: {
    background: '#262335',
    foreground: '#f92aad',
    cursor: '#36f9f6',
    cursorAccent: '#262335',
    selectionBackground: '#495495',
    black: '#262335',
    red: '#fe4450',
    green: '#72f1b8',
    yellow: '#fede5d',
    blue: '#03edf9',
    magenta: '#ff7edb',
    cyan: '#03edf9',
    white: '#ffffff',
    brightBlack: '#614d85',
    brightRed: '#fe4450',
    brightGreen: '#72f1b8',
    brightYellow: '#fede5d',
    brightBlue: '#03edf9',
    brightMagenta: '#ff7edb',
    brightCyan: '#03edf9',
    brightWhite: '#ffffff',
  },
  alacritty_dark: {
    background: '#181818',
    foreground: '#d8d8d8',
    cursor: '#d8d8d8',
    cursorAccent: '#181818',
    selectionBackground: '#383838',
    black: '#181818',
    red: '#ab4642',
    green: '#a1b56c',
    yellow: '#f7ca88',
    blue: '#7cafc2',
    magenta: '#ba8baf',
    cyan: '#86c1b9',
    white: '#f8f8f8',
    brightBlack: '#585858',
    brightRed: '#ab4642',
    brightGreen: '#a1b56c',
    brightYellow: '#f7ca88',
    brightBlue: '#7cafc2',
    brightMagenta: '#ba8baf',
    brightCyan: '#86c1b9',
    brightWhite: '#ffffff',
  },
};

function getXtermTheme(themeName) {
  return THEMES[themeName] || THEMES.one_dark;
}

function initTerminalSession(sessionId, containerId, shellType = 'powershell', options = {}) {
  if (terminalSessions[sessionId]) {
    const sess = terminalSessions[sessionId];
    resizeSession(sess);
    sess.term.focus();
    return sess;
  }

  const container = document.getElementById(containerId);
  if (!container || !window.Terminal) return null;

  container.innerHTML = '';

  const currentTheme = appConfig.settings.terminal_theme || appConfig.settings.theme || 'one_dark';
  const term = new window.Terminal({
    theme: getXtermTheme(currentTheme),
    fontFamily: appConfig.settings.font_family || 'Cascadia Code',
    fontSize: parseInt(appConfig.settings.font_size) || 14,
    lineHeight: 1.3,
    cursorBlink: false,
    cursorStyle: appConfig.settings.cursor_style || 'block',
    allowTransparency: true,
    convertEol: true,
    scrollback: parseInt(appConfig.settings.scrollback) || 10000,
  });

  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  setTimeout(() => {
    resizeSession({ term, fitAddon, containerId });
    term.focus();
  }, 60);

  // Buffer and auto-password detection
  let autoPassword = options.autoPassword || null;
  let autoPasswordAttempts = 1;
  let recentOutputBuffer = '';

  const stripAnsi = (str) =>
    str
      .replace(/\x1B\][^\x07\x1B]*?(?:\x07|\x1B\\)/g, '')
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B[@-Z\\-_]/g, '')
      .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');

  // Tauri v2 Streaming Channel: directly receives ConPTY output
  const onData = new Channel();
  onData.onmessage = (chunk) => {
    term.write(chunk);

    // Auto-respond to password prompt if password was provided in host config
    if (autoPassword && autoPasswordAttempts > 0) {
      recentOutputBuffer += chunk;
      if (recentOutputBuffer.length > 500) {
        recentOutputBuffer = recentOutputBuffer.slice(-500);
      }
      const clean = stripAnsi(recentOutputBuffer).trim();
      if (/(?:password|passphrase|kennwort|mot de passe|contrase[ñn]a|пароль)[^:\r\n]{0,50}:\s*$/i.test(clean)) {
        autoPasswordAttempts--;
        const pw = autoPassword;
        autoPassword = null; // consume
        setTimeout(() => {
          invoke('pty_write', { sessionId: sessionId, data: pw + '\r' }).catch(console.error);
        }, 120);
      }
    }
  };

  // Pipe user input to backend PTY
  term.onData((data) => {
    invoke('pty_write', { sessionId: sessionId, data: data }).catch(console.error);
  });

  // Handle resize events: debounced trailing-edge to eliminate flicker during minimize/maximize
  let lastCols = term.cols || 80;
  let lastRows = term.rows || 24;
  let resizeDebounceTimer = null;
  term.onResize((size) => {
    if (size.cols === lastCols && size.rows === lastRows) return;
    if (size.cols < 10 || size.rows < 4) return;
    lastCols = size.cols;
    lastRows = size.rows;
    if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(() => {
      invoke('pty_resize', { sessionId: sessionId, cols: size.cols, rows: size.rows }).catch(console.error);
    }, 60);
  });

  // Spawn backend PTY
  invoke('pty_spawn', {
    sessionId: sessionId,
    shellType: shellType,
    cols: term.cols || 80,
    rows: term.rows || 24,
    onData: onData,
  }).catch((err) => {
    console.error('pty_spawn error:', err);
    term.write(`\r\n\x1b[31m[Error launching session: ${err}]\x1b[0m\r\n`);
  });

  // Intercept Ctrl+C (copy when selected) and Ctrl+V / Ctrl+Shift+V (paste)
  term.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown') {
      // Ctrl+C with text selected -> Copy to clipboard
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'c' && term.hasSelection()) {
        setSystemClipboardText(term.getSelection());
        return false;
      }
      // Ctrl+Shift+C -> Copy to clipboard
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        if (term.hasSelection()) {
          setSystemClipboardText(term.getSelection());
        }
        return false;
      }
      // Ctrl+V or Ctrl+Shift+V -> Paste from clipboard (Instant native OS paste, no permission prompt)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        getSystemClipboardText().then((text) => {
          if (text) {
            invoke('pty_write', { sessionId: sessionId, data: text }).catch(console.error);
          }
        }).catch(console.error);
        return false;
      }
      // Ctrl+R -> Prevent app reload / restart!
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        const leftDrawer = document.getElementById('left-drawer');
        const isDrawerOpen = leftDrawer && !leftDrawer.classList.contains('collapsed');
        if (isDrawerOpen && typeof triggerCurrentMenuRefresh === 'function' && triggerCurrentMenuRefresh()) {
          return false;
        }
        // If drawer is closed or not refreshable, send Ctrl+R (\x12) to PTY for shell reverse-i-search
        invoke('pty_write', { sessionId: sessionId, data: '\x12' }).catch(console.error);
        return false;
      }
      // F5 -> Prevent app reload / restart!
      if (e.key === 'F5') {
        if (typeof triggerCurrentMenuRefresh === 'function') {
          triggerCurrentMenuRefresh();
        }
        return false;
      }
    }
    return true;
  });

  // Focus terminal when container is clicked
  container.addEventListener('click', () => {
    term.focus();
  });

  terminalSessions[sessionId] = { sessionId, term, fitAddon, containerId, shellType, options };
  return terminalSessions[sessionId];
}

function resizeSession(sess) {
  if (!sess) return;
  const container = document.getElementById(sess.containerId);
  if (!container || container.offsetParent === null || container.clientWidth < 50 || container.clientHeight < 50) {
    return; // Container is hidden or zero-sized; do not fit to prevent corrupting buffer
  }
  try {
    sess.fitAddon.fit();
  } catch (e) { }
}

function resizeAllTerminals() {
  Object.values(terminalSessions).forEach(resizeSession);
}

function resizeActiveTerminal() {
  const activeTab = document.querySelector('.tab-card.active');
  const view = activeTab?.getAttribute('data-view');
  let sessId = 'session-local';
  if (view && (view.startsWith('host-') || view.startsWith('local-'))) {
    sessId = `session-${view}`;
  }
  if (terminalSessions[sessId]) {
    resizeSession(terminalSessions[sessId]);
  }
}

// ── 3. Theme, Font & Size Management ──
function applyAppTheme(themeName) {
  if (!THEMES[themeName]) themeName = 'one_dark';
  document.body.setAttribute('data-theme', themeName);
  appConfig.settings.app_theme = themeName;
  appConfig.settings.theme = themeName; // Maintain legacy compat

  const themeSelect = document.getElementById('setting-theme');
  if (themeSelect) themeSelect.value = themeName;
}

function applyTerminalTheme(themeName) {
  if (!THEMES[themeName]) themeName = 'one_dark';
  appConfig.settings.terminal_theme = themeName;

  const termThemeSelect = document.getElementById('setting-terminal-theme');
  if (termThemeSelect) termThemeSelect.value = themeName;

  // Apply to all open xterm instances (both remote hosts and local shells)
  const xtermTheme = getXtermTheme(themeName);
  Object.values(terminalSessions).forEach((sess) => {
    if (sess && sess.term) {
      sess.term.options.theme = xtermTheme;
    }
  });
}

function applyTheme(themeName) {
  applyAppTheme(themeName);
}

function applyFont(fontFamily) {
  appConfig.settings.font_family = fontFamily;
  document.documentElement.style.setProperty('--font-main', `'${fontFamily}', monospace`);

  const select = document.getElementById('setting-font-family');
  if (select) select.value = fontFamily;

  Object.values(terminalSessions).forEach((sess) => {
    sess.term.options.fontFamily = fontFamily;
    resizeSession(sess);
  });
}

function applyAppFontSize(size) {
  const s = parseInt(size) || 13;
  appConfig.settings.app_font_size = s;
  document.documentElement.style.setProperty('--app-font-size', `${s}px`);

  const select = document.getElementById('setting-app-font-size');
  if (select) select.value = s;
}

function applyTerminalFontSize(size) {
  const s = parseInt(size) || 14;
  appConfig.settings.font_size = s;

  const select = document.getElementById('setting-terminal-font-size');
  if (select) select.value = s;

  Object.values(terminalSessions).forEach((sess) => {
    sess.term.options.fontSize = s;
    resizeSession(sess);
  });
}

function applyCursorStyle(style) {
  appConfig.settings.cursor_style = style || 'block';
  const select = document.getElementById('setting-cursor-style');
  if (select) select.value = appConfig.settings.cursor_style;

  Object.values(terminalSessions).forEach((sess) => {
    if (sess?.term) {
      sess.term.options.cursorStyle = appConfig.settings.cursor_style;
    }
  });
}

function applyScrollback(lines) {
  const s = Math.max(100, Math.min(100000, parseInt(lines) || 10000));
  appConfig.settings.scrollback = s;
  const input = document.getElementById('setting-scrollback');
  if (input) input.value = s;

  Object.values(terminalSessions).forEach((sess) => {
    if (sess?.term) {
      sess.term.options.scrollback = s;
    }
  });
}

// ── 4. Portable Config & Drawer Loading ──
async function loadConfig() {
  try {
    const cfg = await invoke('get_config');
    if (cfg && cfg.settings) {
      appConfig = cfg;
      isConfigLoaded = true;

      if (cfg.settings.custom_themes && typeof cfg.settings.custom_themes === 'object') {
        const termThemeSelect = document.getElementById('setting-terminal-theme');
        for (const [key, val] of Object.entries(cfg.settings.custom_themes)) {
          if (val && val.theme) {
            THEMES[key] = val.theme;
            if (termThemeSelect && !termThemeSelect.querySelector(`option[value="${key}"]`)) {
              const opt = document.createElement('option');
              opt.value = key;
              opt.textContent = `Custom: ${val.name || key}`;
              termThemeSelect.appendChild(opt);
            }
          }
        }
      }

      applyAppTheme(cfg.settings.app_theme || cfg.settings.theme || 'one_dark');
      applyTerminalTheme(cfg.settings.terminal_theme || cfg.settings.theme || 'one_dark');
      applyFont(cfg.settings.font_family || 'Cascadia Code');
      applyAppFontSize(cfg.settings.app_font_size || 13);
      applyTerminalFontSize(cfg.settings.font_size || 14);
      applyCursorStyle(cfg.settings.cursor_style || 'block');
      applyScrollback(cfg.settings.scrollback || 10000);
      if (document.getElementById('setting-default-shell')) {
        document.getElementById('setting-default-shell').value = cfg.settings.default_shell || 'powershell';
      }
      if (document.getElementById('setting-external-editor') && cfg.settings.external_editor) {
        document.getElementById('setting-external-editor').value = cfg.settings.external_editor;
      }
      if (document.getElementById('setting-docker-port')) {
        document.getElementById('setting-docker-port').value = cfg.settings.docker_port || 2375;
      }
      if (document.getElementById('setting-enable-ssh-compression')) {
        document.getElementById('setting-enable-ssh-compression').checked = cfg.settings.enable_ssh_compression === true;
      }
      if (document.getElementById('setting-enable-app-logs')) {
        const logsEnabled = cfg.settings.enable_app_logs === true;
        document.getElementById('setting-enable-app-logs').checked = logsEnabled;
        const railBtnLogs = document.getElementById('rail-btn-logs');
        if (railBtnLogs) railBtnLogs.style.display = logsEnabled ? 'flex' : 'none';
      }
      // Restore saved section & column sizes from config
      if (cfg.settings.drawer_width) {
        const leftDrawer = document.getElementById('left-drawer');
        if (leftDrawer) leftDrawer.style.width = `${cfg.settings.drawer_width}px`;
      }

      // Restore session & rail settings from config.toml
      if (cfg.session) {
        if (typeof cfg.session.show_host_ip === 'boolean') {
          showHostIp = cfg.session.show_host_ip;
          const ipToggle = document.getElementById('toggle-host-ip');
          if (ipToggle) ipToggle.checked = showHostIp;
        }
        if (Array.isArray(cfg.session.rail_order) && cfg.session.rail_order.length > 0) {
          restoreRailOrder(cfg.session.rail_order);
        }
      }

      // Restore File Explorer settings & columns from config.toml
      if (cfg.file_explorer) {
        fileColConfig.date = cfg.file_explorer.col_date !== false;
        fileColConfig.size = cfg.file_explorer.col_size !== false;
        fileColConfig.type = cfg.file_explorer.col_type === true;
        fileColConfig.perms = cfg.file_explorer.col_perms === true;

        const drawerFiles = document.getElementById('drawer-files') || document.getElementById('left-drawer');
        if (drawerFiles) {
          if (cfg.file_explorer.width_date) drawerFiles.style.setProperty('--col-date-w', `${cfg.file_explorer.width_date}px`);
          if (cfg.file_explorer.width_size) drawerFiles.style.setProperty('--col-size-w', `${cfg.file_explorer.width_size}px`);
          if (cfg.file_explorer.width_type) drawerFiles.style.setProperty('--col-type-w', `${cfg.file_explorer.width_type}px`);
          if (cfg.file_explorer.width_perms) drawerFiles.style.setProperty('--col-perms-w', `${cfg.file_explorer.width_perms}px`);
        }
        applyFileColumnVisibility();
      } else {
        const drawerFiles = document.getElementById('drawer-files');
        if (drawerFiles) {
          if (cfg.settings.sftp_col_date_width) {
            drawerFiles.style.setProperty('--col-date-w', `${cfg.settings.sftp_col_date_width}px`);
          }
          if (cfg.settings.sftp_col_size_width) {
            drawerFiles.style.setProperty('--col-size-w', `${cfg.settings.sftp_col_size_width}px`);
          }
        }
      }

      renderHostsList(cfg.hosts || []);
      resizeAllTerminals();
    }
  } catch (e) {
    console.error('Failed to load config.toml:', e);
  }
}

let hostSearchText = '';
let showHostIp = false; // Loaded from config.toml
window.hostAliveMap = {};
let isCheckingHosts = false;

function isHostActive(h) {
  if (!h) return false;
  // 1. Check open tabs
  const tab = document.querySelector(`.tab-card[data-view="host-${h.id}"]`);
  if (tab) return true;
  // 2. Check terminal sessions
  if (typeof terminalSessions !== 'undefined' && terminalSessions[`session-host-${h.id}`]) return true;
  // 3. Check active tunnels for this host
  if (window.activeHostTunnels && (window.activeHostTunnels[h.id] || window.activeHostTunnels[h.host])) {
    return true;
  }
  return false;
}

function isHostAlive(h) {
  if (!h) return false;
  if (window.hostAliveMap && typeof window.hostAliveMap[h.id] === 'boolean') {
    return window.hostAliveMap[h.id];
  }
  return isHostActive(h);
}

function updateHostStatusDots() {
  document.querySelectorAll('.host-item').forEach((item) => {
    const hostId = item.getAttribute('data-id');
    const hostObj = (appConfig.hosts || []).find((h) => h.id === hostId);
    if (!hostObj) return;
    const active = isHostActive(hostObj);
    if (active) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
    const dot = item.querySelector('.online-dot');
    if (dot) {
      dot.className = active ? 'online-dot active' : 'online-dot';
      dot.title = active ? 'Connected / Active session' : 'Inactive (No open connections)';
    }
  });
}

function updateTabStatusDots() {
  document.querySelectorAll('.tab-card[data-view^="host-"]').forEach((tab) => {
    const viewId = tab.getAttribute('data-view');
    const hostId = viewId.replace('host-', '');
    const hostObj = (appConfig.hosts || []).find((h) => h.id === hostId);
    if (!hostObj) return;
    const dot = tab.querySelector('.online-dot');
    if (dot) {
      const alive = isHostAlive(hostObj);
      dot.className = alive ? 'online-dot active' : 'online-dot';
      dot.title = alive ? `${hostObj.name} online` : `${hostObj.name} unreachable`;
    }
  });
}

async function pollHostsAlive() {
  if (isCheckingHosts) return;
  const hosts = appConfig.hosts || [];
  if (hosts.length === 0) return;
  isCheckingHosts = true;
  try {
    const reqs = hosts.map((h) => ({
      id: h.id,
      host: h.host,
      port: h.port || 22,
    }));
    const aliveResults = await invoke('check_hosts_alive', { hosts: reqs });
    if (aliveResults && typeof aliveResults === 'object') {
      window.hostAliveMap = Object.assign(window.hostAliveMap, aliveResults);
      updateHostStatusDots();
      updateTabStatusDots();
    }
  } catch (e) {
    // Gracefully handle network check failure
  } finally {
    isCheckingHosts = false;
  }
}

function getHostIconHtml(iconStr, extraStyle = '') {
  const styleAttr = extraStyle ? `style="${extraStyle}"` : '';
  const defaultSvg = `<svg class="host-icon-svg" ${styleAttr} viewBox="0 0 512 512"><path fill="currentColor" d="M64 32C28.7 32 0 60.7 0 96l0 64c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-64c0-35.3-28.7-64-64-64L64 32zm280 72a24 24 0 1 1 0 48 24 24 0 1 1 0-48zm48 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0zM64 288c-35.3 0-64 28.7-64 64l0 64c0 35.3 28.7 64 64 64l384 0c35.3 0 64-28.7 64-64l0-64c0-35.3-28.7-64-64-64L64 288zm280 72a24 24 0 1 1 0 48 24 24 0 1 1 0-48zm48 24a24 24 0 1 1 48 0 24 24 0 1 1 -48 0z"/></svg>`;

  if (!iconStr) {
    return defaultSvg;
  }

  // Normalize iconStr (strip 'icons/' and '.svg' if present)
  let cleanId = iconStr.trim();
  if (cleanId.startsWith('icons/')) cleanId = cleanId.slice(6);
  if (cleanId.endsWith('.svg')) cleanId = cleanId.slice(0, -4);

  // Handle legacy unicode glyph \uf233 or &#xf233; for server icon
  if (cleanId === '' || cleanId === '&#xf233;' || (cleanId.length === 1 && cleanId.charCodeAt(0) === 0xf233)) {
    cleanId = 'server';
  }

  // Look up in window.ALL_ICONS
  const item = (window.ALL_ICONS || []).find((i) => i.id.toLowerCase() === cleanId.toLowerCase() || i.id.toLowerCase() === iconStr.toLowerCase());
  if (item && item.d) {
    const w = item.w || 24;
    const h = item.h || 24;
    return `<svg class="host-icon-svg" ${styleAttr} viewBox="0 0 ${w} ${h}"><path fill="currentColor" d="${item.d}"/></svg>`;
  }

  // If starts with icons/ or ends with .svg, render img with fallback
  if (iconStr.endsWith('.svg') || iconStr.startsWith('icons/')) {
    return `<img src="${iconStr}" class="host-icon-svg" ${styleAttr} onerror="this.outerHTML='${defaultSvg.replace(/'/g, "\\'")}'" alt="" />`;
  }

  // Legacy font glyph
  if (iconStr.startsWith('&#') || iconStr.length === 1) {
    return `<i class="fa" style="color: var(--text-muted); ${extraStyle}">${iconStr}</i>`;
  }

  return defaultSvg;
}

function renderHostsList(hosts) {
  const container = document.getElementById('drawer-items');
  if (!container) return;
  container.innerHTML = '';

  // Wire IP display toggle once
  const ipToggle = document.getElementById('toggle-host-ip');
  if (ipToggle && !ipToggle.dataset.bound) {
    ipToggle.dataset.bound = 'true';
    ipToggle.checked = showHostIp;
    ipToggle.addEventListener('change', (e) => {
      showHostIp = e.target.checked;
      if (!appConfig.session) appConfig.session = {};
      appConfig.session.show_host_ip = showHostIp;
      persistConfig(true);
      renderHostsList(appConfig.hosts || []);
    });
  }

  const allHosts = hosts || appConfig.hosts || [];
  const filtered = allHosts.filter((h) => {
    if (!hostSearchText) return true;
    const nameMatch = h.name?.toLowerCase().includes(hostSearchText);
    const hostMatch = h.host?.toLowerCase().includes(hostSearchText);
    const userMatch = h.user?.toLowerCase().includes(hostSearchText);
    return nameMatch || hostMatch || userMatch;
  });

  // Ensure search input is wired for live host filtering
  const searchInput = document.getElementById('drawer-search-input');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    searchInput.addEventListener('input', (e) => {
      hostSearchText = e.target.value.toLowerCase().trim();
      renderHostsList(appConfig.hosts || []);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding: 16px 12px; color: var(--text-subtle); text-align: center;">${allHosts.length === 0 ? 'No hosts configured.<br><span style="color: var(--accent); cursor: pointer;" onclick="document.getElementById(\'btn-open-add-host\').click();">+ Add Host</span>' : 'No matching hosts found.'}</div>`;
    return;
  }

  filtered.forEach((h) => {
    const item = document.createElement('div');
    item.setAttribute('data-id', h.id);
    const active = isHostActive(h);
    item.className = active ? 'host-item active' : 'host-item';
    const isCloud = h.cloud_provider && h.cloud_provider !== 'none';
    const iconHtml = isCloud ? '<i class="fa" style="color: #61afef;">&#xf0c2;</i>' : getHostIconHtml(h.icon);
    const cloudPillHtml = isCloud ? `<span class="host-cloud-pill ${h.cloud_provider}">${escapeHtml(h.cloud_provider.toUpperCase())}</span>` : '';
    const dotClass = active ? 'online-dot active' : 'online-dot';
    const dotTitle = active ? 'Connected / Active session' : 'Inactive (No open connections)';
    
    let connText = h.host;
    if (h.cloud_provider === 'gcp') {
      connText = `gcp:${h.cloud_project_id || 'project'}/${h.cloud_instance_id || 'vm'}`;
    } else if (h.cloud_provider === 'aws') {
      connText = `aws:${h.cloud_zone || 'region'}/${h.cloud_instance_id || 'instance'}`;
    } else if (h.cloud_provider === 'azure') {
      connText = `azure:${h.cloud_zone || 'rg'}/${h.cloud_instance_id || 'vm'}`;
    }
    const ipHtml = (showHostIp && connText) ? `<span class="host-ip">${escapeHtml(connText)}</span>` : '';
    const wolBtnHtml = h.mac_address ? `<span class="host-wol-btn" title="Wake on LAN (${escapeHtml(h.mac_address)})"><i class="fa">&#xf0e7;</i></span>` : '';

    let routePillHtml = '';
    if (h.network_route && h.network_route !== 'direct' && h.network_route !== 'none') {
      if (h.network_route.startsWith('wireguard:')) {
        routePillHtml = `<span class="host-cloud-pill" style="background: rgba(152,195,121,0.15); color: #98c379; border: 1px solid rgba(152,195,121,0.3);"><i class="fa" style="font-size: 8px;">&#xf3ed;</i> WG</span>`;
      } else if (h.network_route === 'tailscale') {
        routePillHtml = `<span class="host-cloud-pill" style="background: rgba(97,175,239,0.15); color: #61afef; border: 1px solid rgba(97,175,239,0.3);"><i class="fa" style="font-size: 8px;">&#xf0ac;</i> TS</span>`;
      } else if (h.network_route === 'netbird') {
        routePillHtml = `<span class="host-cloud-pill" style="background: rgba(229,192,123,0.15); color: #e5c07b; border: 1px solid rgba(229,192,123,0.3);"><i class="fa" style="font-size: 8px;">&#xf012;</i> NB</span>`;
      } else if (h.network_route === 'mesh') {
        routePillHtml = `<span class="host-cloud-pill" style="background: rgba(152,195,121,0.15); color: #98c379; border: 1px solid rgba(152,195,121,0.3);"><i class="fa" style="font-size: 8px;">&#xf3ed;</i> MESH</span>`;
      }
    }

    item.innerHTML = `
      <span class="${dotClass}" title="${dotTitle}"></span>
      <div class="host-icon-box">${iconHtml}</div>
      <span class="host-name" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}${cloudPillHtml}${routePillHtml}</span>
      ${ipHtml}
      <div class="host-actions">
        ${wolBtnHtml}
        <span class="host-edit-btn" title="Edit host"><i class="fa">&#xf044;</i></span>
        <span class="host-del-btn" title="Delete host">✕</span>
      </div>
    `;

    item.title = 'Click to select, double-click to connect';

    // Select host on single click
    item.addEventListener('click', (e) => {
      if (e.target.closest('.host-actions')) return;
      document.querySelectorAll('.host-item').forEach((i) => i.classList.remove('selected'));
      item.classList.add('selected');
    });

    // Connect to host on double click
    item.addEventListener('dblclick', (e) => {
      if (e.target.closest('.host-actions')) return;
      document.querySelectorAll('.host-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      item.classList.add('selected');
      connectToHost(h);
    });

    // Wake on LAN action
    const wolBtn = item.querySelector('.host-wol-btn');
    if (wolBtn) {
      wolBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sendWolPacket(h.mac_address, h.name);
      });
    }

    // Edit host
    const editBtn = item.querySelector('.host-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.openEditHostModal) {
          window.openEditHostModal(h);
        }
      });
    }

    // Delete host
    const delBtn = item.querySelector('.host-del-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete host "${h.name}"?`)) {
          try {
            const updated = await invoke('delete_host', { id: h.id });
            if (updated) {
              appConfig = updated;
              renderHostsList(updated.hosts);
            }
          } catch (err) {
            console.error('Failed to delete host:', err);
          }
        }
      });
    }

    container.appendChild(item);
  });
}

// ── Connect to Remote Host in Dedicated Closable Tab ──
async function connectToHost(h) {
  const viewId = `host-${h.id}`;
  const sessionId = `session-host-${h.id}`;

  let targetHost = h.host;
  let targetPort = h.port || 22;

  // If host is routed through active Mesh or VPN
  if (h.network_route === 'mesh' || (h.network_route && h.network_route !== 'direct' && h.network_route !== 'none')) {
    try {
      showToast(`Routing via active Mesh/VPN to ${h.host}...`, 'info');
      const ep = await invoke('get_mesh_tunnel_endpoint', {
        hostId: h.id,
        targetHostOverride: h.host,
        targetPortOverride: h.port || 22,
      });
      if (ep && ep.port) {
        targetHost = ep.host;
        targetPort = ep.port;
        showToast(`Tunnel active via ${ep.route_type} on ${targetHost}:${targetPort}`, 'success');
      }
    } catch (err) {
      console.error('Mesh routing error:', err);
      showToast(`Mesh routing failed: ${err}`, 'error');
      return;
    }
  } else if (h.cloud_provider && h.cloud_provider !== 'none') {
    try {
      showToast(`Connecting via ${h.cloud_provider.toUpperCase()} Cloud Tunnel...`, 'info');
      const tunnelPort = await invoke('get_cloud_tunnel_endpoint', { hostId: h.id });
      targetHost = '127.0.0.1';
      targetPort = tunnelPort;
      showToast(`${h.cloud_provider.toUpperCase()} tunnel active on 127.0.0.1:${tunnelPort}`, 'success');
    } catch (err) {
      showToast(`Cloud tunnel failed: ${err}`, 'error');
      return;
    }
  }

  // Update status bar
  const hostNameEl = document.getElementById('status-host-name');
  if (hostNameEl) hostNameEl.textContent = h.name;
  const latEl = document.getElementById('status-latency');
  if (latEl) latEl.textContent = (h.cloud_provider && h.cloud_provider !== 'none') ? h.cloud_provider.toUpperCase() : 'SSH';
  const connEl = document.getElementById('status-conn-badge');
  if (connEl) connEl.textContent = `(${h.user}@${targetHost}:${targetPort})`;

  // 1. Check if tab card already exists
  let tab = document.querySelector(`.tab-card[data-view="${viewId}"]`);
  if (!tab) {
    tab = document.createElement('div');
    tab.className = 'tab-card';
    tab.setAttribute('data-view', viewId);
    tab.draggable = true;
    const isCloud = h.cloud_provider && h.cloud_provider !== 'none';
    const tabIconHtml = isCloud ? '<i class="fa" style="color: #61afef; width: 14px; height: 14px; margin-right: 2px;">&#xf0c2;</i>' : getHostIconHtml(h.icon, 'width: 14px; height: 14px; margin-right: 2px;');
    const isAlive = isHostAlive(h);
    const tabLabel = isCloud ? `${h.name} (${h.cloud_provider.toUpperCase()})` : h.name;
    tab.innerHTML = `
      ${tabIconHtml}
      <span class="online-dot ${isAlive ? 'active' : ''}" style="margin-right: -4px;"></span>
      <span class="tab-title">${escapeHtml(tabLabel)}</span>
      <span class="tab-close">✕</span>
    `;
    document.getElementById('add-tab-btn').before(tab);
    setupTabInteractivity();
  }

  // 2. Check if view pane exists
  let pane = document.getElementById(`${viewId}-pane`);
  if (!pane) {
    pane = document.createElement('div');
    pane.id = `${viewId}-pane`;
    pane.className = 'view-pane';
    pane.innerHTML = `<div id="terminal-container-${viewId}" class="xterm-view-wrapper"></div>`;
    document.getElementById('center-workspace').appendChild(pane);
  }

  // 3. Switch to this tab view
  document.querySelectorAll('.tab-card').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  switchView(viewId);

  // 4. Construct OpenSSH command with modern options (30s timeout guard)
  let sshCmd = `ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -p ${targetPort}`;


  // SSH Compression (-C)
  if (appConfig.settings.enable_ssh_compression === true) {
    sshCmd += ` -C`;
  }

  if (h.auth_type === 'key' && h.key_path && h.key_path.trim().length > 0) {
    try {
      await invoke('fix_ssh_key_permissions', { path: h.key_path.trim() });
    } catch (e) {
      console.warn('Could not auto-secure key permissions before connecting:', e);
    }
    sshCmd += ` -i "${h.key_path.trim().replace(/\\/g, '/')}"`;
  }
  sshCmd += ` ${h.user}@${targetHost}`;

  // 5. Initialize or focus terminal session with autoPassword if configured
  const autoPassword = (h.auth_type === 'password' && h.password) ? h.password : null;
  initTerminalSession(sessionId, `terminal-container-${viewId}`, sshCmd, { autoPassword });
  updateHostStatusDots();
}

// ── 5. Real Local & Remote SFTP Explorer ──
let sftpMode = 'local'; // 'local' | 'remote'
let sftpCurrentHost = null;
let sftpCurrentPath = '.';
let selectedSftpItem = null; // { file, isRemote, host }
const sftpRemotePaths = {}; // hostId -> path

async function loadLocalFiles(dirPath = null) {
  const container = document.getElementById('sftp-file-list');
  const title = document.getElementById('sftp-header-title');
  const pathText = document.getElementById('sftp-current-path');
  if (!container) return;

  sftpMode = 'local';
  sftpCurrentPath = dirPath || '.';
  if (title) title.textContent = 'FILES: Local Workspace';
  if (pathText) {
    pathText.value = sftpCurrentPath;
    pathText.textContent = sftpCurrentPath;
  }

  container.innerHTML = '<div style="padding: 12px; color: var(--text-subtle);">Loading local files...</div>';

  try {
    const files = await invoke('list_local_files', { dirPath });
    renderSftpFileList(files, false, null);
  } catch (err) {
    container.innerHTML = `<div style="padding: 12px; color: var(--text-subtle);">Failed to read directory: ${err}</div>`;
  }
}

async function loadRemoteFiles(host, dirPath = null) {
  const container = document.getElementById('sftp-file-list');
  const title = document.getElementById('sftp-header-title');
  const pathText = document.getElementById('sftp-current-path');
  if (!container) return;

  sftpMode = 'remote';
  sftpCurrentHost = host;
  sftpCurrentPath = dirPath || sftpRemotePaths[host.id] || '~';
  sftpRemotePaths[host.id] = sftpCurrentPath;

  if (title) title.textContent = `FILES: ${host.name} (SSH)`;
  if (pathText) {
    pathText.value = sftpCurrentPath;
    pathText.textContent = sftpCurrentPath;
  }

  container.innerHTML = '<div style="padding: 12px; color: var(--text-subtle);">Loading remote files...</div>';

  try {
    const res = await invoke('list_remote_files', { host, remotePath: sftpCurrentPath });
    const files = Array.isArray(res) ? res : (res?.files || []);
    if (res && res.current_path) {
      sftpCurrentPath = res.current_path;
      sftpRemotePaths[host.id] = sftpCurrentPath;
      if (pathText) {
        pathText.value = sftpCurrentPath;
        pathText.textContent = sftpCurrentPath;
      }
    }
    renderSftpFileList(files, true, host);
  } catch (err) {
    container.innerHTML = `<div style="padding: 12px; color: var(--text-subtle);">SFTP error: ${err}</div>`;
  }
}

function renderSftpFileList(files, isRemote, host) {
  const container = document.getElementById('sftp-file-list');
  if (!container) return;
  container.innerHTML = '';
  selectedSftpItem = null;

  if (!files || files.length === 0) {
    container.innerHTML = '<div style="padding: 12px; color: var(--text-subtle);">Directory is empty</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.fileData = f;
    const icon = f.is_dir ? '&#xf07b;' : f.is_db ? '&#xf1c0;' : '&#xf15b;';
    const ext = f.name.lastIndexOf('.') > 0 ? f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase() : '';
    const fileType = f.is_dir ? 'DIR' : (ext ? ext : 'FILE');
    const filePerms = f.permissions || (f.is_dir ? 'drwxr-xr-x' : '-rw-r--r--');

    row.innerHTML = `
      <i class="fa" style="color: var(--text-muted);">${icon}</i>
      <span class="file-name" style="color: var(--text-primary);" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="file-date">${f.modified}</span>
      <span class="file-size">${f.size}</span>
      <span class="file-type">${fileType}</span>
      <span class="file-perms">${filePerms}</span>
    `;

    fragment.appendChild(row);
  });

  container.appendChild(fragment);

  // Single delegated click & double-click listener on file container
  container.onclick = (e) => {
    const row = e.target.closest('.file-row');
    if (row && row.fileData) {
      e.stopPropagation();
      document.querySelectorAll('#sftp-file-list .file-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      selectedSftpItem = {
        file: row.fileData,
        isRemote: isRemote,
        host: host,
      };
    } else {
      document.querySelectorAll('#sftp-file-list .file-row').forEach(r => r.classList.remove('selected'));
      selectedSftpItem = null;
    }
  };

  container.ondblclick = (e) => {
    const row = e.target.closest('.file-row');
    if (!row || !row.fileData) return;
    const f = row.fileData;
    if (f.is_dir) {
      if (isRemote && host) {
        loadRemoteFiles(host, f.path);
      } else {
        loadLocalFiles(f.path);
      }
    } else if (f.is_db) {
      openDbTab(f.name, f.path, isRemote, host);
    } else {
      openEditorTab(f.name, f.path, isRemote, host);
    }
  };
}

function sftpGoUp() {
  if (sftpMode === 'remote' && sftpCurrentHost) {
    if (sftpCurrentPath === '/' || sftpCurrentPath === '') return;
    const parentPath = sftpCurrentPath.replace(/\/[^\/]+\/?$/, '') || '/';
    loadRemoteFiles(sftpCurrentHost, parentPath);
  } else {
    if (sftpCurrentPath === '.' || sftpCurrentPath === '') {
      loadLocalFiles('..');
    } else {
      const parentPath = sftpCurrentPath.replace(/[\\\/][^\\\/]+[\\\/]?$/, '') || '.';
      loadLocalFiles(parentPath);
    }
  }
}


// ── In-App Code Editor & Multi-Language Highlighter ──
let currentlyOpenFile = null; // { name, path, isRemote, host, lang }

function detectLanguage(fileName) {
  if (!fileName) return 'TEXT';
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return 'JSON';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'YAML';
  if (lower.endsWith('.toml')) return 'TOML';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'BASH';
  if (lower.endsWith('.py')) return 'PYTHON';
  if (lower.endsWith('.rs')) return 'RUST';
  if (lower.endsWith('.sql')) return 'SQL';
  if (lower.includes('dockerfile')) return 'DOCKER';
  if (lower.endsWith('.ini') || lower.endsWith('.conf') || lower.endsWith('.cfg') || lower.endsWith('.service')) return 'CONFIG';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'MARKDOWN';
  if (lower.endsWith('.js') || lower.endsWith('.ts')) return 'JS';
  return 'TEXT';
}

async function openEditorTab(fileName, filePath, isRemote = false, host = null) {
  const safeId = btoa(unescape(encodeURIComponent(filePath))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const viewId = `file-${safeId}`;
  const lang = detectLanguage(fileName);

  // 1. Check if tab card already exists
  let tab = document.querySelector(`.tab-card[data-view="${viewId}"]`);
  if (!tab) {
    tab = document.createElement('div');
    tab.className = 'tab-card';
    tab.setAttribute('data-view', viewId);
    tab.setAttribute('data-file-path', filePath);
    if (isRemote && host) {
      tab.setAttribute('data-is-remote', 'true');
      tab.setAttribute('data-host-id', host.id);
    }
    tab.draggable = true;
    tab.innerHTML = `
      <i class="fa">&#xf15b;</i>
      <span class="tab-title">${fileName}</span>
      <span class="tab-close">✕</span>
    `;
    document.getElementById('add-tab-btn').before(tab);
    setupTabInteractivity();
  }

  // 2. Setup editor view UI
  const statusText = document.getElementById('editor-status-text');
  const langBadge = document.getElementById('editor-lang-badge');
  const titleElem = document.getElementById('editor-file-title');
  const textarea = document.getElementById('editor-textarea');

  if (langBadge) langBadge.textContent = lang;
  if (titleElem) titleElem.textContent = (isRemote && host ? `${host.name}:` : '') + filePath;
  if (statusText) statusText.innerHTML = '<span style="color: var(--text-subtle);">Loading...</span>';

  try {
    let content = '';
    if (isRemote && host) {
      content = await invoke('read_remote_file', { host, remotePath: filePath });
    } else {
      content = await invoke('read_local_file', { path: filePath });
    }

    currentlyOpenFile = { name: fileName, path: filePath, isRemote, host, lang };
    if (textarea) {
      textarea.value = content;
      textarea.dispatchEvent(new Event('input'));
    }
    if (statusText) statusText.innerHTML = '<span style="color: var(--green);"><i class="fa">&#xf00c;</i> Ready</span>';
  } catch (err) {
    console.error('Failed to read file:', err);
    if (statusText) statusText.innerHTML = `<span style="color: var(--red);">Error reading file</span>`;
  }

  // 3. Switch to this tab
  document.querySelectorAll('.tab-card').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  switchView('editor');
}

// ── In-App SQLite Database Viewer ──
let currentDbState = null; // { filePath, localPath, isRemote, host }

async function openDbTab(fileName, filePath, isRemote = false, host = null) {
  const safeId = btoa(unescape(encodeURIComponent(filePath))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  const viewId = `db-${safeId}`;

  let tab = document.querySelector(`.tab-card[data-view="${viewId}"]`);
  if (!tab) {
    tab = document.createElement('div');
    tab.className = 'tab-card';
    tab.setAttribute('data-view', viewId);
    tab.setAttribute('data-file-path', filePath);
    if (isRemote && host) {
      tab.setAttribute('data-is-remote', 'true');
      tab.setAttribute('data-host-id', host.id);
    }
    tab.draggable = true;
    tab.innerHTML = `
      <i class="fa">&#xf1c0;</i>
      <span class="tab-title">${fileName}</span>
      <span class="tab-close">✕</span>
    `;
    document.getElementById('add-tab-btn').before(tab);
    setupTabInteractivity();
  }

  document.querySelectorAll('.tab-card').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');
  switchView('db');

  const dbActiveFile = document.getElementById('db-active-file');
  if (dbActiveFile) dbActiveFile.textContent = (isRemote && host ? `${host.name}:` : '') + filePath;

  const statsBadge = document.getElementById('db-stats-badge');
  if (statsBadge) statsBadge.textContent = 'Loading...';

  try {
    let localPath = filePath;
    if (isRemote && host) {
      if (statsBadge) statsBadge.textContent = 'Caching remote DB...';
      localPath = await invoke('cache_remote_db', { host, remotePath: filePath });
    }
    currentDbState = { filePath, localPath, isRemote, host };
    await loadDatabaseTables(localPath);
    if (statsBadge) statsBadge.textContent = isRemote ? '(Remote Cache)' : '(Local)';
  } catch (err) {
    if (statsBadge) statsBadge.textContent = `Error: ${err}`;
    console.error('Failed to open database:', err);
  }
}

async function loadDatabaseTables(localPath) {
  const emptyState = document.getElementById('db-empty-state');
  const studioContainer = document.getElementById('db-studio-container');
  const tablesList = document.getElementById('db-tables-list');
  const tablesCount = document.getElementById('db-tables-count');

  try {
    const tables = await invoke('sqlite_get_tables', { path: localPath });
    if (emptyState) emptyState.style.display = 'none';
    if (studioContainer) studioContainer.classList.remove('hidden');

    if (tablesCount) tablesCount.textContent = tables.length;
    if (tablesList) {
      tablesList.innerHTML = '';
      if (tables.length === 0) {
        tablesList.innerHTML = '<div style="padding: 10px; color: var(--text-subtle); font-size: 11px;">No tables found</div>';
      } else {
        tables.forEach((t, idx) => {
          const item = document.createElement('div');
          item.className = `db-table-item ${idx === 0 ? 'active' : ''}`;
          item.innerHTML = `
            <i class="fa" style="color: var(--accent); font-size: 11px;">&#xf0ce;</i>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.name}</span>
            <span class="table-count">${t.count}</span>
          `;
          item.addEventListener('click', () => {
            document.querySelectorAll('.db-table-item').forEach((i) => i.classList.remove('active'));
            item.classList.add('active');
            const qInput = document.getElementById('db-query-input');
            const query = `SELECT * FROM "${t.name}" LIMIT 100;`;
            if (qInput) qInput.value = query;
            executeDbQuery(localPath, query);
          });
          tablesList.appendChild(item);
        });

        // Auto-run first table
        const first = tables[0];
        const qInput = document.getElementById('db-query-input');
        const query = `SELECT * FROM "${first.name}" LIMIT 100;`;
        if (qInput) qInput.value = query;
        executeDbQuery(localPath, query);
      }
    }
  } catch (err) {
    console.error('Failed to get sqlite tables:', err);
    if (tablesList) tablesList.innerHTML = `<div style="padding: 10px; color: var(--red); font-size: 11px;">${err}</div>`;
  }
}

async function executeDbQuery(localPath, query) {
  const timing = document.getElementById('db-query-timing');
  const thead = document.getElementById('db-table-head');
  const tbody = document.getElementById('db-table-body');

  if (timing) timing.textContent = 'Executing query...';

  try {
    const res = await invoke('sqlite_query', { path: localPath, query });
    if (timing) {
      timing.innerHTML = `<span style="color: var(--green);">✓</span> Returned <span style="color: var(--text-bright); font-weight: 600;">${res.row_count}</span> rows in <span style="color: var(--text-bright); font-weight: 600;">${res.duration_ms}ms</span>`;
    }

    if (thead) {
      let headHtml = '<tr><th style="width: 40px; text-align: center;">#</th>';
      res.columns.forEach((col) => {
        headHtml += `<th>${col}</th>`;
      });
      headHtml += '</tr>';
      thead.innerHTML = headHtml;
    }

    if (tbody) {
      tbody.innerHTML = '';
      if (res.rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${res.columns.length + 1}" style="text-align: center; color: var(--text-subtle); padding: 24px;">No rows returned</td></tr>`;
      } else {
        res.rows.forEach((row, rIdx) => {
          const tr = document.createElement('tr');
          let rowHtml = `<td style="color: var(--text-subtle); text-align: center;">${rIdx + 1}</td>`;
          row.forEach((val) => {
            let strVal = val === null ? '<span style="color: var(--text-subtle); font-style: italic;">NULL</span>' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
            rowHtml += `<td>${strVal}</td>`;
          });
          tr.innerHTML = rowHtml;
          tbody.appendChild(tr);
        });
      }
    }
  } catch (err) {
    if (timing) timing.innerHTML = `<span style="color: var(--red);">✕ Query error:</span> ${err}`;
    if (tbody) tbody.innerHTML = `<tr><td colspan="100%" style="color: var(--red); padding: 16px;">${err}</td></tr>`;
  }
}

// ── 6. Activity Rail & Collapsible Drawer ──
const drawer = document.getElementById('left-drawer');
const drawerTitle = document.getElementById('drawer-title');

function getActiveTargetInfo(view) {
  if (!view) {
    const activeTab = document.querySelector('.tab-card.active');
    view = activeTab?.getAttribute('data-view') || 'local';
  }
  if (view.startsWith('host-')) {
    const hostId = view.replace('host-', '');
    const host = (appConfig.hosts || []).find((h) => h.id === hostId);
    return { isRemote: true, host: host || null, name: host ? host.name : 'Remote Host' };
  }
  return { isRemote: false, host: null, name: 'Local Machine' };
}

let isRailDragging = false;

document.querySelectorAll('.rail-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (isRailDragging || btn.classList.contains('disabled')) return;
    const tab = btn.getAttribute('data-tab');

    const drawerSettings = document.getElementById('drawer-settings');
    const drawerItems = document.getElementById('drawer-items');
    const drawerFiles = document.getElementById('drawer-files');
    const drawerDocker = document.getElementById('drawer-docker');
    const drawerPorts = document.getElementById('drawer-ports');
    const drawerTunnels = document.getElementById('drawer-tunnels');
    const drawerSnippets = document.getElementById('drawer-snippets');
    const drawerCloud = document.getElementById('drawer-cloud');
    const drawerWireguard = document.getElementById('drawer-wireguard');
    const drawerLogs = document.getElementById('drawer-logs');
    const drawerSearch = document.getElementById('drawer-search-box');
    const addHostBtn = document.getElementById('btn-open-add-host');
    const addSnippetBtn = document.getElementById('btn-open-add-snippet');
    const ipToggleWrapper = document.getElementById('ip-toggle-wrapper');

    function hideAllDrawers() {
      if (drawerSettings) { drawerSettings.classList.add('hidden'); drawerSettings.style.display = 'none'; }
      if (drawerItems) { drawerItems.classList.add('hidden'); drawerItems.style.display = 'none'; }
      if (drawerFiles) { drawerFiles.classList.add('hidden'); drawerFiles.style.display = 'none'; }
      if (drawerDocker) { drawerDocker.classList.add('hidden'); drawerDocker.style.display = 'none'; }
      if (drawerPorts) { drawerPorts.classList.add('hidden'); drawerPorts.style.display = 'none'; }
      if (drawerTunnels) { drawerTunnels.classList.add('hidden'); drawerTunnels.style.display = 'none'; }
      if (drawerSnippets) { drawerSnippets.classList.add('hidden'); drawerSnippets.style.display = 'none'; }
      if (drawerCloud) { drawerCloud.classList.add('hidden'); drawerCloud.style.display = 'none'; }
      if (drawerWireguard) { drawerWireguard.classList.add('hidden'); drawerWireguard.style.display = 'none'; }
      if (drawerLogs) { drawerLogs.classList.add('hidden'); drawerLogs.style.display = 'none'; }
      if (addSnippetBtn) addSnippetBtn.style.display = 'none';
      if (ipToggleWrapper) ipToggleWrapper.style.display = 'none';
    }

    if (tab === 'settings') {
      if (activeCategory === 'settings' && !drawer.classList.contains('collapsed')) {
        drawer.classList.add('collapsed');
        btn.classList.remove('active');
        return;
      }

      drawer.classList.remove('collapsed');
      document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = 'settings';
      drawerTitle.textContent = 'SETTINGS';
      if (!appConfig.session) appConfig.session = {};
      appConfig.session.active_category = 'settings';
      persistConfig();

      hideAllDrawers();
      if (drawerSettings) {
        drawerSettings.classList.remove('hidden');
        drawerSettings.style.display = 'flex';
        renderSettingsRailOrderList();
      }
      if (drawerSearch) {
        drawerSearch.classList.add('hidden');
        drawerSearch.style.display = 'none';
      }
      if (addHostBtn) addHostBtn.style.display = 'none';
      return;
    }

    if (tab === activeCategory && !drawer.classList.contains('collapsed')) {
      drawer.classList.add('collapsed');
      btn.classList.remove('active');
      return;
    }

    drawer.classList.remove('collapsed');
    document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    activeCategory = tab;
    drawerTitle.textContent = tab === 'snippets' ? 'NOTES & ALIASES' : (tab === 'files' ? 'FILES' : (tab === 'cloud' ? 'CLOUD PROVIDERS' : (tab === 'wireguard' ? 'MESH VPN' : (tab === 'logs' ? 'APP LOGS' : tab.toUpperCase()))));
    if (!appConfig.session) appConfig.session = {};
    appConfig.session.active_category = tab;
    persistConfig();

    hideAllDrawers();
    if (addHostBtn) addHostBtn.style.display = tab === 'hosts' ? 'inline' : 'none';
    if (ipToggleWrapper) ipToggleWrapper.style.display = tab === 'hosts' ? 'inline-flex' : 'none';

    if (tab === 'files') {
      if (drawerSearch) drawerSearch.style.display = 'none';
      if (drawerFiles) {
        drawerFiles.classList.remove('hidden');
        drawerFiles.style.display = 'flex';
      }
      const isRemote = (sftpMode === 'remote' && sftpCurrentHost);
      drawerTitle.textContent = isRemote ? `FILES: ${sftpCurrentHost.name}` : 'FILES: Local Workspace';
      if (isRemote) {
        loadRemoteFiles(sftpCurrentHost, sftpCurrentPath || '.');
      } else {
        loadLocalFiles(sftpCurrentPath || null);
      }
    } else if (tab === 'cloud') {
      if (drawerSearch) drawerSearch.style.display = 'none';
      if (drawerCloud) {
        drawerCloud.classList.remove('hidden');
        drawerCloud.style.display = 'flex';
      }
      renderCloudDrawer();
    } else if (tab === 'docker') {
      if (drawerSearch) drawerSearch.style.display = 'none';
      if (drawerDocker) {
        drawerDocker.classList.remove('hidden');
        drawerDocker.style.display = 'flex';
      }
      renderDockerDrawer();
    } else if (tab === 'ports') {
      if (drawerSearch) drawerSearch.style.display = 'none';
      if (drawerPorts) {
        drawerPorts.classList.remove('hidden');
        drawerPorts.style.display = 'flex';
      }
      renderPortsDrawer();
    } else if (tab === 'tunnels') {
      if (drawerSearch) drawerSearch.style.display = 'none';
      if (drawerTunnels) {
        drawerTunnels.classList.remove('hidden');
        drawerTunnels.style.display = 'flex';
      }
      renderTunnelsDrawer();
    } else if (tab === 'wireguard') {
      if (drawerSearch) drawerSearch.style.display = 'none';
      if (drawerWireguard) {
        drawerWireguard.classList.remove('hidden');
        drawerWireguard.style.display = 'flex';
      }
      renderUnifiedMeshDrawer();
    } else if (tab === 'logs') {
      if (drawerSearch) drawerSearch.style.display = 'none';
      if (drawerLogs) {
        drawerLogs.classList.remove('hidden');
        drawerLogs.style.display = 'flex';
      }
      renderLogsDrawer();
    } else if (tab === 'snippets') {
      if (drawerSearch) drawerSearch.style.display = 'none';
      if (addSnippetBtn) addSnippetBtn.style.display = 'inline';
      if (drawerSnippets) {
        drawerSnippets.classList.remove('hidden');
        drawerSnippets.style.display = 'flex';
      }
      renderSnippetsDrawer();
    } else {
      if (drawerSearch) {
        drawerSearch.classList.remove('hidden');
        drawerSearch.style.display = 'block';
      }
      if (drawerItems) {
        drawerItems.classList.remove('hidden');
        drawerItems.style.display = 'block';
      }
      if (tab === 'hosts') {
        renderHostsList(appConfig.hosts || []);
      } else {
        drawerItems.innerHTML = `<div style="padding: 16px 12px; color: var(--text-subtle);">Active listeners & config for ${tab}</div>`;
      }
    }
  });
});

const RAIL_TAB_METADATA = {
  hosts: { name: 'Hosts (Homelab)', icon: '&#xf233;' },
  cloud: { name: 'Cloud Providers (GCP, AWS, Azure)', icon: '&#xf0c2;' },
  files: { name: 'Files (Local & Remote SFTP)', icon: '&#xf07b;' },
  snippets: { name: 'Notes & Aliases', icon: '&#xf249;' },
  docker: { name: 'Docker Containers', icon: '&#xf1b2;' },
  ports: { name: 'Port & Socket Inspector', icon: '&#xf796;' },
  tunnels: { name: 'Port Forwarding (Tunnels)', icon: '&#xf0ec;' },
  wireguard: { name: 'Mesh VPN (WireGuard, Tailscale, NetBird)', icon: '&#xf3ed;' },
};

const DEFAULT_RAIL_ORDER = [
  'hosts',
  'cloud',
  'files',
  'snippets',
  'docker',
  'ports',
  'tunnels',
  'wireguard',
];

function getCurrentRailOrder() {
  const rail = document.getElementById('activity-rail');
  if (!rail) return DEFAULT_RAIL_ORDER.slice();
  const btns = Array.from(rail.querySelectorAll('.rail-btn')).filter((btn) => {
    const t = btn.getAttribute('data-tab');
    return t !== 'settings' && t !== 'logs';
  });
  return btns.map((b) => b.getAttribute('data-tab')).filter(Boolean);
}

function applyRailOrder(order, persist = true) {
  const rail = document.getElementById('activity-rail');
  if (!rail || !Array.isArray(order) || order.length === 0) return;
  const spacer = rail.querySelector('.rail-spacer');
  if (!spacer) return;

  order.forEach((tabKey) => {
    const btn = rail.querySelector(`.rail-btn[data-tab="${tabKey}"]`);
    if (btn) {
      rail.insertBefore(btn, spacer);
    }
  });

  // Ensure any other buttons not in order are also positioned before spacer
  Array.from(rail.querySelectorAll('.rail-btn')).forEach((btn) => {
    const tabKey = btn.getAttribute('data-tab');
    if (tabKey !== 'settings' && tabKey !== 'logs' && !order.includes(tabKey)) {
      rail.insertBefore(btn, spacer);
    }
  });

  if (persist && isConfigLoaded) {
    if (!appConfig.session) appConfig.session = {};
    appConfig.session.rail_order = getCurrentRailOrder();
    persistConfig(true);
  }
  renderSettingsRailOrderList();
}

function restoreRailOrder(savedOrder) {
  applyRailOrder(savedOrder, false);
}

function renderSettingsRailOrderList() {
  const container = document.getElementById('settings-rail-order-list');
  if (!container) return;

  const currentOrder = getCurrentRailOrder();
  container.innerHTML = '';

  currentOrder.forEach((tabKey, index) => {
    const meta = RAIL_TAB_METADATA[tabKey] || { name: tabKey, icon: '&#xf0c9;' };
    const item = document.createElement('div');
    item.className = 'rail-order-item';
    item.innerHTML = `
      <div class="rail-order-info">
        <i class="fa">${meta.icon}</i>
        <span class="rail-order-name">${escapeHtml(meta.name)}</span>
      </div>
      <div class="rail-order-buttons">
        <button type="button" class="btn-rail-move btn-move-up" title="Move Up" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="btn-rail-move btn-move-down" title="Move Down" ${index === currentOrder.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
    `;

    item.querySelector('.btn-move-up')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (index > 0) {
        const newOrder = [...currentOrder];
        const [moved] = newOrder.splice(index, 1);
        newOrder.splice(index - 1, 0, moved);
        applyRailOrder(newOrder);
      }
    });

    item.querySelector('.btn-move-down')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (index < currentOrder.length - 1) {
        const newOrder = [...currentOrder];
        const [moved] = newOrder.splice(index, 1);
        newOrder.splice(index + 1, 0, moved);
        applyRailOrder(newOrder);
      }
    });

    container.appendChild(item);
  });
}

// Wire reset rail order button in Settings
document.getElementById('btn-reset-rail-order')?.addEventListener('click', () => {
  applyRailOrder(DEFAULT_RAIL_ORDER);
  showToast('Left menu order reset to default', 'success');
});

function setupActivityRailDragDrop() {
  const rail = document.getElementById('activity-rail');
  if (!rail) return;

  let activeBtn = null;
  let startX = 0;
  let startY = 0;
  let isDragging = false;

  // Clear any legacy draggable attributes
  rail.querySelectorAll('.rail-btn').forEach((btn) => {
    btn.removeAttribute('draggable');
  });

  const onPointerMove = (e) => {
    if (!activeBtn) return;

    if (!isDragging) {
      const deltaX = Math.abs(e.clientX - startX);
      const deltaY = Math.abs(e.clientY - startY);
      if (deltaX > 4 || deltaY > 4) {
        isDragging = true;
        isRailDragging = true;
        activeBtn.classList.add('live-reordering');
        document.body.classList.add('rail-reordering-active');
      }
    }

    if (isDragging) {
      e.preventDefault();
      const hoveredElem = document.elementFromPoint(e.clientX, e.clientY);
      const targetBtn = hoveredElem?.closest('.rail-btn');

      if (targetBtn && targetBtn !== activeBtn && targetBtn.getAttribute('data-tab') !== 'settings' && targetBtn.getAttribute('data-tab') !== 'logs') {
        const rect = targetBtn.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          rail.insertBefore(activeBtn, targetBtn);
        } else {
          rail.insertBefore(activeBtn, targetBtn.nextSibling);
        }
      }
    }
  };

  const onPointerUp = () => {
    if (!activeBtn) return;

    if (isDragging) {
      activeBtn.classList.remove('live-reordering');
      document.body.classList.remove('rail-reordering-active');

      const newOrder = getCurrentRailOrder();
      if (!appConfig.session) appConfig.session = {};
      appConfig.session.rail_order = newOrder;
      persistConfig(true);
      renderSettingsRailOrderList();

      setTimeout(() => {
        isRailDragging = false;
      }, 150);
    } else {
      isRailDragging = false;
    }

    activeBtn = null;
    isDragging = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
  };

  rail.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // Only primary left mouse button
    const btn = e.target.closest('.rail-btn');
    if (!btn || btn.getAttribute('data-tab') === 'settings' || btn.getAttribute('data-tab') === 'logs') return;

    activeBtn = btn;
    startX = e.clientX;
    startY = e.clientY;
    isDragging = false;

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });

  // Prevent browser context menu on activity rail
  rail.addEventListener('contextmenu', (e) => e.preventDefault());
}

let dockerCheckSeq = 0;
let isLocalDockerAvailable = null;

async function updateDockerButtonState(view) {
  const dockerBtn = document.getElementById('rail-btn-docker');
  if (!dockerBtn) return;

  // If viewing a docker logs or exec tab, keep Docker active
  if (view && (view.startsWith('docker-logs-') || view.startsWith('docker-exec-'))) {
    dockerBtn.classList.remove('disabled');
    dockerBtn.title = 'Docker Containers';
    return;
  }

  // If viewing a remote host tab:
  if (view && view.startsWith('host-')) {
    const hostId = view.replace('host-', '');
    const host = (appConfig.hosts || []).find((h) => h.id === hostId);
    if (host) {
      if (host.has_docker) {
        dockerBtn.classList.remove('disabled');
        dockerBtn.title = `Docker Containers (${host.name})`;
        if (activeCategory === 'docker') {
          renderDockerDrawer();
        }
      } else {
        dockerBtn.classList.add('disabled');
        dockerBtn.title = `Docker is disabled for ${host.name} in Host Settings`;
        if (activeCategory === 'docker') {
          renderDockerDrawer();
        }
      }
      return;
    }
  }

  // Viewing Local Machine:
  const currentSeq = ++dockerCheckSeq;
  const dockerPort = appConfig.settings?.docker_port || 2375;

  try {
    const isAvail = await invoke('check_docker_available', {
      host: null,
      dockerPort: dockerPort
    });
    if (currentSeq !== dockerCheckSeq) return;
    isLocalDockerAvailable = !!isAvail;

    if (isAvail) {
      dockerBtn.classList.remove('disabled');
      dockerBtn.title = 'Docker & Podman Containers (Local Machine)';
      if (activeCategory === 'docker') {
        renderDockerDrawer();
      }
    } else {
      dockerBtn.classList.add('disabled');
      dockerBtn.title = 'Docker daemon not running locally';
      if (activeCategory === 'docker') {
        renderDockerDrawer();
      }
    }
  } catch (err) {
    if (currentSeq !== dockerCheckSeq) return;
    isLocalDockerAvailable = false;
    dockerBtn.classList.add('disabled');
    dockerBtn.title = 'Docker daemon not running locally';
    if (activeCategory === 'docker') {
      renderDockerDrawer();
    }
  }
}

function updatePortsButtonState(view) {
  const portsBtn = document.getElementById('rail-btn-ports');
  if (!portsBtn) return;

  // If viewing a remote host tab:
  if (view && view.startsWith('host-')) {
    const hostId = view.replace('host-', '');
    const host = (appConfig.hosts || []).find((h) => h.id === hostId);
    if (host) {
      if (host.enable_port_scan !== false) {
        portsBtn.classList.remove('disabled');
        portsBtn.title = `Port & Socket Inspector (${host.name})`;
        if (activeCategory === 'ports') {
          renderPortsDrawer();
        }
      } else {
        portsBtn.classList.add('disabled');
        portsBtn.title = `Port scanner is disabled for ${host.name} in Host Settings`;
        if (activeCategory === 'ports') {
          renderPortsDrawer();
        }
      }
      return;
    }
  }

  // Local Machine or non-host tabs:
  portsBtn.classList.remove('disabled');
  portsBtn.title = 'Port & Socket Inspector (Local Machine)';
  if (activeCategory === 'ports') {
    renderPortsDrawer();
  }
}

// ── Docker / Podman Drawer & Container Actions ──
let currentDockerContainers = [];
let dockerFilterText = '';

async function renderDockerDrawer() {
  const container = document.getElementById('drawer-docker');
  if (!container) return;

  const target = getActiveTargetInfo();
  const dockerPort = appConfig.settings?.docker_port || 2375;

  // 1. Remote host with has_docker === false:
  if (target.host && target.host.has_docker === false) {
    container.innerHTML = `
      <div class="docker-toolbar">
        <div class="docker-target-badge">
          <i class="fa">&#xf1b2;</i>
          <span>${escapeHtml(target.name)}</span>
        </div>
        <span style="font-size: 10px; color: var(--text-subtle);">Disabled</span>
      </div>
      <div style="padding: 24px 14px; text-align: center; color: var(--text-subtle); font-size: 12px; line-height: 1.6;">
        <i class="fa" style="font-size: 24px; color: var(--text-subtle); margin-bottom: 8px; display: block;">&#xf1b2;</i>
        Docker container inspection is disabled for <strong>${escapeHtml(target.name)}</strong>.<br>
        <span style="color: var(--accent); cursor: pointer; text-decoration: underline; margin-top: 6px; display: inline-block;" onclick="window.openEditHostModal && window.openEditHostModal(getActiveTargetInfo().host)">Enable in Host Settings</span>
      </div>
    `;
    return;
  }

  // 2. Local machine where docker is not running:
  if (!target.isRemote) {
    if (isLocalDockerAvailable === null) {
      try {
        isLocalDockerAvailable = await invoke('check_docker_available', { host: null, dockerPort });
      } catch (_) {
        isLocalDockerAvailable = false;
      }
    }
    if (!isLocalDockerAvailable) {
      container.innerHTML = `
        <div class="docker-toolbar">
          <div class="docker-target-badge">
            <i class="fa">&#xf1b2;</i>
            <span>Local Machine</span>
          </div>
          <span style="font-size: 10px; color: var(--text-subtle);">Unavailable</span>
        </div>
        <div style="padding: 24px 14px; text-align: center; color: var(--text-subtle); font-size: 12px; line-height: 1.6;">
          <i class="fa" style="font-size: 24px; color: var(--text-subtle); margin-bottom: 8px; display: block;">&#xf1b2;</i>
          Docker daemon is not running locally.<br>
          <span style="color: var(--text-muted); font-size: 11px;">Start Docker Desktop or the Docker daemon to view local containers.</span><br>
          <button class="btn-secondary" style="margin-top: 10px; font-size: 11px; padding: 3px 10px;" onclick="isLocalDockerAvailable = null; renderDockerDrawer();"><i class="fa">&#xf021;</i> Retry Detection</button>
        </div>
      `;
      return;
    }
  }

  container.innerHTML = `
    <div class="docker-toolbar">
      <div class="docker-target-badge">
        <i class="fa">&#xf1b2;</i>
        <span>${escapeHtml(target.name)}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span id="docker-container-count" style="font-size: 10px; color: var(--text-subtle);">Loading...</span>
        <button class="docker-refresh-btn" id="docker-refresh-btn" title="Refresh containers"><i class="fa">&#xf021;</i></button>
      </div>
    </div>
    <div class="drawer-search" style="padding: 0; margin-bottom: 2px;">
      <input type="text" id="docker-search-input" class="search-input" placeholder="Filter containers..." value="${dockerFilterText}">
    </div>
    <div id="docker-cards-list" style="display: flex; flex-direction: column; gap: 6px; flex: 1; overflow-y: auto;">
      <div style="padding: 16px 10px; text-align: center; color: var(--text-subtle); font-size: 12px;">
        <i class="fa fa-spin">&#xf110;</i> Querying Docker / Podman daemon...
      </div>
    </div>
  `;

  document.getElementById('docker-refresh-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    renderDockerDrawer();
  });

  const searchInput = document.getElementById('docker-search-input');
  searchInput?.addEventListener('input', (e) => {
    dockerFilterText = e.target.value.toLowerCase();
    renderDockerCards();
  });

  try {
    currentDockerContainers = await invoke('get_docker_containers', {
      host: target.host,
      dockerPort: dockerPort
    });
    renderDockerCards();
  } catch (err) {
    const list = document.getElementById('docker-cards-list');
    if (list) {
      list.innerHTML = `
        <div style="padding: 16px 10px; text-align: center; color: var(--red); font-size: 11.5px;">
          Failed to fetch containers: ${err}
        </div>
      `;
    }
  }
}

let visibleDockerIds = new Set();
let dockerCardObserver = null;

function fetchContainerStatsIfVisible(containerId, cardElement) {
  if (!visibleDockerIds.has(containerId)) return;
  const target = getActiveTargetInfo();
  const dockerPort = appConfig.settings?.docker_port || 2375;
  invoke('get_container_stats', {
    host: target.host,
    dockerPort: dockerPort,
    containerId: containerId,
  }).then((stats) => {
    if (stats) {
      const cpu = typeof stats === 'object' ? stats.cpu : '-';
      const mem = typeof stats === 'object' ? stats.memory : stats;
      if (cpu && cpu !== '-') {
        const el = cardElement.querySelector('.cpu-val');
        if (el) el.textContent = cpu;
        const c = currentDockerContainers.find((x) => x.id === containerId);
        if (c) c.cpu = cpu;
      }
      if (mem && mem !== '-') {
        const el = cardElement.querySelector('.mem-val');
        if (el) el.textContent = mem;
        const c = currentDockerContainers.find((x) => x.id === containerId);
        if (c) c.memory = mem;
      }
    }
  }).catch(() => {});
}

function renderDockerCards() {
  const list = document.getElementById('docker-cards-list');
  const countEl = document.getElementById('docker-container-count');
  if (!list) return;

  const target = getActiveTargetInfo();
  const dockerPort = appConfig.settings?.docker_port || 2375;

  const filtered = currentDockerContainers.filter((c) => {
    if (!dockerFilterText) return true;
    return c.name.toLowerCase().includes(dockerFilterText) ||
           c.image.toLowerCase().includes(dockerFilterText) ||
           c.status.toLowerCase().includes(dockerFilterText);
  });

  if (countEl) {
    const runningCount = currentDockerContainers.filter((c) => c.state === 'running').length;
    countEl.textContent = `${currentDockerContainers.length} total (${runningCount} running)`;
  }

  if (filtered.length === 0) {
    list.innerHTML = `
      <div style="padding: 16px 10px; text-align: center; color: var(--text-subtle); font-size: 11.5px;">
        ${currentDockerContainers.length === 0 ? 'No containers found.' : 'No matching containers.'}
      </div>
    `;
    return;
  }

  if (dockerCardObserver) {
    dockerCardObserver.disconnect();
  }
  visibleDockerIds.clear();

  const drawerDocker = document.getElementById('drawer-docker');
  dockerCardObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const cid = entry.target.getAttribute('data-id');
      if (!cid) return;
      if (entry.isIntersecting) {
        visibleDockerIds.add(cid);
        const c = currentDockerContainers.find((x) => x.id === cid);
        const state = (c?.status || c?.state || '').toLowerCase();
        const isUp = state.includes('up') || state.includes('running');
        if (isUp) {
          fetchContainerStatsIfVisible(cid, entry.target);
        }
      } else {
        visibleDockerIds.delete(cid);
      }
    });
  }, {
    root: drawerDocker,
    threshold: 0.05,
  });

  list.innerHTML = '';
  filtered.forEach((c) => {
    const isUp = c.state === 'running';
    const isExited = c.state === 'exited';
    const pillClass = isUp ? 'up' : (isExited ? 'exited' : 'other');

    const card = document.createElement('div');
    card.className = 'docker-card';
    card.setAttribute('data-id', c.id);
    card.title = 'Double-click to stream logs in a center tab';

    card.innerHTML = `
      <div class="docker-card-header">
        <span class="docker-card-title" title="${c.name}">${c.name}</span>
        <span class="docker-status-pill ${pillClass}">
          ${c.status || c.state}
        </span>
      </div>
      <div class="docker-card-image" title="${c.image}">${c.image}</div>
      <div class="docker-card-meta">
        <span class="docker-cpu-badge" id="docker-cpu-${c.id}" title="CPU usage">
          <i class="fa">&#xf2db;</i> <span class="cpu-val">${c.cpu && c.cpu !== '-' ? c.cpu : (isUp ? '...' : '-')}</span>
        </span>
        <span class="docker-mem-badge" id="docker-mem-${c.id}" title="Memory usage">
          <i class="fa">&#xf085;</i> <span class="mem-val">${c.memory && c.memory !== '-' ? c.memory : (isUp ? '...' : '-')}</span>
        </span>
      </div>
      <div class="docker-card-actions">
        <div class="docker-card-actions-left" style="display: flex; align-items: center; gap: 4px;">
          <button class="docker-action-btn btn-logs" title="Stream container logs"><i class="fa">&#xf120;</i> Logs</button>
          <button class="docker-action-btn btn-exec" title="Launch interactive terminal exec"><i class="fa">&#xf120;</i> Exec</button>
        </div>
        <div class="docker-card-actions-right" style="margin-left: auto; display: flex; align-items: center; gap: 4px;">
          ${isUp ? `
            <button class="docker-action-btn btn-restart" title="Restart container"><i class="fa">&#xf021;</i></button>
            <button class="docker-action-btn btn-danger btn-stop" title="Stop container"><i class="fa">&#xf04d;</i></button>
          ` : `
            <button class="docker-action-btn btn-start" style="color: var(--green);" title="Start container"><i class="fa">&#xf04b;</i></button>
          `}
        </div>
      </div>
    `;

    dockerCardObserver.observe(card);

    card.addEventListener('dblclick', () => {
      openDockerLogsTab(target.host, c);
    });

    card.querySelector('.btn-logs')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openDockerLogsTab(target.host, c);
    });

    card.querySelector('.btn-exec')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openDockerExecTab(target.host, c);
    });

    card.querySelector('.btn-restart')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await invoke('docker_container_action', {
          host: target.host,
          dockerPort: dockerPort,
          containerId: c.id,
          action: 'restart'
        });
        setTimeout(renderDockerDrawer, 800);
      } catch (err) {
        alert(`Failed to restart container: ${err}`);
      }
    });

    card.querySelector('.btn-stop')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await invoke('docker_container_action', {
          host: target.host,
          dockerPort: dockerPort,
          containerId: c.id,
          action: 'stop'
        });
        setTimeout(renderDockerDrawer, 800);
      } catch (err) {
        alert(`Failed to stop container: ${err}`);
      }
    });

    card.querySelector('.btn-start')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await invoke('docker_container_action', {
          host: target.host,
          dockerPort: dockerPort,
          containerId: c.id,
          action: 'start'
        });
        setTimeout(renderDockerDrawer, 800);
      } catch (err) {
        alert(`Failed to start container: ${err}`);
      }
    });

    list.appendChild(card);
  });
}

function openDockerLogsTab(host, container) {
  const shortId = container.id.slice(0, 12);
  const viewId = `docker-logs-${shortId}`;
  const sessionId = `session-${viewId}`;

  let tab = document.querySelector(`.tab-card[data-view="${viewId}"]`);
  if (!tab) {
    tab = document.createElement('div');
    tab.className = 'tab-card';
    tab.setAttribute('data-view', viewId);
    if (host) tab.setAttribute('data-host-id', host.id);
    tab.draggable = true;
    tab.innerHTML = `
      <i class="fa" style="color: var(--accent);">&#xf1b2;</i>
      <span class="tab-title">Logs: ${container.name}</span>
      <span class="tab-close">✕</span>
    `;
    document.getElementById('add-tab-btn').before(tab);
    setupTabInteractivity();
  }

  let pane = document.getElementById(`${viewId}-pane`);
  if (!pane) {
    pane = document.createElement('div');
    pane.id = `${viewId}-pane`;
    pane.className = 'view-pane';
    pane.innerHTML = `<div id="terminal-container-${viewId}" class="xterm-view-wrapper"></div>`;
    document.getElementById('center-workspace').appendChild(pane);
  }

  document.querySelectorAll('.tab-card').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');

  let cmd = '';
  let autoPassword = null;
  if (host) {
    cmd = `ssh -t -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -p ${host.port || 22}`;
    if (appConfig.settings.enable_ssh_compression === true) {
      cmd += ` -C`;
    }
    if (host.auth_type === 'key' && host.key_path && host.key_path.trim().length > 0) {
      cmd += ` -i "${host.key_path.trim().replace(/\\/g, '/')}"`;
    }
    cmd += ` ${host.user}@${host.host} "docker logs -f --tail 200 ${container.id}"`;
    autoPassword = (host.auth_type === 'password' && host.password) ? host.password : null;
  } else {
    cmd = `docker logs -f --tail 200 ${container.id}`;
  }

  initTerminalSession(sessionId, `terminal-container-${viewId}`, cmd, { autoPassword });
  switchView(viewId);
}

function openDockerExecTab(host, container) {
  const shortId = container.id.slice(0, 12);
  const viewId = `docker-exec-${shortId}`;
  const sessionId = `session-${viewId}`;

  let tab = document.querySelector(`.tab-card[data-view="${viewId}"]`);
  if (!tab) {
    tab = document.createElement('div');
    tab.className = 'tab-card';
    tab.setAttribute('data-view', viewId);
    if (host) tab.setAttribute('data-host-id', host.id);
    tab.draggable = true;
    tab.innerHTML = `
      <i class="fa" style="color: var(--green);">&#xf120;</i>
      <span class="tab-title">Exec: ${container.name}</span>
      <span class="tab-close">✕</span>
    `;
    document.getElementById('add-tab-btn').before(tab);
    setupTabInteractivity();
  }

  let pane = document.getElementById(`${viewId}-pane`);
  if (!pane) {
    pane = document.createElement('div');
    pane.id = `${viewId}-pane`;
    pane.className = 'view-pane';
    pane.innerHTML = `<div id="terminal-container-${viewId}" class="xterm-view-wrapper"></div>`;
    document.getElementById('center-workspace').appendChild(pane);
  }

  document.querySelectorAll('.tab-card').forEach((t) => t.classList.remove('active'));
  tab.classList.add('active');

  let cmd = '';
  let autoPassword = null;
  if (host) {
    cmd = `ssh -t -o StrictHostKeyChecking=accept-new -o ConnectTimeout=30 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 -p ${host.port || 22}`;
    if (appConfig.settings.enable_ssh_compression === true) {
      cmd += ` -C`;
    }
    if (host.auth_type === 'key' && host.key_path && host.key_path.trim().length > 0) {
      cmd += ` -i "${host.key_path.trim().replace(/\\/g, '/')}"`;
    }
    cmd += ` ${host.user}@${host.host} "docker exec -it ${container.id} sh"`;
    autoPassword = (host.auth_type === 'password' && host.password) ? host.password : null;
  } else {
    cmd = `docker exec -it ${container.id} sh`;
  }

  initTerminalSession(sessionId, `terminal-container-${viewId}`, cmd, { autoPassword });
  switchView(viewId);
}

// ── Real-Time Port & Socket Inspector ──
let currentPortInspection = null;
let currentPortsFilter = 'all';
let portsSearchText = '';

async function renderPortsDrawer() {
  const container = document.getElementById('drawer-ports');
  if (!container) return;

  const target = getActiveTargetInfo();

  // If remote host with enable_port_scan === false:
  if (target.host && target.host.enable_port_scan === false) {
    container.innerHTML = `
      <div class="docker-toolbar">
        <div class="docker-target-badge">
          <i class="fa">&#xf796;</i>
          <span>${escapeHtml(target.name)}</span>
        </div>
        <span style="font-size: 10px; color: var(--text-subtle);">Disabled</span>
      </div>
      <div style="padding: 24px 14px; text-align: center; color: var(--text-subtle); font-size: 12px; line-height: 1.6;">
        <i class="fa" style="font-size: 24px; color: var(--text-subtle); margin-bottom: 8px; display: block;">&#xf796;</i>
        Port & socket inspection is disabled for <strong>${escapeHtml(target.name)}</strong>.<br>
        <span style="color: var(--accent); cursor: pointer; text-decoration: underline; margin-top: 6px; display: inline-block;" onclick="window.openEditHostModal && window.openEditHostModal(getActiveTargetInfo().host)">Enable in Host Settings</span>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="docker-toolbar">
      <div class="docker-target-badge">
        <i class="fa">&#xf796;</i>
        <span>${target.name}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span id="ports-socket-count" style="font-size: 10px; color: var(--text-subtle);">Inspecting...</span>
        <button class="docker-refresh-btn" id="ports-refresh-btn" title="Refresh ports & sockets"><i class="fa">&#xf021;</i></button>
      </div>
    </div>

    <div class="ports-filter-bar">
      <button class="ports-filter-pill ${currentPortsFilter === 'all' ? 'active' : ''}" data-filter="all">All</button>
      <button class="ports-filter-pill ${currentPortsFilter === 'docker' ? 'active' : ''}" data-filter="docker">Docker</button>
      <button class="ports-filter-pill ${currentPortsFilter === 'loopback' ? 'active' : ''}" data-filter="loopback">127.0.0.1</button>
      <button class="ports-filter-pill ${currentPortsFilter === 'foreign' ? 'active' : ''}" data-filter="foreign">Foreign</button>
    </div>

    <div class="drawer-search" style="padding: 0; margin-bottom: 2px;">
      <input type="text" id="ports-search-input" class="search-input" placeholder="Filter port, process, PID..." value="${portsSearchText}">
    </div>

    <div id="ports-content-area" style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
      <div style="padding: 16px 10px; text-align: center; color: var(--text-subtle); font-size: 12px;">
        <i class="fa fa-spin">&#xf110;</i> Scanning network sockets...
      </div>
    </div>
  `;

  document.getElementById('ports-refresh-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    renderPortsDrawer();
  });

  container.querySelectorAll('.ports-filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.ports-filter-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentPortsFilter = pill.getAttribute('data-filter');
      renderPortsList();
    });
  });

  const searchInput = document.getElementById('ports-search-input');
  searchInput?.addEventListener('input', (e) => {
    portsSearchText = e.target.value.toLowerCase();
    renderPortsList();
  });

  if (target.host && target.host.enable_port_scan === false) {
    const area = document.getElementById('ports-content-area');
    if (area) {
      area.innerHTML = `
        <div style="padding: 24px 12px; text-align: center; color: var(--text-subtle); font-size: 11.5px;">
          Port Scanner is disabled for this host.<br>
          <span style="color: var(--accent); cursor: pointer; text-decoration: underline;" onclick="window.openEditHostModal && window.openEditHostModal(getActiveTargetInfo().host)">Enable in Host Settings</span>
        </div>
      `;
    }
    const countEl = document.getElementById('ports-socket-count');
    if (countEl) countEl.textContent = 'Disabled';
    return;
  }

  try {
    currentPortInspection = await invoke('get_port_inspection', { host: target.host });
    renderPortsList();
  } catch (err) {
    const area = document.getElementById('ports-content-area');
    if (area) {
      area.innerHTML = `
        <div style="padding: 16px 10px; text-align: center; color: var(--red); font-size: 11.5px;">
          Failed to scan ports: ${err}
        </div>
      `;
    }
  }
}

// ── Silent minimal CPU polling for Docker & PortScan ──
let isFetchingDocker = false;
async function refreshDockerSilent() {
  if (isFetchingDocker || activeCategory !== 'docker') return;
  const target = getActiveTargetInfo();
  if (target.host && target.host.has_docker === false) return;
  if (!target.isRemote && !isLocalDockerAvailable) return;
  const dockerPort = appConfig.settings?.docker_port || 2375;
  isFetchingDocker = true;
  try {
    const list = await invoke('get_docker_containers', {
      host: target.host,
      dockerPort: dockerPort,
    });
    if (Array.isArray(list)) {
      const statsMap = new Map();
      currentDockerContainers.forEach((prev) => {
        if (prev.id) statsMap.set(prev.id, { cpu: prev.cpu, memory: prev.memory });
      });
      list.forEach((newC) => {
        const cached = statsMap.get(newC.id);
        if (cached) {
          if (cached.cpu && cached.cpu !== '-') newC.cpu = cached.cpu;
          if (cached.memory && cached.memory !== '-') newC.memory = cached.memory;
        }
      });
      currentDockerContainers = list;
      renderDockerCards();
    }
  } catch (err) {
    // Keep existing cards
  } finally {
    isFetchingDocker = false;
  }
}

let isFetchingPorts = false;
async function refreshPortsSilent() {
  if (isFetchingPorts || activeCategory !== 'ports') return;
  const target = getActiveTargetInfo();
  if (target.host && target.host.enable_port_scan === false) return;
  isFetchingPorts = true;
  try {
    const res = await invoke('get_port_inspection', { host: target.host });
    if (res) {
      currentPortInspection = res;
      renderPortsList();
    }
  } catch (err) {
    // Keep existing list
  } finally {
    isFetchingPorts = false;
  }
}

function renderPortsList() {
  const area = document.getElementById('ports-content-area');
  const countEl = document.getElementById('ports-socket-count');
  if (!area || !currentPortInspection) return;

  const sockets = currentPortInspection.sockets || [];

  const filteredSockets = sockets.filter((s) => {
    const localAddr = s.local_addr || s.local_ip || '0.0.0.0';
    const foreignAddr = s.foreign_addr || s.remote_ip || '*';
    const foreignPort = s.foreign_port || s.remote_port || 0;
    const knownService = KNOWN_PORTS[s.local_port] || (foreignPort > 0 ? KNOWN_PORTS[foreignPort] : null);

    if (currentPortsFilter === 'docker' && !s.is_docker) return false;
    if (currentPortsFilter === 'loopback' && !s.is_loopback && !localAddr.includes('127.0.0.1') && !localAddr.includes('::1')) return false;
    if (currentPortsFilter === 'foreign') {
      if (s.state === 'LISTEN') return false;
      if (foreignAddr === '0.0.0.0' || foreignAddr === '*' || foreignAddr === '::') return false;
    }
    if (portsSearchText) {
      const matchPort = s.local_port.toString().includes(portsSearchText) || foreignPort.toString().includes(portsSearchText);
      const matchProc = (s.process_name || '').toLowerCase().includes(portsSearchText);
      const matchPid = (s.pid || '').toString().includes(portsSearchText);
      const matchIp = localAddr.includes(portsSearchText) || foreignAddr.includes(portsSearchText);
      const matchKnown = knownService ? knownService.toLowerCase().includes(portsSearchText) : false;
      return matchPort || matchProc || matchPid || matchIp || matchKnown;
    }
    return true;
  });

  if (countEl) {
    countEl.textContent = `${filteredSockets.length} of ${sockets.length} sockets`;
  }

  let html = '';
  if (filteredSockets.length === 0) {
    html += `
      <div style="padding: 16px 10px; text-align: center; color: var(--text-subtle); font-size: 11.5px;">
        No sockets match active filter.
      </div>
    `;
  } else {
    filteredSockets.forEach((s) => {
      const localAddr = s.local_addr || s.local_ip || '0.0.0.0';
      const foreignAddr = s.foreign_addr || s.remote_ip || '*';
      const foreignPort = s.foreign_port || s.remote_port || 0;
      const knownService = KNOWN_PORTS[s.local_port] || (foreignPort > 0 ? KNOWN_PORTS[foreignPort] : null);

      const isTcp = s.protocol.toUpperCase().startsWith('TCP');
      const isListen = s.state.toUpperCase() === 'LISTEN';
      const isEstab = s.state.toUpperCase().startsWith('ESTAB');
      const stateClass = isListen ? 'listen' : (isEstab ? 'estab' : 'other');
      const procStr = s.process_name ? `${s.process_name}${s.pid ? ` (${s.pid})` : ''}` : (s.pid ? `PID ${s.pid}` : 'System');

      html += `
        <div class="socket-row">
          <div class="socket-row-top">
            <span class="socket-proto-badge ${isTcp ? 'tcp' : 'udp'}">${s.protocol}</span>
            <span class="socket-endpoint" title="${localAddr}:${s.local_port}${knownService ? ` (${knownService})` : ''}">${localAddr}:${s.local_port}</span>
            <span class="socket-state-pill ${stateClass}">${s.state}</span>
          </div>
          <div class="socket-meta">
            <span class="socket-proc-name" title="${procStr}">
              ${procStr}
            </span>
            <div class="socket-meta-right">
              ${knownService ? `<span class="socket-known-tag" title="${escapeHtml(knownService)}">${escapeHtml(knownService)}</span>` : ''}
              ${s.is_docker ? `<span class="socket-docker-badge">Docker</span>` : ''}
              ${foreignPort > 0 ? `<span class="remote mono" title="Remote: ${foreignAddr}:${foreignPort}">→ ${foreignAddr}:${foreignPort}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    });
  }

  area.innerHTML = html;
}

// ── Notes & Aliases (Snippets) Drawer & Terminal Pasting ──
let snippetsSearchText = '';
let editingSnippetId = null;

function getActiveTerminalSessionId() {
  const activeTab = document.querySelector('.tab-card.active');
  const view = activeTab?.getAttribute('data-view') || 'local';
  if (view === 'local') return 'session-local';
  if (view.startsWith('local-') || view.startsWith('host-') || view.startsWith('docker-')) {
    return `session-${view}`;
  }
  return 'session-local';
}

function pasteToActiveTerminal(text) {
  const sessionId = getActiveTerminalSessionId();
  invoke('pty_write', { sessionId, data: text }).catch(console.error);
  const sess = terminalSessions[sessionId];
  if (sess && sess.term) {
    sess.term.focus();
  }
}

let copyToastTimeout = null;
function showCopyToast(msg) {
  let toast = document.getElementById('copy-toast-el');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'copy-toast-el';
    toast.className = 'copy-toast';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<i class="fa">&#xf0c5;</i> <span>${msg}</span>`;
  toast.classList.add('show');
  if (copyToastTimeout) clearTimeout(copyToastTimeout);
  copyToastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 1800);
}

function renderSnippetsDrawer() {
  const container = document.getElementById('drawer-snippets');
  if (!container) return;

  container.innerHTML = `
    <div class="drawer-search" style="padding: 0; margin-bottom: 6px;">
      <input type="text" id="snippets-search-input" class="search-input" placeholder="Search notes & aliases..." value="${escapeHtml(snippetsSearchText)}">
    </div>
    <div id="snippets-content-list" style="display: flex; flex-direction: column; gap: 6px; flex: 1; overflow-y: auto;">
    </div>
  `;

  const searchInput = document.getElementById('snippets-search-input');
  searchInput?.addEventListener('input', (e) => {
    snippetsSearchText = e.target.value.toLowerCase();
    renderSnippetsList();
  });

  renderSnippetsList();
}

function renderSnippetsList() {
  const list = document.getElementById('snippets-content-list');
  if (!list) return;

  const snippets = appConfig.snippets || [];
  const filtered = snippets.filter((s) => {
    if (!snippetsSearchText) return true;
    const titleMatch = s.title?.toLowerCase().includes(snippetsSearchText);
    const cmdMatch = s.command?.toLowerCase().includes(snippetsSearchText);
    const tagMatch = s.tags?.toLowerCase().includes(snippetsSearchText);
    return titleMatch || cmdMatch || tagMatch;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div style="padding: 24px 12px; text-align: center; color: var(--text-subtle); font-size: 11.5px;">
        ${snippets.length === 0 ? 'No notes or aliases configured yet.<br><span style="color: var(--accent); cursor: pointer; text-decoration: underline;" id="snippets-empty-add">+ Add Note / Alias</span>' : 'No matching notes or aliases found.'}
      </div>
    `;
    document.getElementById('snippets-empty-add')?.addEventListener('click', () => {
      document.getElementById('btn-open-add-snippet')?.click();
    });
    return;
  }

  list.innerHTML = '';
  filtered.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'snippet-card';
    card.setAttribute('data-id', s.id);
    card.setAttribute('title', 'Double-click: Paste to active terminal | Right-click: Copy to clipboard');

    const tagHtml = s.tags ? `<span class="snippet-tag">${escapeHtml(s.tags)}</span>` : '';
    card.innerHTML = `
      <div class="snippet-header">
        <span class="snippet-title">${escapeHtml(s.title)}</span>
        ${tagHtml}
      </div>
      <div class="snippet-cmd-row">
        <div class="snippet-cmd" title="${escapeHtml(s.command)}">${escapeHtml(s.command)}</div>
        <div class="snippet-actions">
          <button class="snippet-action-btn btn-edit" title="Edit note/alias"><i class="fa">&#xf044;</i></button>
          <button class="snippet-action-btn btn-del" title="Delete note/alias"><i class="fa">&#xf1f8;</i></button>
        </div>
      </div>
    `;

    // Single click -> select snippet card
    card.addEventListener('click', (e) => {
      if (e.target.closest('.snippet-actions')) return;
      document.querySelectorAll('.snippet-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });

    // Double-click -> paste directly into active terminal at cursor position
    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pasteToActiveTerminal(s.command);
      card.classList.add('flash-pasted');
      setTimeout(() => card.classList.remove('flash-pasted'), 450);
      showCopyToast('Pasted command to terminal');
    });

    // Single Right-click -> copy to clipboard (Native OS clipboard)
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSystemClipboardText(s.command).then(() => {
        showCopyToast('Copied to clipboard');
      }).catch(() => {
        showCopyToast('Copied to clipboard');
      });
    });

    // Edit button
    card.querySelector('.btn-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.openEditSnippetModal) {
        window.openEditSnippetModal(s);
      }
    });

    // Delete button
    card.querySelector('.btn-del')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete note/alias "${s.title}"?`)) {
        try {
          const updated = await invoke('delete_snippet', { id: s.id });
          if (updated) {
            appConfig = updated;
            renderSnippetsList();
          }
        } catch (err) {
          console.error('Failed to delete snippet:', err);
        }
      }
    });

    list.appendChild(card);
  });
}

function setupSnippetModal() {
  const modal = document.getElementById('modal-add-snippet');
  const openBtn = document.getElementById('btn-open-add-snippet');
  const closeBtn = document.getElementById('modal-snippet-close');
  const cancelBtn = document.getElementById('modal-snippet-cancel');
  const submitBtn = document.getElementById('modal-snippet-submit');
  const titleEl = document.getElementById('modal-snippet-title');

  const inputTitle = document.getElementById('snippet-form-title');
  const inputCmd = document.getElementById('snippet-form-command');
  const inputTags = document.getElementById('snippet-form-tags');

  const closeModal = () => modal?.classList.add('hidden');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      editingSnippetId = null;
      if (titleEl) titleEl.textContent = 'Add Note / Alias';
      if (inputTitle) inputTitle.value = '';
      if (inputCmd) inputCmd.value = '';
      if (inputTags) inputTags.value = '';
      modal?.classList.remove('hidden');
      setTimeout(() => inputTitle?.focus(), 50);
    });
  }

  window.openEditSnippetModal = (s) => {
    if (!modal) return;
    editingSnippetId = s.id;
    if (titleEl) titleEl.textContent = `Edit Note / Alias (${s.title})`;
    if (inputTitle) inputTitle.value = s.title || '';
    if (inputCmd) inputCmd.value = s.command || '';
    if (inputTags) inputTags.value = s.tags || '';
    modal.classList.remove('hidden');
    setTimeout(() => inputTitle?.focus(), 50);
  };

  submitBtn?.addEventListener('click', async () => {
    const title = inputTitle?.value.trim();
    const command = inputCmd?.value.trim();
    const tags = inputTags?.value.trim() || null;

    if (!title || !command) {
      alert('Please provide both a Title and Command / Note.');
      return;
    }

    const snippet = {
      id: editingSnippetId || `snip-${Date.now()}`,
      title,
      command,
      tags,
    };

    try {
      const updated = await invoke('save_snippet', { snippet });
      if (updated) {
        appConfig = updated;
        renderSnippetsList();
      }
      closeModal();
      showCopyToast(editingSnippetId ? 'Snippet updated' : 'Snippet added');
    } catch (err) {
      console.error('Failed to save snippet:', err);
      alert(`Error saving snippet: ${err}`);
    }
  });
}

// ── 7. Tabs & Views ──

function setupTabInteractivity() {
  const tabs = document.querySelectorAll('.tab-card');

  tabs.forEach((tab) => {
    tab.onclick = (e) => {
      if (e.target.classList.contains('tab-close')) return;
      document.querySelectorAll('.tab-card').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.getAttribute('data-view');

      if (view && view.startsWith('file-')) {
        const filePath = tab.getAttribute('data-file-path');
        const isRemote = tab.getAttribute('data-is-remote') === 'true';
        const hostId = tab.getAttribute('data-host-id');
        const host = hostId ? (appConfig.hosts || []).find((h) => h.id === hostId) : null;
        const fileName = tab.querySelector('.tab-title')?.textContent || 'file';

        if (filePath && (!currentlyOpenFile || currentlyOpenFile.path !== filePath)) {
          openEditorTab(fileName, filePath, isRemote, host);
        } else {
          switchView('editor');
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

          // If closing a dynamic host tab, extra local tab, or docker logs/exec tab, kill PTY session and remove pane
          if (view && (view.startsWith('host-') || view.startsWith('local-') || view.startsWith('docker-'))) {
            const sessionId = `session-${view}`;
            invoke('pty_close', { sessionId }).catch(console.error);
            if (terminalSessions[sessionId]) {
              try { terminalSessions[sessionId].term.dispose(); } catch (err) { }
              delete terminalSessions[sessionId];
            }
            document.getElementById(`${view}-pane`)?.remove();
          }

          tab.remove();
          updateHostStatusDots();
          if (wasActive && nextTab) {
            nextTab.click();
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

function switchView(view) {
  document.querySelectorAll('.view-pane').forEach((p) => p.classList.remove('active'));

  let activeSessionId = null;

  if (view === 'local') {
    document.getElementById('local-term-pane')?.classList.add('active');
    activeSessionId = 'session-local';
    initTerminalSession('session-local', 'terminal-container-local', appConfig.settings.default_shell || 'powershell');
    // Sync status bar
    const hName = document.getElementById('status-host-name');
    if (hName) hName.textContent = 'Local Machine';
    const sLat = document.getElementById('status-latency');
    if (sLat) sLat.textContent = getShellDisplayName(appConfig.settings.default_shell);
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
    const activeTab = document.querySelector('.tab-card.active');
    const filePath = activeTab?.getAttribute('data-file-path') || currentlyOpenFile?.path || 'No file';
    const displayFileName = filePath.split(/[\\/]/).pop() || filePath;
    const hName = document.getElementById('status-host-name');
    if (hName) hName.textContent = 'Local Editor';
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

  // Save active view to config.toml
  if (!appConfig.session) appConfig.session = {};
  appConfig.session.active_view = view;
  persistConfig();

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
  newTab.innerHTML = `
    <i class="fa">&#xf120;</i>
    <span class="tab-title">Shell ${count}</span>
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
      invoke('save_config', { config: appConfig }).catch((err) => {
        console.error('Failed to save section width to config:', err);
      });
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

// ── 9. Multi-Language Live Syntax Highlighting Code Editor ──
function highlightCode(code, lang = 'yaml') {
  const escapeHtml = (str) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = code.split('\n');
  const highlighted = lines.map((line) => {
    let comment = '';
    let mainLine = line;

    // Check for comment characters based on language
    let commentChar = '#';
    if (lang === 'rust' || lang === 'sql') {
      const slashIdx = line.indexOf('//');
      const dashIdx = line.indexOf('--');
      if (slashIdx !== -1) {
        commentChar = '//';
      } else if (dashIdx !== -1) {
        commentChar = '--';
      }
    }

    const commentIdx = line.indexOf(commentChar);
    if (commentIdx !== -1) {
      const before = line.slice(0, commentIdx);
      const sQuotes = (before.match(/'/g) || []).length;
      const dQuotes = (before.match(/"/g) || []).length;
      if (sQuotes % 2 === 0 && dQuotes % 2 === 0) {
        comment = line.slice(commentIdx);
        mainLine = before;
      }
    }

    let result = '';

    if (lang === 'yaml' || lang === 'toml') {
      const keyMatch = mainLine.match(/^(\s*(?:-\s*)?)([a-zA-Z0-9_\-\.]+)(\s*[:=])(.*)$/);
      if (keyMatch) {
        const [, indent, key, colon, rest] = keyMatch;
        result += escapeHtml(indent);
        result += `<span class="token-key">${escapeHtml(key)}</span>`;
        result += `<span class="token-punct">${colon}</span>`;

        let val = rest;
        if (val.length > 0) {
          val = escapeHtml(val);
          val = val.replace(/("(?:\\"|[^"])*"|'(?:\\'|[^'])*')/g, '<span class="token-str">$1</span>');
          val = val.replace(/\b(true|false|yes|no|null|on|off)\b/gi, '<span class="token-bool">$1</span>');
          val = val.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-num">$1</span>');
        }
        result += val;
      } else {
        let val = escapeHtml(mainLine);
        val = val.replace(/("(?:\\"|[^"])*"|'(?:\\'|[^'])*')/g, '<span class="token-str">$1</span>');
        val = val.replace(/\b(true|false|yes|no|null|on|off)\b/gi, '<span class="token-bool">$1</span>');
        val = val.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-num">$1</span>');
        result += val;
      }
    } else if (lang === 'sql') {
      let val = escapeHtml(mainLine);
      val = val.replace(/("(?:\\"|[^"])*"|'(?:\\'|[^'])*')/g, '<span class="token-str">$1</span>');
      val = val.replace(/\b(SELECT|FROM|WHERE|INSERT|INTO|UPDATE|DELETE|JOIN|LEFT|RIGHT|INNER|OUTER|GROUP|BY|ORDER|LIMIT|OFFSET|CREATE|TABLE|DROP|ALTER|ADD|COLUMN|PRIMARY|KEY|DEFAULT|NULL|NOT|AND|OR|AS|IN|ON|SET|VALUES|COUNT|SUM|AVG|MIN|MAX|DISTINCT|UNION|HAVING|EXISTS|CASE|WHEN|THEN|ELSE|END|PRAGMA|INDEX)\b/gi, '<span class="token-kw">$1</span>');
      val = val.replace(/\b(INTEGER|TEXT|REAL|BLOB|VARCHAR|BOOLEAN|DATETIME|INT|NUMERIC)\b/gi, '<span class="token-type">$1</span>');
      val = val.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-num">$1</span>');
      result += val;
    } else if (lang === 'python') {
      let val = escapeHtml(mainLine);
      val = val.replace(/("(?:\\"|[^"])*"|'(?:\\'|[^'])*')/g, '<span class="token-str">$1</span>');
      val = val.replace(/\b(def|class|import|from|return|if|elif|else|for|while|try|except|finally|with|as|pass|break|continue|lambda|yield|global|nonlocal|async|await|in|is|not|and|or)\b/g, '<span class="token-kw">$1</span>');
      val = val.replace(/\b(True|False|None)\b/g, '<span class="token-bool">$1</span>');
      val = val.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-num">$1</span>');
      result += val;
    } else if (lang === 'rust') {
      let val = escapeHtml(mainLine);
      val = val.replace(/("(?:\\"|[^"])*"|'(?:\\'|[^'])*')/g, '<span class="token-str">$1</span>');
      val = val.replace(/\b(fn|let|mut|struct|enum|impl|pub|trait|use|mod|type|match|if|else|loop|while|for|return|break|continue|unsafe|async|await|const|static|ref|where)\b/g, '<span class="token-kw">$1</span>');
      val = val.replace(/\b(String|str|u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64|bool|Option|Some|None|Result|Ok|Err|Vec|Self|self)\b/g, '<span class="token-type">$1</span>');
      val = val.replace(/\b(true|false)\b/g, '<span class="token-bool">$1</span>');
      val = val.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-num">$1</span>');
      result += val;
    } else if (lang === 'dockerfile') {
      let val = escapeHtml(mainLine);
      val = val.replace(/("(?:\\"|[^"])*"|'(?:\\'|[^'])*')/g, '<span class="token-str">$1</span>');
      val = val.replace(/^(\s*)(FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL)\b/gi, '$1<span class="token-kw">$2</span>');
      val = val.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-num">$1</span>');
      result += val;
    } else {
      // Bash, JSON, or generic
      let val = escapeHtml(mainLine);
      val = val.replace(/("(?:\\"|[^"])*"|'(?:\\'|[^'])*')/g, '<span class="token-str">$1</span>');
      val = val.replace(/\b(if|then|else|elif|fi|case|esac|for|while|until|do|done|function|return|exit|export|local|echo)\b/g, '<span class="token-kw">$1</span>');
      val = val.replace(/\b(true|false|null)\b/gi, '<span class="token-bool">$1</span>');
      val = val.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="token-num">$1</span>');
      result += val;
    }

    if (comment) {
      result += `<span class="token-comment">${escapeHtml(comment)}</span>`;
    }

    return result;
  });

  return highlighted.join('\n') + (code.endsWith('\n') ? ' ' : '');
}

function setupCodeEditor() {
  const textarea = document.getElementById('editor-textarea');
  const codeElem = document.getElementById('editor-code');
  const preElem = document.getElementById('editor-highlight');
  const gutter = document.getElementById('editor-gutter');
  const statusText = document.getElementById('editor-status-text');
  const linesBadge = document.getElementById('editor-lines-count');
  const saveBtn = document.querySelector('.editor-save-btn');

  if (!textarea || !gutter) return;

  function updateView() {
    const lines = textarea.value.split('\n').length;
    let gutterHtml = '';
    for (let i = 1; i <= lines; i++) {
      gutterHtml += `${i}\n`;
    }
    gutter.textContent = gutterHtml;
    if (linesBadge) {
      linesBadge.textContent = `${lines} lines`;
    }

    if (codeElem) {
      const currentLang = currentlyOpenFile?.language || 'yaml';
      codeElem.innerHTML = highlightCode(textarea.value, currentLang);
    }
  }

  textarea.addEventListener('scroll', () => {
    if (preElem) {
      preElem.scrollTop = textarea.scrollTop;
      preElem.scrollLeft = textarea.scrollLeft;
    }
    gutter.scrollTop = textarea.scrollTop;
  });

  textarea.addEventListener('input', () => {
    updateView();
    if (statusText) {
      statusText.innerHTML = '<span style="color: var(--orange);"><i class="fa">&#xf111;</i> Modified</span>';
    }
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      updateView();
      if (statusText) {
        statusText.innerHTML = '<span style="color: var(--orange);"><i class="fa">&#xf111;</i> Modified</span>';
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveBtn?.click();
    }
  });

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (currentlyOpenFile) {
        try {
          if (currentlyOpenFile.isRemote) {
            await invoke('write_remote_file', {
              host: currentlyOpenFile.host,
              remotePath: currentlyOpenFile.remotePath,
              content: textarea.value
            });
          } else {
            await invoke('write_local_file', {
              path: currentlyOpenFile.path || currentlyOpenFile,
              content: textarea.value
            });
          }
        } catch (err) {
          console.error('Failed to write file:', err);
          if (statusText) {
            statusText.innerHTML = `<span style="color: var(--red);"><i class="fa">&#xf00d;</i> Error: ${err}</span>`;
          }
          return;
        }
      }
      const origHtml = saveBtn.innerHTML;
      saveBtn.innerHTML = '<i class="fa" style="color: var(--green);">&#xf00c;</i> Saved';
      saveBtn.style.borderColor = 'var(--green)';
      if (statusText) {
        statusText.innerHTML = '<span style="color: var(--green);"><i class="fa">&#xf00c;</i> Saved</span>';
      }
      setTimeout(() => {
        saveBtn.innerHTML = origHtml;
        saveBtn.style.borderColor = 'var(--border)';
      }, 1500);
    });
  }

  updateView();
}

// ── Terminal Palette Parsers (iTerm2 .itermcolors & Termius JSON) ──
function parseItermColors(xmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  const rootDict = xmlDoc.querySelector('plist > dict');
  if (!rootDict) {
    throw new Error('Invalid .itermcolors format: missing plist root dict');
  }

  function extractRgb(dictElem) {
    let r = 0, g = 0, b = 0;
    const children = Array.from(dictElem.children);
    for (let i = 0; i < children.length; i++) {
      if (children[i].tagName.toLowerCase() === 'key') {
        const keyName = children[i].textContent.trim();
        const valElem = children[i + 1];
        if (valElem) {
          const num = parseFloat(valElem.textContent.trim()) || 0;
          if (keyName === 'Red Component') r = num;
          else if (keyName === 'Green Component') g = num;
          else if (keyName === 'Blue Component') b = num;
        }
      }
    }
    const toHex = (c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const colorMap = {};
  const children = Array.from(rootDict.children);
  for (let i = 0; i < children.length; i++) {
    if (children[i].tagName.toLowerCase() === 'key') {
      const keyName = children[i].textContent.trim();
      const valElem = children[i + 1];
      if (valElem && valElem.tagName.toLowerCase() === 'dict') {
        colorMap[keyName] = extractRgb(valElem);
      }
    }
  }

  if (Object.keys(colorMap).length === 0) {
    const keyRegex = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
    let match;
    while ((match = keyRegex.exec(xmlText)) !== null) {
      const keyName = match[1].trim();
      const dictContent = match[2];
      const getVal = (name) => {
        const m = new RegExp(`<key>${name}<\\/key>\\s*<(?:real|integer)>([^<]+)<\\/(?:real|integer)>`).exec(dictContent);
        return m ? parseFloat(m[1]) : 0;
      };
      const r = getVal('Red Component');
      const g = getVal('Green Component');
      const b = getVal('Blue Component');
      const toHex = (c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
      colorMap[keyName] = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  }

  return {
    background: colorMap['Background Color'] || '#1e1e1e',
    foreground: colorMap['Foreground Color'] || '#d4d4d4',
    cursor: colorMap['Cursor Color'] || colorMap['Foreground Color'] || '#ffffff',
    cursorAccent: colorMap['Cursor Text Color'] || colorMap['Background Color'] || '#000000',
    selectionBackground: colorMap['Selection Color'] || '#264f78',
    black: colorMap['Ansi 0 Color'] || '#000000',
    red: colorMap['Ansi 1 Color'] || '#cd3131',
    green: colorMap['Ansi 2 Color'] || '#0dbc79',
    yellow: colorMap['Ansi 3 Color'] || '#e5e510',
    blue: colorMap['Ansi 4 Color'] || '#2472c8',
    magenta: colorMap['Ansi 5 Color'] || '#bc3fbc',
    cyan: colorMap['Ansi 6 Color'] || '#11a8cd',
    white: colorMap['Ansi 7 Color'] || '#e5e5e5',
    brightBlack: colorMap['Ansi 8 Color'] || '#666666',
    brightRed: colorMap['Ansi 9 Color'] || '#f14c4c',
    brightGreen: colorMap['Ansi 10 Color'] || '#23d18b',
    brightYellow: colorMap['Ansi 11 Color'] || '#f5f543',
    brightBlue: colorMap['Ansi 12 Color'] || '#3b8eea',
    brightMagenta: colorMap['Ansi 13 Color'] || '#d670d6',
    brightCyan: colorMap['Ansi 14 Color'] || '#29b8db',
    brightWhite: colorMap['Ansi 15 Color'] || '#ffffff',
  };
}

function parseTermiusPalette(jsonText) {
  const data = JSON.parse(jsonText);
  const obj = data.theme || (Array.isArray(data) ? data[0] : data);
  if (!obj || typeof obj !== 'object') {
    throw new Error('Invalid Termius JSON palette');
  }

  const normalizeHex = (hex) => {
    if (!hex || typeof hex !== 'string') return null;
    let clean = hex.trim();
    if (!clean.startsWith('#')) clean = '#' + clean;
    return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean : null;
  };

  const theme = {
    background: normalizeHex(obj.background || obj.bg) || '#1e1e1e',
    foreground: normalizeHex(obj.foreground || obj.fg) || '#d4d4d4',
    cursor: normalizeHex(obj.cursor || obj.cursorColor) || '#ffffff',
    cursorAccent: normalizeHex(obj.cursorAccent || obj.cursorText) || '#000000',
    selectionBackground: normalizeHex(obj.selection || obj.selectionBackground) || '#264f78',
    black: normalizeHex(obj.black) || '#000000',
    red: normalizeHex(obj.red) || '#cd3131',
    green: normalizeHex(obj.green) || '#0dbc79',
    yellow: normalizeHex(obj.yellow) || '#e5e510',
    blue: normalizeHex(obj.blue) || '#2472c8',
    magenta: normalizeHex(obj.magenta) || '#bc3fbc',
    cyan: normalizeHex(obj.cyan) || '#11a8cd',
    white: normalizeHex(obj.white) || '#e5e5e5',
    brightBlack: normalizeHex(obj.brightBlack || obj.lightBlack) || '#666666',
    brightRed: normalizeHex(obj.brightRed || obj.lightRed) || '#f14c4c',
    brightGreen: normalizeHex(obj.brightGreen || obj.lightGreen) || '#23d18b',
    brightYellow: normalizeHex(obj.brightYellow || obj.lightYellow) || '#f5f543',
    brightBlue: normalizeHex(obj.brightBlue || obj.lightBlue) || '#3b8eea',
    brightMagenta: normalizeHex(obj.brightMagenta || obj.lightMagenta) || '#d670d6',
    brightCyan: normalizeHex(obj.brightCyan || obj.lightCyan) || '#29b8db',
    brightWhite: normalizeHex(obj.brightWhite || obj.lightWhite) || '#ffffff',
  };

  if (Array.isArray(obj.ansi) && obj.ansi.length >= 16) {
    const ansiKeys = [
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
    ];
    obj.ansi.slice(0, 16).forEach((c, idx) => {
      const h = normalizeHex(c);
      if (h) theme[ansiKeys[idx]] = h;
    });
  }

  return { name: obj.name || obj.title || 'Termius Imported', theme };
}

async function handlePaletteImport(fileContent, rawFileName) {
  const trimmed = (fileContent || '').trim();
  if (!trimmed) throw new Error('File is empty');

  let themeObj = null;
  let themeName = rawFileName.replace(/\.(itermcolors|json|plist)$/i, '');

  if (trimmed.startsWith('<')) {
    themeObj = parseItermColors(trimmed);
  } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const res = parseTermiusPalette(trimmed);
    themeObj = res.theme;
    if (res.name && res.name !== 'Termius Imported') {
      themeName = res.name;
    }
  } else {
    throw new Error('Unsupported format. Please select an iTerm2 (.itermcolors) or Termius (.json) file.');
  }

  const cleanId = 'custom_' + themeName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  THEMES[cleanId] = themeObj;

  if (!appConfig.settings.custom_themes) {
    appConfig.settings.custom_themes = {};
  }
  appConfig.settings.custom_themes[cleanId] = {
    name: themeName,
    theme: themeObj,
  };

  const termThemeSelect = document.getElementById('setting-terminal-theme');
  if (termThemeSelect) {
    let opt = termThemeSelect.querySelector(`option[value="${cleanId}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = cleanId;
      opt.textContent = `Custom: ${themeName}`;
      termThemeSelect.appendChild(opt);
    }
    termThemeSelect.value = cleanId;
  }

  applyTerminalTheme(cleanId);
  persistConfig(true);
  showToast(`✓ Imported and applied terminal palette: ${themeName}`, 'success');
}

// ── 10. Settings & Preferences View Wiring ──
function setupSettingsView() {
  // App UI theme dropdown
  const themeSelect = document.getElementById('setting-theme');
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      applyAppTheme(e.target.value);
    });
  }

  // Terminal color scheme dropdown
  const termThemeSelect = document.getElementById('setting-terminal-theme');
  if (termThemeSelect) {
    termThemeSelect.addEventListener('change', (e) => {
      applyTerminalTheme(e.target.value);
    });
  }

  // Terminal palette import button and file input
  const importBtn = document.getElementById('btn-import-palette');
  const paletteFileInput = document.getElementById('input-palette-file');
  if (importBtn && paletteFileInput) {
    importBtn.addEventListener('click', () => {
      paletteFileInput.value = '';
      paletteFileInput.click();
    });
    paletteFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        await handlePaletteImport(text, file.name);
      } catch (err) {
        console.error('Error importing palette:', err);
        showToast(`Failed to import palette: ${err.message || err}`, 'error');
      }
    });
  }

  // App UI font size dropdown
  const appFontSizeSelect = document.getElementById('setting-app-font-size');
  if (appFontSizeSelect) {
    appFontSizeSelect.addEventListener('change', (e) => {
      applyAppFontSize(e.target.value);
    });
  }

  // Terminal font size dropdown
  const termFontSizeSelect = document.getElementById('setting-terminal-font-size');
  if (termFontSizeSelect) {
    termFontSizeSelect.addEventListener('change', (e) => {
      applyTerminalFontSize(e.target.value);
    });
  }

  // Font family dropdown
  const fontSelect = document.getElementById('setting-font-family');
  if (fontSelect) {
    fontSelect.addEventListener('change', (e) => {
      applyFont(e.target.value);
    });
  }

  // Cursor style dropdown
  const cursorSelect = document.getElementById('setting-cursor-style');
  if (cursorSelect) {
    cursorSelect.addEventListener('change', (e) => {
      applyCursorStyle(e.target.value);
    });
  }

  // Scrollback lines input
  const scrollbackInput = document.getElementById('setting-scrollback');
  if (scrollbackInput) {
    scrollbackInput.addEventListener('change', (e) => {
      applyScrollback(e.target.value);
    });
  }

  // Shell selector
  const shellSelect = document.getElementById('setting-default-shell');
  if (shellSelect) {
    shellSelect.addEventListener('change', (e) => {
      appConfig.settings.default_shell = e.target.value;
    });
  }

  // External editor selector
  const extEditorSelect = document.getElementById('setting-external-editor');
  if (extEditorSelect) {
    extEditorSelect.addEventListener('change', (e) => {
      appConfig.settings.external_editor = e.target.value;
      updateExternalEditorLabel();
    });
  }

  // Docker / Podman port
  const dockerPortInput = document.getElementById('setting-docker-port');
  if (dockerPortInput) {
    dockerPortInput.addEventListener('change', (e) => {
      appConfig.settings.docker_port = parseInt(e.target.value) || 2375;
    });
  }


  // SSH Compression
  const compressionCheckbox = document.getElementById('setting-enable-ssh-compression');
  if (compressionCheckbox) {
    compressionCheckbox.addEventListener('change', (e) => {
      appConfig.settings.enable_ssh_compression = e.target.checked;
    });
  }

  // App Logs Toggle
  const appLogsCheckbox = document.getElementById('setting-enable-app-logs');
  if (appLogsCheckbox) {
    appLogsCheckbox.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      appConfig.settings.enable_app_logs = enabled;
      const railBtnLogs = document.getElementById('rail-btn-logs');
      if (railBtnLogs) railBtnLogs.style.display = enabled ? 'flex' : 'none';
      persistConfig(true);
      showToast(enabled ? 'App Logs menu enabled' : 'App Logs menu hidden', 'info');
    });
  }

  // Reset rail order button in Settings
  const resetRailBtn = document.getElementById('btn-reset-rail-order');
  if (resetRailBtn) {
    resetRailBtn.addEventListener('click', () => {
      applyRailOrder(DEFAULT_RAIL_ORDER);
      showToast('Left menu order reset to default', 'success');
    });
  }

  // Save button
  const saveBtn = document.getElementById('btn-save-settings');
  const statusMsg = document.getElementById('save-status-msg');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      try {
        if (appLogsCheckbox) {
          appConfig.settings.enable_app_logs = appLogsCheckbox.checked;
        }
        await invoke('save_config', { config: appConfig });
        if (statusMsg) {
          statusMsg.style.display = 'inline-block';
          setTimeout(() => {
            statusMsg.style.display = 'none';
          }, 2000);
        }
      } catch (err) {
        console.error('Failed to save settings:', err);
      }
    });
  }
}

// ── 11. Add / Edit Host Modal Wiring & Font Awesome Online Icon Picker ──
async function fetchFaSvg(iconName) {
  const clean = iconName.toLowerCase().replace(/[^a-z0-9_-]/g, '').trim();
  if (!clean) return null;
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/svgs/brands/${clean}.svg`,
    `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/svgs/solid/${clean}.svg`,
    `https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/svgs/regular/${clean}.svg`,
    `https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/${clean}.svg`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const svgText = await res.text();
        if (svgText && svgText.includes('<svg')) {
          return { name: clean, svg: svgText };
        }
      }
    } catch (e) { }
  }
  return null;
}

function searchIconsCatalog(query) {
  const list = window.ALL_ICONS || [];
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    return list;
  }

  const matched = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const id = item.id.toLowerCase();
    const lbl = item.label.toLowerCase();
    const terms = item.terms ? item.terms.toLowerCase() : '';

    let score = 0;
    if (id === q) score = 100;
    else if (lbl === q) score = 95;
    else if (id.startsWith(q)) score = 85;
    else if (lbl.startsWith(q)) score = 75;
    else if (id.includes(q)) score = 65;
    else if (lbl.includes(q)) score = 55;
    else if (terms.includes(q)) score = 45;

    if (score > 0) {
      matched.push({ item, score });
    }
  }

  matched.sort((a, b) => b.score - a.score);
  return matched.map((m) => m.item);
}

function setupAddHostModal() {
  const modal = document.getElementById('modal-add-host');
  const openBtn = document.getElementById('btn-open-add-host');
  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const submitBtn = document.getElementById('modal-submit-btn');
  const modalTitle = document.querySelector('#modal-add-host .modal-header span') || document.querySelector('#modal-add-host .modal-header h3');

  const authRadios = document.querySelectorAll('input[name="auth-type"]');
  const groupKeyPath = document.getElementById('group-key-path');
  const groupPassword = document.getElementById('group-password');

  const nameInput = document.getElementById('host-form-name');
  const ipInput = document.getElementById('host-form-ip');
  const portInput = document.getElementById('host-form-port');
  const userInput = document.getElementById('host-form-user');
  const iconInput = document.getElementById('host-form-icon');
  const iconSvgInput = document.getElementById('host-form-icon-svg');
  const iconGrid = document.getElementById('icon-picker-grid');
  const iconSearchInput = document.getElementById('fa-icon-search-input');
  const keyInput = document.getElementById('host-form-key');
  const btnBrowseKey = document.getElementById('btn-browse-ssh-key');
  const keyPermContainer = document.getElementById('key-perm-container');
  const keyPermBadge = document.getElementById('key-perm-badge');
  const keyPermText = document.getElementById('key-perm-text');
  const btnFixKeyPerm = document.getElementById('btn-fix-key-perm');
  const passwordInput = document.getElementById('host-form-password');
  const dockerInput = document.getElementById('host-form-docker');
  const portScanInput = document.getElementById('host-form-port-scan');
  const macInput = document.getElementById('host-form-mac');
  const networkRouteSelect = document.getElementById('host-form-network-route');

  function updateNetworkRouteOptions(selectedRoute = 'direct') {
    if (!networkRouteSelect) return;
    networkRouteSelect.innerHTML = `
      <option value="direct">Direct Connect (Standard)</option>
      <option value="mesh">Mesh / VPN Network (Use active Mesh/VPN)</option>
    `;
    networkRouteSelect.value = (selectedRoute === 'mesh' || (selectedRoute && selectedRoute !== 'direct')) ? 'mesh' : 'direct';
  }

  const previewName = document.getElementById('preview-host-name');
  const previewConn = document.getElementById('preview-host-conn');
  const previewGlyph = document.getElementById('preview-icon-glyph');

  let editingHostId = null;
  let activeIconMatches = [];
  let currentRenderedIndex = 0;
  const CHUNK_SIZE = 120;

  function updateLivePreview() {
    const name = nameInput?.value.trim() || 'new-host';
    const host = ipInput?.value.trim() || '192.168.1.100';
    const port = portInput?.value.trim() || '22';
    const user = userInput?.value.trim() || 'root';
    const icon = iconInput?.value || 'server';
    const svgVal = iconSvgInput?.value;

    if (previewName) previewName.textContent = name;
    if (previewConn) {
      previewConn.textContent = `${user}@${host}:${port}`;
    }

    if (previewGlyph) {
      if (svgVal) {
        previewGlyph.innerHTML = `<div style="display:inline-flex; width:16px; height:16px; align-items:center; justify-content:center; color: var(--text-muted);">${svgVal}</div>`;
        const s = previewGlyph.querySelector('svg');
        if (s) {
          s.style.width = '16px';
          s.style.height = '16px';
          s.style.fill = 'currentColor';
        }
      } else {
        previewGlyph.innerHTML = getHostIconHtml(icon, 'width: 16px; height: 16px;');
      }
    }
  }

  [nameInput, ipInput, portInput, userInput].forEach((input) => {
    input?.addEventListener('input', updateLivePreview);
  });

  function appendIconBatch() {
    if (!iconGrid || currentRenderedIndex >= activeIconMatches.length) return;

    const nextBatch = activeIconMatches.slice(currentRenderedIndex, currentRenderedIndex + CHUNK_SIZE);
    currentRenderedIndex += nextBatch.length;

    const fragment = document.createDocumentFragment();
    const curIcon = (iconInput?.value || '').toLowerCase();

    nextBatch.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'icon-picker-item';
      el.setAttribute('data-id', item.id);
      el.setAttribute('title', `${item.label} (${item.id}) [${item.src === 'simple-icons' ? 'Homelab' : 'Font Awesome'}]`);

      if (
        curIcon === item.id ||
        curIcon === `icons/${item.id}.svg` ||
        curIcon.endsWith(`/${item.id}.svg`) ||
        (item.id === 'server' && (curIcon === '&#xf233;' || !curIcon))
      ) {
        el.classList.add('active');
      }

      const w = item.w || 24;
      const h = item.h || 24;
      el.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}"><path fill="currentColor" d="${item.d}"/></svg>
        <span>${escapeHtml(item.label)}</span>
      `;
      el.addEventListener('click', () => selectIcon(item, el));
      fragment.appendChild(el);
    });

    iconGrid.appendChild(fragment);
  }

  function renderIconGrid(filterText = '') {
    if (!iconGrid) return;
    const query = filterText.toLowerCase().trim();
    iconGrid.innerHTML = '';
    currentRenderedIndex = 0;

    activeIconMatches = searchIconsCatalog(query);
    appendIconBatch();

    if (query && !activeIconMatches.some((m) => m.id === query)) {
      const customEl = document.createElement('div');
      customEl.className = 'icon-picker-item';
      customEl.setAttribute('data-id', query);
      customEl.setAttribute('title', `Search "${query}" online (Font Awesome / Simple Icons)`);
      customEl.innerHTML = `
        <svg viewBox="0 0 512 512"><path fill="currentColor" d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/></svg>
        <span>"${escapeHtml(query)}"</span>
      `;
      customEl.addEventListener('click', () => selectCustomOnlineIcon(query, customEl));
      iconGrid.appendChild(customEl);
    }
  }

  // Infinite progressive scroll handler
  iconGrid?.addEventListener('scroll', () => {
    if (iconGrid.scrollTop + iconGrid.clientHeight >= iconGrid.scrollHeight - 35) {
      appendIconBatch();
    }
  });

  function selectIcon(item, itemEl) {
    document.querySelectorAll('.icon-picker-item').forEach((i) => i.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');

    const w = item.w || 24;
    const h = item.h || 24;
    const svg = `<svg role="img" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><title>${escapeHtml(item.label || item.id)}</title><path fill="currentColor" d="${item.d}"/></svg>`;

    if (iconSvgInput) iconSvgInput.value = svg;
    if (iconInput) iconInput.value = item.id;
    updateLivePreview();
  }

  async function selectCustomOnlineIcon(query, itemEl) {
    document.querySelectorAll('.icon-picker-item').forEach((i) => i.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');

    if (previewGlyph) {
      previewGlyph.innerHTML = '<span style="font-size:12px;color:var(--accent);">Loading...</span>';
    }

    const fetched = await fetchFaSvg(query);
    if (fetched && fetched.svg) {
      if (iconSvgInput) iconSvgInput.value = fetched.svg;
      if (iconInput) iconInput.value = fetched.name;
    } else {
      if (iconSvgInput) iconSvgInput.value = '';
      if (iconInput) iconInput.value = query;
    }
    updateLivePreview();
  }

  let iconSearchTimer = null;
  iconSearchInput?.addEventListener('input', (e) => {
    if (iconSearchTimer) clearTimeout(iconSearchTimer);
    iconSearchTimer = setTimeout(() => {
      renderIconGrid(e.target.value);
    }, 60);
  });

  // Helper to check and display key permissions
  let keyPermCheckTimer = null;
  async function updateKeyPermissionUI(keyPath) {
    if (!keyPermContainer) return;
    const trimmed = (keyPath || '').trim();
    if (!trimmed) {
      keyPermContainer.style.display = 'none';
      return;
    }
    try {
      const status = await invoke('check_ssh_key_permissions', { path: trimmed });
      keyPermContainer.style.display = 'block';
      if (!status.exists) {
        keyPermBadge.style.borderColor = 'var(--border)';
        keyPermBadge.style.background = 'rgba(255, 255, 255, 0.03)';
        keyPermText.innerHTML = `<span style="color: var(--text-muted);"><i class="fa">&#xf05a;</i> Key file not found on disk yet</span>`;
        if (btnFixKeyPerm) btnFixKeyPerm.style.display = 'none';
      } else if (status.too_open) {
        keyPermBadge.style.borderColor = '#e5c07b';
        keyPermBadge.style.background = 'rgba(229, 192, 123, 0.12)';
        keyPermText.innerHTML = `<span style="color: #e5c07b; font-weight: 500;"><i class="fa">&#xf071;</i> ${escapeHtml(status.details || 'Permissions are too open')}</span>`;
        if (btnFixKeyPerm) {
          btnFixKeyPerm.style.display = 'inline-flex';
          btnFixKeyPerm.innerHTML = '<i class="fa">&#xf0ad;</i> Fix permissions';
        }
      } else {
        keyPermBadge.style.borderColor = 'var(--green)';
        keyPermBadge.style.background = 'rgba(152, 195, 121, 0.12)';
        keyPermText.innerHTML = `<span style="color: var(--green); font-weight: 500;"><i class="fa">&#xf00c;</i> ${escapeHtml(status.details || 'Permissions secure (owner only)')}</span>`;
        if (btnFixKeyPerm) btnFixKeyPerm.style.display = 'none';
      }
    } catch (err) {
      console.error('Error checking key permissions:', err);
      if (keyPermContainer) keyPermContainer.style.display = 'none';
    }
  }

  btnBrowseKey?.addEventListener('click', async () => {
    try {
      const picked = await invoke('pick_ssh_key_file');
      if (picked) {
        if (keyInput) keyInput.value = picked;
        await updateKeyPermissionUI(picked);
      }
    } catch (err) {
      console.error('Error picking SSH key file:', err);
      showToast(`Browse failed: ${err.message || err}`, 'error');
    }
  });

  keyInput?.addEventListener('input', () => {
    if (keyPermCheckTimer) clearTimeout(keyPermCheckTimer);
    keyPermCheckTimer = setTimeout(() => {
      updateKeyPermissionUI(keyInput.value);
    }, 200);
  });

  btnFixKeyPerm?.addEventListener('click', async () => {
    const p = keyInput?.value.trim();
    if (!p) return;
    try {
      btnFixKeyPerm.textContent = 'Fixing...';
      const status = await invoke('fix_ssh_key_permissions', { path: p });
      showToast('✓ SSH key permissions successfully secured', 'success');
      await updateKeyPermissionUI(p);
    } catch (err) {
      btnFixKeyPerm.innerHTML = '<i class="fa">&#xf0ad;</i> Fix permissions';
      showToast(`Failed to fix key permissions: ${err}`, 'error');
    }
  });

  // Open modal for Adding a new host
  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      editingHostId = null;
      if (modalTitle) modalTitle.textContent = 'Add SSH Host';
      if (nameInput) nameInput.value = '';
      if (ipInput) ipInput.value = '';
      if (portInput) portInput.value = '22';
      if (userInput) userInput.value = 'root';
      if (keyInput) keyInput.value = '.ssh/id_ed25519';
      if (passwordInput) passwordInput.value = '';
      if (iconInput) iconInput.value = 'server';
      if (iconSvgInput) iconSvgInput.value = '';
      if (iconSearchInput) iconSearchInput.value = '';
      if (dockerInput) dockerInput.checked = true;
      if (portScanInput) portScanInput.checked = true;
      if (macInput) macInput.value = '';
      updateNetworkRouteOptions('direct');

      const keyRadio = document.querySelector('input[name="auth-type"][value="key"]');
      if (keyRadio) keyRadio.checked = true;
      groupKeyPath?.classList.remove('hidden');
      groupPassword?.classList.add('hidden');

      renderIconGrid();
      modal.classList.remove('hidden');
      updateLivePreview();
      updateKeyPermissionUI(keyInput ? keyInput.value : '');
    });
  }

  // Open modal for Editing an existing host
  window.openEditHostModal = (h) => {
    if (!modal) return;
    editingHostId = h.id;
    if (modalTitle) modalTitle.textContent = `Edit Host (${h.name})`;
    if (nameInput) nameInput.value = h.name || '';
    if (ipInput) ipInput.value = h.host || '';
    if (portInput) portInput.value = h.port || 22;
    if (userInput) userInput.value = h.user || 'root';
    if (keyInput) keyInput.value = h.key_path || '.ssh/id_ed25519';
    if (passwordInput) passwordInput.value = h.password || '';
    if (iconInput) iconInput.value = h.icon || 'server';
    if (iconSvgInput) iconSvgInput.value = '';
    if (iconSearchInput) iconSearchInput.value = '';
    if (dockerInput) dockerInput.checked = h.has_docker !== false;
    if (portScanInput) portScanInput.checked = h.enable_port_scan !== false;
    if (macInput) macInput.value = h.mac_address || '';
    updateNetworkRouteOptions(h.network_route || 'direct');

    const isPw = h.auth_type === 'password';
    const targetRadio = document.querySelector(`input[name="auth-type"][value="${isPw ? 'password' : 'key'}"]`);
    if (targetRadio) targetRadio.checked = true;

    if (isPw) {
      groupKeyPath?.classList.add('hidden');
      groupPassword?.classList.remove('hidden');
      if (keyPermContainer) keyPermContainer.style.display = 'none';
    } else {
      groupKeyPath?.classList.remove('hidden');
      groupPassword?.classList.add('hidden');
      updateKeyPermissionUI(keyInput ? keyInput.value : '');
    }

    renderIconGrid();
    modal.classList.remove('hidden');
    updateLivePreview();
  };

  const closeModal = () => modal?.classList.add('hidden');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  // Auth type radio toggle
  authRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'key') {
        groupKeyPath?.classList.remove('hidden');
        groupPassword?.classList.add('hidden');
        updateKeyPermissionUI(keyInput ? keyInput.value : '');
      } else {
        groupKeyPath?.classList.add('hidden');
        groupPassword?.classList.remove('hidden');
        if (keyPermContainer) keyPermContainer.style.display = 'none';
      }
    });
  });

  // Submit Host Form
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const name = nameInput?.value.trim();
      const host = ipInput?.value.trim() || '';
      const port = parseInt(portInput?.value) || 22;
      const user = userInput?.value.trim() || 'root';
      const authType = document.querySelector('input[name="auth-type"]:checked')?.value || 'key';
      const keyPath = keyInput?.value.trim();
      const password = passwordInput?.value;
      let icon = iconInput?.value || 'server';
      const hasDocker = dockerInput?.checked || false;
      const enablePortScan = portScanInput ? portScanInput.checked : true;
      const macAddress = macInput?.value.trim() || null;

      if (!name || !host) {
        alert('Please provide a host name and target IP address.');
        return;
      }

      // Save icon vector SVG locally for caching, and record clean icon ID
      const svgVal = iconSvgInput?.value;
      if (svgVal) {
        const cleanName = (iconInput?.value || name || 'host').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        try {
          await invoke('save_host_icon', {
            name: cleanName,
            svgContent: svgVal,
          });
        } catch (err) {
          console.error('Failed to save host icon SVG cache:', err);
        }
        icon = cleanName;
      }

      const newHost = {
        id: editingHostId || `host-${Date.now()}`,
        name,
        host,
        port,
        user,
        auth_type: authType,
        key_path: authType === 'key' ? keyPath : null,
        password: authType === 'password' ? password : null,
        has_docker: hasDocker,
        enable_port_scan: enablePortScan,
        mac_address: macAddress,
        network_route: (networkRouteSelect ? networkRouteSelect.value : 'direct'),
        cloud_provider: null,
        cloud_project_id: null,
        cloud_zone: null,
        cloud_instance_id: null,
        icon,
      };

      if (authType === 'key' && keyPath) {
        try {
          const perm = await invoke('check_ssh_key_permissions', { path: keyPath });
          if (perm && perm.exists && perm.too_open) {
            await invoke('fix_ssh_key_permissions', { path: keyPath });
            showToast(`✓ Secured private key permissions for ${keyPath}`, 'success');
          }
        } catch (e) {
          console.warn('Could not auto-secure key permissions on save:', e);
        }
      }

      try {
        const updatedConfig = await invoke('add_host', { host: newHost });
        if (updatedConfig) {
          appConfig = updatedConfig;
          renderHostsList(updatedConfig.hosts);
          const activeTab = document.querySelector('.tab-card.active');
          const currentView = activeTab?.getAttribute('data-view') || 'local';
          updateDockerButtonState(currentView);
          updatePortsButtonState(currentView);
        }
        closeModal();
      } catch (err) {
        console.error('Error saving host:', err);
      }
    });
  }
}

// ── 12. Remote Host Telemetry Updates (Active Remote Tab Only, 3s Interval) ──
let isTelemetryPolling = false;
const hostTelemetryFailures = {};

async function updateRemoteTelemetry() {
  const activeTab = document.querySelector('.tab-card.active');
  const view = activeTab?.getAttribute('data-view');
  const statusRight = document.querySelector('.status-right');
  const fCpu = document.getElementById('footer-cpu');
  const fRam = document.getElementById('footer-ram');
  const fNetTx = document.getElementById('footer-net-tx');
  const fNetRx = document.getElementById('footer-net-rx');
  const fPing = document.getElementById('footer-ping-val');

  if (!view || !view.startsWith('host-')) {
    // On local shell or non-remote tab, keep status bar visible with muted idle placeholders
    if (fCpu) fCpu.textContent = `--`;
    if (fRam) fRam.textContent = `--`;
    if (fNetTx) fNetTx.textContent = `-- KB/s`;
    if (fNetRx) fNetRx.textContent = `-- KB/s`;
    if (fPing) { fPing.textContent = `--`; fPing.className = 'stat-val'; }
    return;
  }

  const hostId = view.replace('host-', '');
  const host = (appConfig.hosts || []).find((h) => h.id === hostId);
  if (!host) {
    if (fCpu) fCpu.textContent = `--`;
    if (fRam) fRam.textContent = `--`;
    if (fNetTx) fNetTx.textContent = `-- KB/s`;
    if (fNetRx) fNetRx.textContent = `-- KB/s`;
    if (fPing) { fPing.textContent = `--`; fPing.className = 'stat-val'; }
    return;
  }

  // Circuit breaker: skip if host is known offline or has accumulated failures
  if (window.hostAliveMap && window.hostAliveMap[hostId] === false) {
    if (fCpu) fCpu.textContent = `--`;
    if (fRam) fRam.textContent = `--`;
    if (fNetTx) fNetTx.textContent = `-- KB/s`;
    if (fNetRx) fNetRx.textContent = `-- KB/s`;
    if (fPing) { fPing.textContent = `--`; fPing.className = 'stat-val'; }
    return;
  }

  if ((hostTelemetryFailures[hostId] || 0) >= 3) {
    // Backoff: try once every 5 intervals
    if (Math.random() > 0.2) return;
  }

  if (isTelemetryPolling) return;
  isTelemetryPolling = true;

  try {
    const data = await invoke('get_remote_telemetry', { host });
    if (data) {
      hostTelemetryFailures[hostId] = 0;
      const cpu = parseFloat(data.cpu).toFixed(1);
      const ram = parseFloat(data.ram).toFixed(1);

      if (fCpu) fCpu.textContent = `${cpu}%`;
      if (fRam) fRam.textContent = `${ram}%`;

      if (fPing) {
        if (typeof data.ping_ms === 'number') {
          const ms = data.ping_ms;
          fPing.textContent = `${ms} ms`;
          fPing.className = 'stat-val ' + (ms < 100 ? 'ping-good' : (ms < 300 ? 'ping-medium' : 'ping-bad'));
        } else {
          fPing.textContent = `--`;
          fPing.className = 'stat-val';
        }
      }

      // Calculate network speeds
      const now = Date.now();
      const elapsedSec = (now - prevNetTime) / 1000;
      if (prevNetRx === 0) {
        // Initial sample baseline
        if (fNetTx) fNetTx.textContent = `0.0 KB/s`;
        if (fNetRx) fNetRx.textContent = `0.0 KB/s`;
      } else if (elapsedSec > 0 && data.net_rx >= prevNetRx) {
        const rxRate = (data.net_rx - prevNetRx) / elapsedSec;
        const txRate = (data.net_tx - prevNetTx) / elapsedSec;

        const fmt = (bytes) => {
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`;
          return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`;
        };

        const txStr = fmt(txRate);
        const rxStr = fmt(rxRate);

        if (fNetTx) fNetTx.textContent = txStr;
        if (fNetRx) fNetRx.textContent = rxStr;

        const fNet = document.getElementById('footer-net');
        if (fNet) fNet.textContent = `↑${txStr} ↓${rxStr}`;
      }

      prevNetRx = data.net_rx;
      prevNetTx = data.net_tx;
      prevNetTime = now;
    }
  } catch (e) {
    hostTelemetryFailures[hostId] = (hostTelemetryFailures[hostId] || 0) + 1;
    // Gracefully handle remote telemetry error or timeout
    if (fCpu) fCpu.textContent = `--`;
    if (fRam) fRam.textContent = `--`;
    if (fNetTx) fNetTx.textContent = `-- KB/s`;
    if (fNetRx) fNetRx.textContent = `-- KB/s`;
    if (fPing) { fPing.textContent = `--`; fPing.className = 'stat-val'; }
  } finally {
    isTelemetryPolling = false;
  }
}

// ── 12b. Wake-on-LAN (WoL) ──
async function sendWolPacket(mac, hostName) {
  if (!mac) {
    showToast('No MAC address configured for this host', 'error');
    return;
  }
  try {
    await invoke('send_wol_packet', { mac: mac, broadcastIp: null });
    showToast(`⚡ Magic packet sent to ${hostName || mac}`, 'success');
  } catch (err) {
    showToast(`Failed to send WoL packet: ${err}`, 'error');
  }
}


// ── 12c. SSH Port Forwarding (Tunnels) Drawer & Management ──
let currentTunnels = [];
let tunnelsFilterText = '';

async function renderTunnelsDrawer() {
  const container = document.getElementById('drawer-tunnels');
  if (!container) return;

  const listEl = document.getElementById('tunnels-cards-list');
  try {
    currentTunnels = await invoke('get_tunnels_status');
    renderTunnelCards();
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--red); font-size: 11.5px;">Failed to load tunnels: ${err}</div>`;
    }
  }
}

function formatTunnelBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function renderTunnelCards() {
  const listEl = document.getElementById('tunnels-cards-list');
  const countEl = document.getElementById('tunnels-count');
  if (!listEl) return;

  const activeCount = currentTunnels.filter((t) => t.is_active).length;
  if (countEl) {
    countEl.textContent = `${activeCount} Active`;
    countEl.style.color = activeCount > 0 ? 'var(--green)' : 'var(--text-subtle)';
  }

  const filtered = currentTunnels.filter((t) => {
    if (!tunnelsFilterText) return true;
    const nameMatch = t.name?.toLowerCase().includes(tunnelsFilterText);
    const hostMatch = t.host_name?.toLowerCase().includes(tunnelsFilterText);
    const portMatch = t.local_port?.toString().includes(tunnelsFilterText) || t.remote_port?.toString().includes(tunnelsFilterText);
    return nameMatch || hostMatch || portMatch;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 24px 12px; text-align: center; color: var(--text-subtle); font-size: 11.5px;">
        ${currentTunnels.length === 0 ? 'No SSH tunnels configured.<br><span style="color: var(--accent); cursor: pointer;" onclick="openAddTunnelModal()">+ Add Port Forwarding Tunnel</span>' : 'No matching tunnels.'}
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  filtered.forEach((t) => {
    const card = document.createElement('div');
    card.className = `tunnel-card ${t.is_active ? 'active' : ''} ${t.error ? 'error' : ''}`;
    card.setAttribute('data-id', t.id);

    card.innerHTML = `
      <div class="tunnel-header">
        <div class="tunnel-title-box">
          <span class="tunnel-status-dot"></span>
          <span class="tunnel-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
          <span class="tunnel-host-tag"><i class="fa">&#xf233;</i> ${escapeHtml(t.host_name)}</span>
        </div>
        <label class="tunnel-toggle-switch" title="${t.is_active ? 'Click to stop tunnel' : 'Click to start tunnel'}">
          <input type="checkbox" class="tunnel-toggle-checkbox" ${t.is_active ? 'checked' : ''}>
          <span class="tunnel-slider"></span>
        </label>
      </div>
      <div class="tunnel-route-box">
        <span class="tunnel-port-badge">127.0.0.1:${t.local_port}</span>
        <span class="tunnel-arrow">&#x2794;</span>
        <span class="tunnel-target-badge">${escapeHtml(t.remote_host)}:${t.remote_port}</span>
      </div>
      <div class="tunnel-stats-row">
        <div class="tunnel-io-stats">
          <span class="tunnel-io-item" title="Transferred up / down">
            <span style="color: var(--green);">&#x25B2;</span> ${formatTunnelBytes(t.bytes_tx)}
            <span style="color: var(--accent); margin-left: 4px;">&#x25BC;</span> ${formatTunnelBytes(t.bytes_rx)}
          </span>
          ${t.is_active ? `<span style="color: var(--text-muted);">&bull; ${t.active_connections || 0} conn</span>` : ''}
        </div>
        <div class="tunnel-actions">
          <button class="snippet-action-btn btn-edit tunnel-edit-btn" title="Edit tunnel"><i class="fa">&#xf044;</i></button>
          <button class="snippet-action-btn btn-del tunnel-del-btn" title="Delete tunnel"><i class="fa">&#xf1f8;</i></button>
        </div>
      </div>
      ${t.error ? `<div style="font-size: 10px; color: var(--red); padding-top: 2px;">Error: ${escapeHtml(t.error)}</div>` : ''}
    `;

    const toggleInput = card.querySelector('.tunnel-toggle-checkbox');
    toggleInput?.addEventListener('change', async (e) => {
      const willBeActive = e.target.checked;
      try {
        await invoke('toggle_tunnel', { tunnelId: t.id, active: willBeActive });
        t.is_active = willBeActive;
        renderTunnelsDrawer();
        showToast(willBeActive ? `Tunnel "${t.name}" active on port ${t.local_port}` : `Tunnel "${t.name}" stopped`, 'success');
      } catch (err) {
        e.target.checked = !willBeActive;
        showToast(`Failed to toggle tunnel: ${err}`, 'error');
      }
    });

    card.querySelector('.tunnel-edit-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTunnelModal(t);
    });

    card.querySelector('.tunnel-del-btn')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete tunnel "${t.name}"?`)) {
        try {
          await invoke('delete_tunnel', { tunnelId: t.id });
          currentTunnels = currentTunnels.filter((x) => x.id !== t.id);
          renderTunnelCards();
          showToast(`Tunnel "${t.name}" deleted`, 'success');
        } catch (err) {
          showToast(`Failed to delete tunnel: ${err}`, 'error');
        }
      }
    });

    listEl.appendChild(card);
  });
}

let editingTunnelId = null;

function openAddTunnelModal() {
  editingTunnelId = null;
  const modal = document.getElementById('modal-tunnel');
  const title = document.getElementById('modal-tunnel-title');
  const hostSelect = document.getElementById('tunnel-form-host');
  if (!modal || !hostSelect) return;

  if (title) title.textContent = 'Add Port Forwarding Tunnel';
  document.getElementById('tunnel-form-name').value = '';
  document.getElementById('tunnel-form-local-port').value = '8080';
  document.getElementById('tunnel-form-remote-host').value = '127.0.0.1';
  document.getElementById('tunnel-form-remote-port').value = '80';
  document.getElementById('tunnel-form-autostart').checked = false;

  hostSelect.innerHTML = (appConfig.hosts || []).map((h) =>
    `<option value="${h.id}">${escapeHtml(h.name)} (${escapeHtml(h.host)})</option>`
  ).join('');

  modal.classList.remove('hidden');
}
window.openAddTunnelModal = openAddTunnelModal;

function openEditTunnelModal(t) {
  editingTunnelId = t.id;
  const modal = document.getElementById('modal-tunnel');
  const title = document.getElementById('modal-tunnel-title');
  const hostSelect = document.getElementById('tunnel-form-host');
  if (!modal || !hostSelect) return;

  if (title) title.textContent = `Edit Tunnel (${t.name})`;
  document.getElementById('tunnel-form-name').value = t.name || '';
  document.getElementById('tunnel-form-local-port').value = t.local_port || 8080;
  document.getElementById('tunnel-form-remote-host').value = t.remote_host || '127.0.0.1';
  document.getElementById('tunnel-form-remote-port').value = t.remote_port || 80;
  document.getElementById('tunnel-form-autostart').checked = !!t.auto_start;

  hostSelect.innerHTML = (appConfig.hosts || []).map((h) =>
    `<option value="${h.id}" ${h.id === t.host_id ? 'selected' : ''}>${escapeHtml(h.name)} (${escapeHtml(h.host)})</option>`
  ).join('');

  modal.classList.remove('hidden');
}

function setupTunnelModal() {
  const modal = document.getElementById('modal-tunnel');
  const closeBtn = document.getElementById('modal-tunnel-close');
  const cancelBtn = document.getElementById('modal-tunnel-cancel');
  const submitBtn = document.getElementById('modal-tunnel-submit');
  const addBtn = document.getElementById('tunnel-add-btn');
  const refreshBtn = document.getElementById('tunnels-refresh-btn');
  const searchInput = document.getElementById('tunnels-search-input');

  addBtn?.addEventListener('click', openAddTunnelModal);
  refreshBtn?.addEventListener('click', renderTunnelsDrawer);

  searchInput?.addEventListener('input', (e) => {
    tunnelsFilterText = e.target.value.toLowerCase().trim();
    renderTunnelCards();
  });

  const closeModal = () => modal?.classList.add('hidden');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  submitBtn?.addEventListener('click', async () => {
    const name = document.getElementById('tunnel-form-name')?.value.trim();
    const hostId = document.getElementById('tunnel-form-host')?.value;
    const localPort = parseInt(document.getElementById('tunnel-form-local-port')?.value) || 8080;
    const remoteHost = document.getElementById('tunnel-form-remote-host')?.value.trim() || '127.0.0.1';
    const remotePort = parseInt(document.getElementById('tunnel-form-remote-port')?.value) || 80;
    const autoStart = document.getElementById('tunnel-form-autostart')?.checked || false;

    if (!name || !hostId) {
      alert('Please provide a tunnel name and select a target host.');
      return;
    }

    const tunnelConfig = {
      id: editingTunnelId || `tunnel-${Date.now()}`,
      name,
      host_id: hostId,
      local_port: localPort,
      remote_host: remoteHost,
      remote_port: remotePort,
      auto_start: autoStart,
    };

    try {
      await invoke('save_tunnel', { tunnel: tunnelConfig });
      closeModal();
      renderTunnelsDrawer();
      showToast(`Tunnel "${name}" saved`, 'success');
    } catch (err) {
      showToast(`Failed to save tunnel: ${err}`, 'error');
    }
  });
}

// ── 12d. Host Context Menu ──
let contextMenuTargetHost = null;

function showHostContextMenu(x, y, host) {
  const menu = document.getElementById('host-context-menu');
  if (!menu) return;
  contextMenuTargetHost = host;

  const wolItem = document.getElementById('host-ctx-wol');
  if (wolItem) {
    if (host.mac_address) {
      wolItem.style.display = 'flex';
      wolItem.title = `Wake on LAN (${host.mac_address})`;
    } else {
      wolItem.style.display = 'none';
    }
  }

  const menuWidth = 200;
  const menuHeight = 180;
  let posX = x;
  let posY = y;
  if (posX + menuWidth > window.innerWidth) posX = window.innerWidth - menuWidth - 8;
  if (posY + menuHeight > window.innerHeight) posY = window.innerHeight - menuHeight - 8;

  menu.style.left = `${Math.max(8, posX)}px`;
  menu.style.top = `${Math.max(8, posY)}px`;
  menu.classList.remove('hidden');
}

function setupHostContextMenu() {
  document.getElementById('host-ctx-connect')?.addEventListener('click', () => {
    document.getElementById('host-context-menu')?.classList.add('hidden');
    if (contextMenuTargetHost) connectToHost(contextMenuTargetHost);
  });


  document.getElementById('host-ctx-wol')?.addEventListener('click', () => {
    document.getElementById('host-context-menu')?.classList.add('hidden');
    if (contextMenuTargetHost && contextMenuTargetHost.mac_address) {
      sendWolPacket(contextMenuTargetHost.mac_address, contextMenuTargetHost.name);
    }
  });

  document.getElementById('host-ctx-edit')?.addEventListener('click', () => {
    document.getElementById('host-context-menu')?.classList.add('hidden');
    if (contextMenuTargetHost && window.openEditHostModal) {
      window.openEditHostModal(contextMenuTargetHost);
    }
  });

  document.getElementById('host-ctx-delete')?.addEventListener('click', async () => {
    document.getElementById('host-context-menu')?.classList.add('hidden');
    if (contextMenuTargetHost && confirm(`Delete host "${contextMenuTargetHost.name}"?`)) {
      try {
        const updated = await invoke('delete_host', { id: contextMenuTargetHost.id });
        if (updated) {
          appConfig = updated;
          renderHostsList(updated.hosts);
        }
      } catch (err) {
        console.error('Failed to delete host:', err);
      }
    }
  });
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

      if (btnOpenBuiltIn) btnOpenBuiltIn.style.display = isFile ? 'flex' : 'none';
      if (btnOpenExternal) btnOpenExternal.style.display = isFile ? 'flex' : 'none';
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
    if (sftpMode === 'remote' && sftpCurrentHost) {
      loadRemoteFiles(sftpCurrentHost, sftpCurrentPath);
    } else {
      loadLocalFiles(sftpCurrentPath);
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

// ── 13. Database Studio View Wiring ──
function setupDatabaseView() {
  const queryInput = document.getElementById('db-query-input');
  const runBtn = document.getElementById('db-run-query-btn');
  const refreshBtn = document.getElementById('db-refresh-tables-btn');

  if (runBtn && queryInput) {
    runBtn.addEventListener('click', () => {
      const sql = queryInput.value.trim();
      if (sql) {
        executeDbQuery(sql);
      }
    });

    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const sql = queryInput.value.trim();
        if (sql) {
          executeDbQuery(sql);
        }
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (currentDbFile) {
        loadDatabaseTables(currentDbFile);
      }
    });
  }
}

// ── 14. SFTP Explorer Controls ──
function setupSftpExplorer() {
  const upBtn = document.getElementById('sftp-up-btn');
  const refreshBtn = document.getElementById('sftp-refresh-btn');
  const searchInput = document.getElementById('sftp-search-input');

  if (upBtn) {
    upBtn.addEventListener('click', () => {
      sftpGoUp();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (sftpMode === 'remote' && sftpCurrentHost) {
        loadRemoteFiles(sftpCurrentHost, sftpCurrentPath);
      } else {
        loadLocalFiles(sftpCurrentPath);
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const rows = document.querySelectorAll('#sftp-file-list .file-row');
      rows.forEach((row) => {
        const nameSpan = row.querySelector('.file-name');
        const text = (nameSpan ? nameSpan.textContent : row.textContent).toLowerCase();
        row.style.display = text.includes(query) ? 'flex' : 'none';
      });
    });
  }

  // Editable path input
  const pathInput = document.getElementById('sftp-current-path');
  if (pathInput) {
    pathInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const targetPath = pathInput.value.trim();
        if (!targetPath) return;

        if (sftpMode === 'remote') {
          if (!sftpCurrentHost) {
            showCopyToast('No active remote host selected');
            return;
          }
          // Validate remote directory existence before navigating
          try {
            const res = await invoke('list_remote_files', { host: sftpCurrentHost, remotePath: targetPath });
            const files = Array.isArray(res) ? res : (res?.files || []);
            if (res && res.current_path) {
              sftpCurrentPath = res.current_path;
              sftpRemotePaths[sftpCurrentHost.id] = sftpCurrentPath;
              pathInput.value = sftpCurrentPath;
            } else {
              sftpCurrentPath = targetPath;
              sftpRemotePaths[sftpCurrentHost.id] = targetPath;
            }
            renderSftpFileList(files, true, sftpCurrentHost);
            pathInput.blur();
          } catch (err) {
            showCopyToast(`Path does not exist: ${err}`);
            pathInput.value = sftpCurrentPath;
          }
        } else {
          // Local mode
          try {
            const files = await invoke('list_local_files', { dirPath: targetPath });
            sftpCurrentPath = targetPath;
            pathInput.value = sftpCurrentPath;
            renderSftpFileList(files, false, null);
            pathInput.blur();
          } catch (err) {
            showCopyToast(`Path does not exist: ${err}`);
            pathInput.value = sftpCurrentPath;
          }
        }
      } else if (e.key === 'Escape') {
        pathInput.value = sftpCurrentPath;
        pathInput.blur();
      }
    });
  }
}

// ── File Explorer Column Customization & Resizers ──
let fileColConfig = {
  date: true,
  size: true,
  type: false,
  perms: false,
};

function applyFileColumnVisibility() {
  const drawerFiles = document.getElementById('drawer-files');
  if (!drawerFiles) return;

  const cols = ['date', 'size', 'type', 'perms'];
  let allSecondaryHidden = true;
  cols.forEach((col) => {
    const isVisible = fileColConfig[col] === true;
    if (isVisible) allSecondaryHidden = false;
    drawerFiles.classList.toggle(`hide-col-${col}`, !isVisible);
    const checkEl = document.getElementById(`check-col-${col}`);
    if (checkEl) {
      checkEl.textContent = isVisible ? '✓' : '';
    }
  });

  const resizerName = document.getElementById('resizer-col-name');
  if (resizerName) {
    resizerName.style.display = allSecondaryHidden ? 'none' : '';
  }
}

function setupSftpColumnContextMenu() {
  const menu = document.getElementById('sftp-col-context-menu');
  if (!menu) return;

  const handleToggle = (item) => {
    const colAction = item.getAttribute('data-col-action');
    const colTarget = item.getAttribute('data-col-target');

    if (colAction === 'only-name') {
      fileColConfig = {
        date: false,
        size: false,
        type: false,
        perms: false,
      };
    } else if (colTarget && colTarget !== 'name') {
      fileColConfig[colTarget] = !fileColConfig[colTarget];
    }

    if (!appConfig.file_explorer) appConfig.file_explorer = {};
    appConfig.file_explorer.col_date = fileColConfig.date;
    appConfig.file_explorer.col_size = fileColConfig.size;
    appConfig.file_explorer.col_type = fileColConfig.type;
    appConfig.file_explorer.col_perms = fileColConfig.perms;
    persistConfig(true);

    applyFileColumnVisibility();
    menu.classList.add('hidden');
  };

  menu.querySelectorAll('.context-menu-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleToggle(item);
    });
  });
}

function setupSftpColumnResizers() {
  const container = document.getElementById('drawer-files') || document.getElementById('left-drawer');
  if (!container) return;

  // Restore saved column widths from config.toml
  const initialDateW = appConfig?.file_explorer?.width_date || appConfig?.settings?.sftp_col_date_width || 105;
  const initialSizeW = appConfig?.file_explorer?.width_size || appConfig?.settings?.sftp_col_size_width || 55;
  const initialTypeW = appConfig?.file_explorer?.width_type || 50;
  const initialPermsW = appConfig?.file_explorer?.width_perms || 75;

  container.style.setProperty('--col-date-w', `${initialDateW}px`);
  container.style.setProperty('--col-size-w', `${initialSizeW}px`);
  container.style.setProperty('--col-type-w', `${initialTypeW}px`);
  container.style.setProperty('--col-perms-w', `${initialPermsW}px`);

  function saveColWidths() {
    if (!appConfig.file_explorer) appConfig.file_explorer = {};
    appConfig.file_explorer.width_date = parseInt(container.style.getPropertyValue('--col-date-w')) || 105;
    appConfig.file_explorer.width_size = parseInt(container.style.getPropertyValue('--col-size-w')) || 55;
    appConfig.file_explorer.width_type = parseInt(container.style.getPropertyValue('--col-type-w')) || 50;
    appConfig.file_explorer.width_perms = parseInt(container.style.getPropertyValue('--col-perms-w')) || 75;
    persistConfig(false);
  }

  function getVisibleFileColumns() {
    const allCols = ['date', 'size', 'type', 'perms'];
    return allCols.filter((col) => fileColConfig[col] === true);
  }

  function bindResizer(resizer, onStart, onDrag, onEnd) {
    if (!resizer) return;
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const startX = e.clientX;
      if (onStart) onStart();

      function onMouseMove(moveEvent) {
        const deltaX = moveEvent.clientX - startX;
        onDrag(deltaX);
      }

      function onMouseUp() {
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (onEnd) onEnd();
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // 1. Resizer between 'Name' and the first visible secondary column (left side of that column)
  const resizerName = document.getElementById('resizer-col-name');
  if (resizerName) {
    let targetCol = null;
    let startW = 60;
    bindResizer(
      resizerName,
      () => {
        const visible = getVisibleFileColumns();
        targetCol = visible.length > 0 ? visible[0] : null;
        if (targetCol) {
          startW = parseInt(getComputedStyle(container).getPropertyValue(`--col-${targetCol}-w`)) || 60;
        }
      },
      (deltaX) => {
        if (!targetCol) return;
        // Dragging left (deltaX < 0) expands the column from its left edge
        // Dragging right (deltaX > 0) shrinks the column from its left edge
        const newW = Math.max(25, Math.min(350, startW - deltaX));
        container.style.setProperty(`--col-${targetCol}-w`, `${newW}px`);
      },
      () => {
        saveColWidths();
      }
    );
  }

  // 2. Resizers for secondary columns (both sides supported)
  const secondaryCols = ['date', 'size', 'type', 'perms'];
  secondaryCols.forEach((col) => {
    const resizer = document.getElementById(`resizer-col-${col}`);
    if (!resizer) return;

    let nextCol = null;
    let startLeftW = 60;
    let startRightW = 60;
    let isLastVisible = false;

    bindResizer(
      resizer,
      () => {
        const visible = getVisibleFileColumns();
        const colIdx = visible.indexOf(col);
        if (colIdx === -1) {
          nextCol = null;
          isLastVisible = false;
          return;
        }

        startLeftW = parseInt(getComputedStyle(container).getPropertyValue(`--col-${col}-w`)) || 60;

        if (colIdx + 1 < visible.length) {
          nextCol = visible[colIdx + 1];
          startRightW = parseInt(getComputedStyle(container).getPropertyValue(`--col-${nextCol}-w`)) || 60;
          isLastVisible = false;
        } else {
          nextCol = null;
          isLastVisible = true;
        }
      },
      (deltaX) => {
        if (isLastVisible) {
          // col is the rightmost visible column - dragging right expands it from right side
          const newW = Math.max(25, Math.min(350, startLeftW + deltaX));
          container.style.setProperty(`--col-${col}-w`, `${newW}px`);
        } else if (nextCol) {
          // Divider sits between 'col' (left) and 'nextCol' (right)
          // Dragging right expands col (its right side) and shrinks nextCol (its left side)
          // Dragging left shrinks col (its right side) and expands nextCol (its left side)
          let finalLeftW = startLeftW + deltaX;
          let finalRightW = startRightW - deltaX;

          if (finalLeftW < 25) {
            finalRightW += (finalLeftW - 25);
            finalLeftW = 25;
          }
          if (finalRightW < 25) {
            finalLeftW += (finalRightW - 25);
            finalRightW = 25;
          }

          finalLeftW = Math.max(25, Math.min(350, finalLeftW));
          finalRightW = Math.max(25, Math.min(350, finalRightW));

          container.style.setProperty(`--col-${col}-w`, `${finalLeftW}px`);
          container.style.setProperty(`--col-${nextCol}-w`, `${finalRightW}px`);
        }
      },
      () => {
        saveColWidths();
      }
    );
  });
}

function setupAutoHideScrollbars() {
  // Capture all scroll events across document to show scrollbar thumb and auto-hide 900ms after scroll ends
  document.addEventListener('scroll', (e) => {
    const el = e.target;
    if (!el || !el.classList) return;
    el.classList.add('has-active-scroll');
    if (el._scrollHideTimer) clearTimeout(el._scrollHideTimer);
    el._scrollHideTimer = setTimeout(() => {
      el.classList.remove('has-active-scroll');
      el._scrollHideTimer = null;
    }, 900);
  }, { passive: true, capture: true });
}

let discoveredShells = [];

function getShellDisplayName(shellId) {
  if (!shellId) return 'PowerShell';
  if (shellId === 'cmd') return 'CMD';
  if (shellId === 'git-bash' || shellId === 'bash') return 'Git Bash';
  if (shellId === 'pwsh') return 'PowerShell 7';
  if (shellId === 'wsl') return 'WSL';
  const found = discoveredShells.find((s) => s.id === shellId);
  return found ? found.name : shellId;
}

async function loadAvailableShells() {
  const select = document.getElementById('setting-default-shell');
  try {
    const shells = await invoke('get_available_shells');
    if (Array.isArray(shells) && shells.length > 0) {
      discoveredShells = shells;
      if (select) {
        select.innerHTML = '';
        shells.forEach((sh) => {
          const opt = document.createElement('option');
          opt.value = sh.id;
          opt.textContent = sh.name;
          select.appendChild(opt);
        });
        const currentVal = appConfig?.settings?.default_shell || 'powershell';
        if (!shells.some((s) => s.id === currentVal)) {
          const opt = document.createElement('option');
          opt.value = currentVal;
          opt.textContent = currentVal;
          select.appendChild(opt);
        }
        select.value = currentVal;
      }
    }
  } catch (err) {
    console.error('Failed to discover available shells:', err);
  }
}

let discoveredEditors = [];

async function loadExternalEditors() {
  const select = document.getElementById('setting-external-editor');
  try {
    const editors = await invoke('discover_external_editors');
    if (Array.isArray(editors) && editors.length > 0) {
      discoveredEditors = editors;
      if (select) {
        select.innerHTML = '<option value="auto">Auto-detect (Zed / Code / Notepad++)</option>';
        editors.forEach((ed) => {
          const opt = document.createElement('option');
          opt.value = ed.path;
          const displayCmd = (ed.path && (ed.path === ed.id || (!ed.path.includes('\\') && !ed.path.includes('/'))))
            ? ` (${ed.path})`
            : '';
          opt.textContent = `${ed.name}${displayCmd}`;
          select.appendChild(opt);
        });
        if (appConfig.settings.external_editor) {
          select.value = appConfig.settings.external_editor;
        }
      }
      updateExternalEditorLabel();
    }
  } catch (err) {
    console.error('Failed to discover external editors:', err);
  }
}

function updateExternalEditorLabel() {
  const label = document.getElementById('sftp-ctx-external-label');
  if (!label) return;
  const currentVal = appConfig.settings.external_editor || 'auto';
  if (currentVal === 'auto') {
    const defaultEd = discoveredEditors[0];
    label.textContent = defaultEd ? `Edit in ${defaultEd.name}` : 'Edit in External Editor';
  } else {
    const matched = discoveredEditors.find((e) => e.path === currentVal || e.id === currentVal);
    label.textContent = matched ? `Edit in ${matched.name}` : `Edit in ${currentVal}`;
  }
}

function showToast(message, type = 'info') {
  const existing = document.querySelectorAll('.taris-toast');
  existing.forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'taris-toast';
  let iconHtml = '<i class="fa" style="color: var(--accent);">&#xf05a;</i>';
  if (type === 'success') {
    iconHtml = '<i class="fa" style="color: var(--green);">&#xf00c;</i>';
    toast.style.borderLeftColor = 'var(--green)';
  } else if (type === 'error') {
    iconHtml = '<i class="fa" style="color: var(--red);">&#xf06a;</i>';
    toast.style.borderLeftColor = 'var(--red)';
  } else if (type === 'sync') {
    iconHtml = '<i class="fa fa-spin" style="color: var(--cyan);">&#xf021;</i>';
    toast.style.borderLeftColor = 'var(--cyan)';
  }

  toast.innerHTML = `${iconHtml}<span>${message}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

async function openFileInExternalEditor(file, isRemote, host) {
  try {
    const editorPref = appConfig.settings.external_editor;
    const editorPath = (editorPref && editorPref !== 'auto') ? editorPref : null;

    showToast(`Opening '${file.name}' in external editor...`, 'sync');

    const res = await invoke('open_in_external_editor', {
      host: isRemote ? host : null,
      remotePath: isRemote ? file.path : null,
      localPath: isRemote ? null : file.path,
      editorPath: editorPath,
    });

    showToast(res || `Opened ${file.name} in external editor`, 'success');
  } catch (err) {
    console.error('External editor error:', err);
    showToast(`Failed to open external editor: ${err}`, 'error');
  }
}

// ── 16. Multi-Threaded Transfers & Clipboard Paste ──
async function downloadRemoteFile(file, host) {
  try {
    const transferId = 'dl-' + Date.now();
    showToast(`Downloading '${file.name}'...`, 'sync');
    await invoke('sftp_download_file', {
      transferId,
      host,
      remotePath: file.path,
      localDestDir: '.',
    });
    showToast(`Downloaded '${file.name}' to local workspace.`, 'success');
    if (sftpMode === 'local') {
      loadLocalFiles(sftpCurrentPath);
    }
  } catch (err) {
    console.error('Download error:', err);
    showToast(`Download failed: ${err}`, 'error');
  }
}

async function pasteClipboardFiles(targetDir) {
  try {
    const files = await invoke('get_clipboard_files');
    if (!files || files.length === 0) {
      showToast('Clipboard has no files copied from Windows Explorer.', 'info');
      return;
    }

    const cleanDestDir = targetDir || sftpCurrentPath || '.';
    showToast(`Pasting ${files.length} file(s)...`, 'sync');

    if (sftpMode === 'remote' && sftpCurrentHost) {
      for (const filePath of files) {
        const transferId = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const fileName = filePath.split(/[\\/]/).pop();
        showToast(`Uploading ${fileName}...`, 'sync');
        await invoke('sftp_upload_file', {
          transferId,
          host: sftpCurrentHost,
          localPath: filePath,
          remoteDestDir: cleanDestDir,
        });
      }
      showToast(`Uploaded ${files.length} file(s) via SFTP.`, 'success');
      loadRemoteFiles(sftpCurrentHost, cleanDestDir);
    } else {
      const copied = await invoke('copy_local_files', {
        sourcePaths: files,
        destDir: cleanDestDir,
      });
      showToast(`Copied ${copied.length} file(s) locally.`, 'success');
      loadLocalFiles(cleanDestDir);
    }
  } catch (err) {
    console.error('Paste error:', err);
    showToast(`Paste failed: ${err}`, 'error');
  }
}

async function deleteSftpItem(item) {
  if (!item || !item.file) return;

  const isDir = !!item.file.is_dir;
  const typeName = isDir ? 'folder' : 'file';
  const targetName = item.file.name;
  const targetPath = item.file.path;
  const locationDesc = item.isRemote ? `from remote host (${item.host?.name || 'remote'})` : 'from local disk';

  const confirmed = window.confirm(`Are you sure you want to delete the ${typeName} "${targetName}" ${locationDesc}?\n\nThis action cannot be undone.`);
  if (!confirmed) return;

  try {
    showToast(`Deleting ${typeName} '${targetName}'...`, 'sync');
    if (item.isRemote) {
      if (!item.host) {
        showToast('No active remote host selected', 'error');
        return;
      }
      await invoke('delete_remote_file', {
        host: item.host,
        remotePath: targetPath,
      });
      showToast(`Deleted remote ${typeName} '${targetName}'`, 'success');
      loadRemoteFiles(item.host, sftpCurrentPath);
    } else {
      await invoke('delete_local_file', {
        path: targetPath,
      });
      showToast(`Deleted local ${typeName} '${targetName}'`, 'success');
      loadLocalFiles(sftpCurrentPath);
    }
    selectedSftpItem = null;
  } catch (err) {
    console.error('Delete error:', err);
    showToast(`Failed to delete ${typeName}: ${err}`, 'error');
  }
}

function triggerCurrentMenuRefresh() {
  // 1. Check active tab view first (e.g. database query)
  const activeTab = document.querySelector('.tab-card.active');
  const view = activeTab?.getAttribute('data-view') || '';

  if (view === 'db' || view.startsWith('db-')) {
    const runBtn = document.getElementById('db-run-query-btn');
    if (runBtn) {
      runBtn.click();
      showToast('Database refreshed', 'info');
      return true;
    }
  }

  // 2. Check active drawer category
  if (activeCategory === 'files') {
    if (sftpMode === 'remote' && sftpCurrentHost) {
      loadRemoteFiles(sftpCurrentHost, sftpCurrentPath);
      showToast(`Refreshed files: ${sftpCurrentHost.name}`, 'info');
    } else {
      loadLocalFiles(sftpCurrentPath);
      showToast('Refreshed local files', 'info');
    }
    return true;
  }

  if (activeCategory === 'docker') {
    const refreshBtn = document.getElementById('docker-refresh-btn');
    if (refreshBtn) {
      refreshBtn.click();
    } else {
      renderDockerDrawer();
    }
    showToast('Refreshed Docker containers', 'info');
    return true;
  }

  if (activeCategory === 'ports') {
    const refreshBtn = document.getElementById('ports-refresh-btn');
    if (refreshBtn) {
      refreshBtn.click();
    } else {
      renderPortsDrawer();
    }
    showToast('Refreshed network ports', 'info');
    return true;
  }

  if (activeCategory === 'tunnels') {
    renderTunnelsDrawer();
    showToast('Refreshed port forwarding tunnels', 'info');
    return true;
  }

  if (activeCategory === 'cloud') {
    clearCloudCache(currentCloudProvider);
    renderCloudDrawer(true);
    showToast('Refreshed cloud projects & instances', 'info');
    return true;
  }

  if (activeCategory === 'hosts') {
    pollHostsAlive();
    showToast('Refreshed hosts status', 'info');
    return true;
  }

  return false;
}

function setupSftpClipboardListener() {
  const sftpSection = document.getElementById('drawer-files');
  if (!sftpSection) return;

  let isHoveringSftp = false;
  let isSftpActive = false;

  sftpSection.addEventListener('mouseenter', () => { isHoveringSftp = true; });
  sftpSection.addEventListener('mouseleave', () => { isHoveringSftp = false; });
  sftpSection.addEventListener('mousemove', () => { isHoveringSftp = true; });

  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#drawer-files, #sftp-context-menu')) {
      isSftpActive = true;
    } else {
      isSftpActive = false;
    }
  });

  window.addEventListener('keydown', (e) => {
    // Intercept Ctrl+R and F5 to disable app reload / restart
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') || e.key === 'F5') {
      e.preventDefault();
      e.stopPropagation();
      triggerCurrentMenuRefresh();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.id === 'editor-textarea')) {
        return;
      }
      const inSftp = isHoveringSftp || isSftpActive || active?.closest('#drawer-files');
      if (inSftp) {
        e.preventDefault();
        e.stopPropagation();
        pasteClipboardFiles(sftpCurrentPath);
      }
    }

    if (e.key === 'Delete' || e.key === 'Del') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable || active.id === 'editor-textarea')) {
        return;
      }
      const inSftp = isHoveringSftp || isSftpActive || active?.closest('#drawer-files');
      if (inSftp) {
        const selectedRow = document.querySelector('#sftp-file-list .file-row.selected');
        const itemToDelete = selectedSftpItem || (selectedRow && selectedRow.fileData ? {
          file: selectedRow.fileData,
          isRemote: sftpMode === 'remote',
          host: sftpCurrentHost,
        } : null);

        if (itemToDelete) {
          e.preventDefault();
          e.stopPropagation();
          deleteSftpItem(itemToDelete);
        }
      }
    }
  });
}

function setupSftpContextMenu() {
  // Seamlessly handled by unified setupControlledContextMenu()
}

let transferHideTimeout = null;

function updateTransferWidget(payload) {
  const widget = document.getElementById('status-transfer-widget');
  const textElem = document.getElementById('status-transfer-text');
  const fillElem = document.getElementById('status-transfer-fill');
  const speedElem = document.getElementById('status-transfer-speed');

  if (!widget || !textElem || !fillElem || !speedElem) return;

  if (transferHideTimeout) {
    clearTimeout(transferHideTimeout);
    transferHideTimeout = null;
  }

  widget.classList.remove('hidden');

  const dirVerb = payload.direction === 'download' ? 'Downloading' : 'Uploading';
  textElem.textContent = `${dirVerb} ${payload.fileName} (${payload.progressPercent}%)`;
  fillElem.style.width = `${Math.min(100, Math.max(0, payload.progressPercent))}%`;
  speedElem.textContent = payload.speedStr || '0.0 KB/s';

  if (payload.status === 'completed' || payload.progressPercent >= 100) {
    textElem.textContent = `Completed ${payload.fileName}`;
    transferHideTimeout = setTimeout(() => {
      widget.classList.add('hidden');
    }, 2500);
  }
}

function setupTauriEventListeners() {
  if (listen) {
    listen('transfer-progress', (event) => {
      if (event && event.payload) {
        updateTransferWidget(event.payload);
      }
    }).catch(console.error);

    listen('file-synced-remote', (event) => {
      if (event && event.payload) {
        const p = event.payload;
        showToast(`✓ Auto-synced remote file: ${p.fileName} (${p.hostName})`, 'success');
        if (sftpMode === 'remote' && sftpCurrentHost && sftpCurrentHost.name === p.hostName) {
          loadRemoteFiles(sftpCurrentHost, sftpCurrentPath);
        }
      }
    }).catch(console.error);
  }
}

// ── Unified Mesh VPN & Cloud Providers ──

// ── State for Mesh VPN ──
let editingMeshId = null;
let editingMeshType = 'wireguard';
let activeMeshSessionCache = null;
let wgStatusesCache = [];
let tsStatusCache = null;
let nbStatusCache = null;

// ── State for Cloud Providers (Held strictly in JS memory for current connected provider) ──
let currentCloudProvider = 'gcp';
let cloudDataCache = {
  provider: 'gcp',
  auth: null,
  projects: null, // null = not loaded yet; [] = loaded empty
  instances: {}, // { [projectId]: Array<CloudInstance> }
  expandedProjects: new Set(),
  selectedProjectId: null,
  loadingProjects: false,
  loadingInstances: {},
  authError: null,
  lastPollTimestamp: 0,
};
let cloudPollInterval = null;

function clearCloudCache(newProvider) {
  currentCloudProvider = newProvider;
  cloudDataCache = {
    provider: newProvider,
    auth: null,
    projects: null,
    instances: {},
    expandedProjects: new Set(),
    selectedProjectId: null,
    loadingProjects: false,
    loadingInstances: {},
    authError: null,
    lastPollTimestamp: 0,
  };
}

async function saveConfig() {
  await invoke('save_config', { config: appConfig });
}

function updateMeshTypeFields(selectedType) {
  const meshFormType = document.getElementById('mesh-form-type');
  const type = selectedType || (meshFormType ? meshFormType.value : 'wireguard');
  const fieldsWg = document.getElementById('mesh-fields-wireguard');
  const fieldsTs = document.getElementById('mesh-fields-tailscale');
  const fieldsNb = document.getElementById('mesh-fields-netbird');

  if (fieldsWg) {
    fieldsWg.classList.toggle('hidden', type !== 'wireguard');
    fieldsWg.style.display = type === 'wireguard' ? 'block' : 'none';
  }
  if (fieldsTs) {
    fieldsTs.classList.toggle('hidden', type !== 'tailscale');
    fieldsTs.style.display = type === 'tailscale' ? 'block' : 'none';
  }
  if (fieldsNb) {
    fieldsNb.classList.toggle('hidden', type !== 'netbird');
    fieldsNb.style.display = type === 'netbird' ? 'block' : 'none';
  }
}

function resetMeshKeyToggles() {
  const tsAuthKey = document.getElementById('ts-form-auth-key');
  const nbToken = document.getElementById('nb-form-token') || document.getElementById('nb-form-setup-key');
  const btnToggleTs = document.getElementById('btn-toggle-ts-key');
  const btnToggleNb = document.getElementById('btn-toggle-nb-key');

  if (tsAuthKey) tsAuthKey.type = 'password';
  if (nbToken) nbToken.type = 'password';
  if (btnToggleTs) {
    btnToggleTs.innerHTML = '<i class="fa">&#xf06e;</i>';
    btnToggleTs.title = 'Show Key';
  }
  if (btnToggleNb) {
    btnToggleNb.innerHTML = '<i class="fa">&#xf06e;</i>';
    btnToggleNb.title = 'Show Token';
  }
}

function setupMeshDrawer() {
  const meshAddBtn = document.getElementById('mesh-add-btn') || document.getElementById('wg-add-btn');
  const meshRefreshBtn = document.getElementById('mesh-refresh-btn') || document.getElementById('wg-refresh-btn');
  const meshSearchInput = document.getElementById('mesh-search-input') || document.getElementById('wg-search-input');

  const modalMesh = document.getElementById('modal-add-mesh') || document.getElementById('modal-add-wireguard');
  const modalMeshClose = document.getElementById('modal-mesh-close') || document.getElementById('modal-wg-close');
  const modalMeshCancel = document.getElementById('modal-mesh-cancel') || document.getElementById('modal-wg-cancel');
  const modalMeshSubmit = document.getElementById('modal-mesh-submit') || document.getElementById('modal-wg-submit');

  const meshFormType = document.getElementById('mesh-form-type');
  const meshFormName = document.getElementById('mesh-form-name') || document.getElementById('wg-form-name');
  const meshFormAutoconnect = document.getElementById('mesh-form-autoconnect') || document.getElementById('wg-form-autoconnect');

  const fieldsWg = document.getElementById('mesh-fields-wireguard');
  const fieldsTs = document.getElementById('mesh-fields-tailscale');
  const fieldsNb = document.getElementById('mesh-fields-netbird');

  const wgBrowseBtn = document.getElementById('wg-form-browse-btn');
  const wgCopyBtn = document.getElementById('wg-form-copy-btn');
  const wgConfText = document.getElementById('wg-form-conf');

  const tsAuthKey = document.getElementById('ts-form-auth-key');
  const tsControlUrl = document.getElementById('ts-form-control-url');
  const tsHostname = document.getElementById('ts-form-hostname');
  const btnToggleTs = document.getElementById('btn-toggle-ts-key');

  const nbToken = document.getElementById('nb-form-token') || document.getElementById('nb-form-setup-key');
  const nbMgmtUrl = document.getElementById('nb-form-mgmt-url');
  const btnToggleNb = document.getElementById('btn-toggle-nb-key');

  if (meshFormType) {
    meshFormType.addEventListener('change', () => updateMeshTypeFields());
  }

  // Key Visibility Toggle Handlers
  if (btnToggleTs && tsAuthKey) {
    btnToggleTs.addEventListener('click', () => {
      const isPwd = tsAuthKey.type === 'password';
      tsAuthKey.type = isPwd ? 'text' : 'password';
      btnToggleTs.innerHTML = `<i class="fa">${isPwd ? '&#xf070;' : '&#xf06e;'}</i>`;
      btnToggleTs.title = isPwd ? 'Hide Key' : 'Show Key';
    });
  }

  if (btnToggleNb && nbToken) {
    btnToggleNb.addEventListener('click', () => {
      const isPwd = nbToken.type === 'password';
      nbToken.type = isPwd ? 'text' : 'password';
      btnToggleNb.innerHTML = `<i class="fa">${isPwd ? '&#xf070;' : '&#xf06e;'}</i>`;
      btnToggleNb.title = isPwd ? 'Hide Token' : 'Show Token';
    });
  }

  if (wgCopyBtn && wgConfText) {
    wgCopyBtn.addEventListener('click', async () => {
      const val = wgConfText.value.trim();
      if (!val) {
        showToast('No WireGuard configuration to copy', 'warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(val);
        showToast('✓ WireGuard configuration copied to clipboard', 'success');
      } catch (err) {
        showToast(`Copy failed: ${err}`, 'error');
      }
    });
  }

  // ── Browser Authentication Portal Handlers ──
  const btnTsBrowserAuth = document.getElementById('btn-ts-browser-auth');
  const btnNbBrowserToken = document.getElementById('btn-nb-browser-token') || document.getElementById('btn-nb-browser-setup');

  if (btnTsBrowserAuth) {
    btnTsBrowserAuth.addEventListener('click', async () => {
      try {
        const controlUrl = (tsControlUrl ? tsControlUrl.value : '').trim() || null;
        await invoke('open_mesh_auth_portal', {
          provider: 'tailscale',
          baseUrl: controlUrl,
          pageType: 'keys'
        });
        showToast('✓ Opened Tailscale Admin Console in browser', 'info');
        tsAuthKey?.focus();
      } catch (err) {
        showToast(`Failed to open browser: ${err}`, 'error');
      }
    });
  }

  if (btnNbBrowserToken) {
    btnNbBrowserToken.addEventListener('click', async () => {
      try {
        const mgmtUrl = (nbMgmtUrl ? nbMgmtUrl.value : '').trim() || 'https://api.netbird.io';
        await invoke('open_mesh_auth_portal', {
          provider: 'netbird',
          baseUrl: mgmtUrl,
          pageType: 'team-users'
        });
        showToast('✓ Opened NetBird (Team > Users). Click your profile > Access Tokens', 'info');
        nbToken?.focus();
      } catch (err) {
        showToast(`Failed to open browser: ${err}`, 'error');
      }
    });
  }

  if (meshAddBtn) {
    meshAddBtn.addEventListener('click', () => {
      editingMeshId = null;
      editingMeshType = 'wireguard';
      const titleEl = document.getElementById('modal-mesh-title') || document.getElementById('modal-wg-title');
      if (titleEl) {
        titleEl.innerHTML = '<i class="fa" style="color: #98c379; margin-right: 6px;">&#xf3ed;</i> Add Mesh VPN Network';
      }
      if (meshFormType) {
        meshFormType.value = 'wireguard';
        meshFormType.disabled = false;
      }
      if (meshFormName) meshFormName.value = '';
      if (wgConfText) wgConfText.value = '';
      if (tsAuthKey) {
        tsAuthKey.value = '';
        tsAuthKey.placeholder = 'tskey-auth-... or tskey-api-...';
      }
      if (tsControlUrl) tsControlUrl.value = '';
      if (tsHostname) tsHostname.value = '';
      if (nbToken) {
        nbToken.value = '';
        nbToken.placeholder = 'nbp_xxxxxxxxxxxxxxxxxxxx';
      }
      if (nbMgmtUrl) nbMgmtUrl.value = 'https://api.netbird.io';
      if (meshFormAutoconnect) meshFormAutoconnect.checked = false;
      resetMeshKeyToggles();
      updateMeshTypeFields('wireguard');
      if (modalMesh) modalMesh.classList.remove('hidden');
    });
  }

  if (modalMeshClose) modalMeshClose.addEventListener('click', () => modalMesh?.classList.add('hidden'));
  if (modalMeshCancel) modalMeshCancel.addEventListener('click', () => modalMesh?.classList.add('hidden'));

  if (wgBrowseBtn) {
    wgBrowseBtn.addEventListener('click', async () => {
      try {
        const content = await invoke('pick_wireguard_conf_file');
        if (content && typeof content === 'string') {
          if (wgConfText) wgConfText.value = content;
          try {
            const parsed = await invoke('parse_wireguard_config_text', { text: content });
            if (parsed && parsed.name && (!meshFormName.value || meshFormName.value.trim() === '')) {
              meshFormName.value = parsed.name;
            }
          } catch (_) {}
          showToast('✓ WireGuard configuration imported', 'success');
        }
      } catch (err) {
        showToast(`Failed to pick file: ${err}`, 'error');
      }
    });
  }

  if (modalMeshSubmit) {
    modalMeshSubmit.addEventListener('click', async () => {
      const type = meshFormType ? meshFormType.value : 'wireguard';
      const name = (meshFormName ? meshFormName.value : '').trim();

      if (!name) {
        showToast('Please enter a network or profile name', 'error');
        return;
      }

      if (type === 'wireguard') {
        const conf = (wgConfText ? wgConfText.value : '').trim();
        if (!conf) {
          showToast('Please enter or import a WireGuard configuration', 'error');
          return;
        }
        try {
          const parsed = await invoke('parse_wireguard_config_text', { text: conf });
          parsed.id = editingMeshId || ('wg-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4));
          parsed.name = name;
          parsed.auto_connect = meshFormAutoconnect ? meshFormAutoconnect.checked : false;

          if (!appConfig.wireguard_profiles) appConfig.wireguard_profiles = [];
          const existingIdx = appConfig.wireguard_profiles.findIndex((p) => p.id === parsed.id);
          if (existingIdx >= 0) {
            appConfig.wireguard_profiles[existingIdx] = parsed;
          } else {
            appConfig.wireguard_profiles.push(parsed);
          }

          await saveConfig();
          if (modalMesh) modalMesh.classList.add('hidden');
          showToast(`✓ WireGuard profile '${name}' saved`, 'success');

          if (parsed.auto_connect) {
            try {
              await invoke('toggle_wireguard_profile_session', { profile: parsed, active: true });
            } catch (connErr) {
              console.warn('Auto-connect error:', connErr);
            }
          }
          renderUnifiedMeshDrawer();
        } catch (err) {
          showToast(`Invalid WireGuard configuration: ${err}`, 'error');
        }
      } else if (type === 'tailscale') {
        const wasActive = activeMeshSessionCache?.type === 'Tailscale';
        const keyInput = (tsAuthKey?.value.trim()) || '';
        if (!keyInput && !editingMeshId) {
          showToast('Please enter a Tailscale Auth or API Key', 'error');
          tsAuthKey?.focus();
          return;
        }
        if (!appConfig.tailscale) {
          appConfig.tailscale = { enabled: true, auth_key: null, control_url: null, hostname: null, socks5_port: 1055 };
        }
        appConfig.tailscale.name = name;
        appConfig.tailscale.enabled = true;
        if (keyInput) {
          appConfig.tailscale.auth_key = keyInput;
        }
        appConfig.tailscale.control_url = (tsControlUrl?.value.trim()) || null;
        appConfig.tailscale.hostname = (tsHostname?.value.trim()) || null;
        await saveConfig();
        if (modalMesh) modalMesh.classList.add('hidden');
        if (wasActive) {
          try {
            await invoke('disconnect_all_mesh_sessions');
          } catch (_) {}
          showToast(`✓ Tailscale settings saved (reconnect to apply changes)`, 'success');
        } else {
          showToast(`✓ Tailscale settings '${name}' saved`, 'success');
        }
        renderUnifiedMeshDrawer();
      } else if (type === 'netbird') {
        const wasActive = activeMeshSessionCache?.type === 'NetBird';
        const tokenInput = (nbToken?.value.trim()) || '';
        if (!tokenInput && !editingMeshId) {
          showToast('Please enter a NetBird Personal Access Token', 'error');
          nbToken?.focus();
          return;
        }
        if (!appConfig.netbird) {
          appConfig.netbird = { enabled: true, management_url: 'https://api.netbird.io', personal_access_token: null, forward_port: 1056 };
        }
        appConfig.netbird.name = name;
        appConfig.netbird.enabled = true;
        appConfig.netbird.management_url = (nbMgmtUrl?.value.trim()) || 'https://api.netbird.io';
        if (tokenInput) {
          appConfig.netbird.personal_access_token = tokenInput;
        }
        delete appConfig.netbird.setup_key;
        await saveConfig();
        if (modalMesh) modalMesh.classList.add('hidden');
        if (wasActive) {
          try {
            await invoke('disconnect_all_mesh_sessions');
          } catch (_) {}
          showToast(`✓ NetBird settings saved (reconnect to apply changes)`, 'success');
        } else {
          showToast(`✓ NetBird settings '${name}' saved`, 'success');
        }
        renderUnifiedMeshDrawer();
      }
    });
  }

  if (meshRefreshBtn) {
    meshRefreshBtn.addEventListener('click', () => renderUnifiedMeshDrawer());
  }

  if (meshSearchInput) {
    meshSearchInput.addEventListener('input', () => renderUnifiedMeshCards());
  }
}

async function renderUnifiedMeshDrawer() {
  const profiles = appConfig.wireguard_profiles || [];

  try {
    const [activeSession, wgStatuses, tsStatus, nbStatus] = await Promise.allSettled([
      invoke('get_active_mesh_session'),
      invoke('get_wireguard_runtime_statuses', { profiles }),
      appConfig.tailscale && appConfig.tailscale.enabled
        ? invoke('get_tailscale_runtime_status', { config: appConfig.tailscale })
        : Promise.resolve(null),
      appConfig.netbird && appConfig.netbird.enabled
        ? invoke('get_netbird_runtime_status', { config: appConfig.netbird })
        : Promise.resolve(null),
    ]);

    activeMeshSessionCache = activeSession.status === 'fulfilled' ? activeSession.value : null;
    wgStatusesCache = wgStatuses.status === 'fulfilled' ? wgStatuses.value : [];
    tsStatusCache = tsStatus.status === 'fulfilled' ? tsStatus.value : null;
    nbStatusCache = nbStatus.status === 'fulfilled' ? nbStatus.value : null;
  } catch (err) {
    console.warn('Failed to query some mesh statuses:', err);
  }

  renderUnifiedMeshCards();
}

function renderUnifiedMeshCards() {
  const listEl = document.getElementById('mesh-cards-list') || document.getElementById('wg-profiles-list');
  const activePill = document.getElementById('mesh-active-pill') || document.getElementById('wg-profiles-count');
  const searchInput = document.getElementById('mesh-search-input') || document.getElementById('wg-search-input');
  if (!listEl) return;

  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  let activeTitle = 'Disconnected';
  let activeState = 'offline';

  if (activeMeshSessionCache) {
    if (activeMeshSessionCache.type === 'WireGuard') {
      const activeProf = (appConfig.wireguard_profiles || []).find((p) => p.id === activeMeshSessionCache.data);
      const wgStat = wgStatusesCache.find((s) => s.profile_id === activeMeshSessionCache.data);
      if (wgStat?.error) {
        activeTitle = `Error: WG (${activeProf ? activeProf.name : 'Tunnel'})`;
        activeState = 'error';
      } else {
        activeTitle = `Active: WG (${activeProf ? activeProf.name : 'Tunnel'})`;
        activeState = 'online';
      }
    } else if (activeMeshSessionCache.type === 'Tailscale' && appConfig.tailscale?.enabled) {
      const isRunning = tsStatusCache && (tsStatusCache.backend_state === 'Running' || tsStatusCache.backend_state === 'Connected (Native)');
      if (tsStatusCache?.error || (tsStatusCache && !isRunning)) {
        activeTitle = `Error: ${appConfig.tailscale.name || 'Tailscale'}`;
        activeState = 'error';
      } else {
        activeTitle = `Active: ${appConfig.tailscale.name || 'Tailscale'}`;
        activeState = 'online';
      }
    } else if (activeMeshSessionCache.type === 'NetBird' && appConfig.netbird?.enabled) {
      if (nbStatusCache?.error || (nbStatusCache && !nbStatusCache.connected)) {
        activeTitle = `Error: ${appConfig.netbird.name || 'NetBird'}`;
        activeState = 'error';
      } else {
        activeTitle = `Active: ${appConfig.netbird.name || 'NetBird'}`;
        activeState = 'online';
      }
    }
  }

  if (activePill) {
    activePill.textContent = activeTitle;
    activePill.className = `status-pill ${activeState}`;
    if (activeState === 'online') {
      activePill.style.color = 'var(--green)';
    } else if (activeState === 'error') {
      activePill.style.color = '#e06c75';
    } else {
      activePill.style.color = 'var(--text-subtle)';
    }
  }

  const unifiedItems = [];

  // 1. WireGuard profiles
  (appConfig.wireguard_profiles || []).forEach((p) => {
    const status = wgStatusesCache.find((s) => s.profile_id === p.id);
    const isThisActive = activeMeshSessionCache?.type === 'WireGuard' && activeMeshSessionCache?.data === p.id;
    const hasError = status?.error || null;
    const isWorking = isThisActive && !hasError;

    let subline = 'Pure user-space BoringTun tunnel';
    if (status?.active) {
      if (status.last_handshake_secs !== null && status.last_handshake_secs !== undefined) {
        subline = `Traffic: ↓ ${formatTunnelBytes(status.bytes_rx)} · ↑ ${formatTunnelBytes(status.bytes_tx)} · Handshake: ${status.last_handshake_secs}s ago`;
      } else if (!hasError) {
        subline = 'Connecting... (waiting for peer handshake)';
      }
    }

    unifiedItems.push({
      id: p.id,
      type: 'wireguard',
      name: p.name,
      isActive: isThisActive,
      isWorking: isWorking,
      error: hasError,
      raw: p,
      status: status || { active: false, bytes_rx: 0, bytes_tx: 0 },
      detailsLine1: `Address: ${p.interface_address || '10.0.0.x'} · Peer: ${p.peer_endpoint || 'P2P'}`,
      detailsLine2: subline,
    });
  });

  // 2. Tailscale (DO NOT add any demo/examples - only if explicitly configured and enabled)
  if (appConfig.tailscale && appConfig.tailscale.enabled) {
    const isThisActive = activeMeshSessionCache?.type === 'Tailscale';
    const isRunning = tsStatusCache && (tsStatusCache.backend_state === 'Running' || tsStatusCache.backend_state === 'Connected (Native)');
    const hasError = tsStatusCache?.error || (isThisActive && tsStatusCache && !isRunning ? `Tailscale state: ${tsStatusCache.backend_state}` : null);
    const isWorking = isThisActive && isRunning && !hasError;
    const selfIp = tsStatusCache?.self_ip || (appConfig.tailscale.hostname ? `${appConfig.tailscale.hostname}.ts.net` : 'MagicDNS');
    const peersCount = tsStatusCache?.peers?.length || 0;
    const keyPreview = appConfig.tailscale.auth_key
      ? `Key: ${appConfig.tailscale.auth_key.slice(0, 10)}••••••••`
      : (appConfig.tailscale.control_url || 'https://controlplane.tailscale.com');

    unifiedItems.push({
      id: 'tailscale-singleton',
      type: 'tailscale',
      name: appConfig.tailscale.name || 'Tailscale',
      isActive: isThisActive,
      isWorking: isWorking,
      error: hasError,
      raw: appConfig.tailscale,
      status: tsStatusCache,
      detailsLine1: `Self: ${selfIp} · Peers: ${peersCount} online`,
      detailsLine2: keyPreview,
    });
  }

  // 3. NetBird (DO NOT add any demo/examples - only if explicitly configured and enabled)
  if (appConfig.netbird && appConfig.netbird.enabled) {
    const hasError = nbStatusCache?.error || (nbStatusCache && !nbStatusCache.connected && activeMeshSessionCache?.type === 'NetBird' ? 'NetBird management server disconnected' : null);
    const isThisActive = activeMeshSessionCache?.type === 'NetBird';
    const isWorking = isThisActive && nbStatusCache?.connected && !hasError;
    const mgmt = appConfig.netbird.management_url || 'https://api.netbird.io';
    const nbPeersCount = nbStatusCache?.peers?.length || 0;
    const token = appConfig.netbird.personal_access_token || appConfig.netbird.setup_key;
    const keyPreview = token
      ? `Token: ${token.slice(0, 8)}•••••••• · Native Zero-Trust`
      : 'Native HTTPS overlay network';

    unifiedItems.push({
      id: 'netbird-singleton',
      type: 'netbird',
      name: appConfig.netbird.name || 'NetBird',
      isActive: isThisActive,
      isWorking: isWorking,
      error: hasError,
      raw: appConfig.netbird,
      status: nbStatusCache,
      detailsLine1: `Server: ${mgmt.replace('https://', '')} · Peers: ${nbPeersCount}`,
      detailsLine2: keyPreview,
    });
  }

  let filtered = unifiedItems;
  if (query) {
    filtered = unifiedItems.filter((it) => {
      return it.name.toLowerCase().includes(query) ||
        it.type.toLowerCase().includes(query) ||
        it.detailsLine1.toLowerCase().includes(query) ||
        it.detailsLine2.toLowerCase().includes(query) ||
        (it.error && it.error.toLowerCase().includes(query));
    });
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
        <i class="fa" style="font-size: 28px; color: var(--border-color); margin-bottom: 8px; display: block;">&#xf3ed;</i>
        ${query ? 'No matching networks found.' : 'No Mesh VPN networks added yet.<br>Click <b>+</b> above to add a WireGuard, Tailscale, or NetBird network.'}
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  filtered.forEach((it) => {
    const card = document.createElement('div');
    const dotClass = it.error ? 'error' : (it.isWorking ? 'online' : (it.isActive ? 'online' : 'offline'));
    const cardClass = it.error ? 'mesh-network-card error' : (it.isActive ? 'mesh-network-card active' : 'mesh-network-card');

    card.className = cardClass;

    const typeBadgeClass = it.type === 'wireguard' ? 'wireguard' : (it.type === 'tailscale' ? 'tailscale' : 'netbird');
    const typeLabel = it.type === 'wireguard' ? 'WireGuard' : (it.type === 'tailscale' ? 'Tailscale' : 'NetBird');

    card.innerHTML = `
      <div class="mesh-card-header">
        <div class="mesh-card-title-box">
          <span class="status-dot ${dotClass}" style="width: 7px; height: 7px;"></span>
          <span class="mesh-type-badge ${typeBadgeClass}">${typeLabel}</span>
          <span class="mesh-card-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</span>
        </div>
        <div class="mesh-card-actions">
          ${it.type === 'wireguard' ? `
            <button class="mesh-action-icon-btn btn-mesh-export" title="Export .conf">
              <i class="fa">&#xf019;</i>
            </button>
          ` : ''}
          <button class="mesh-action-icon-btn btn-mesh-edit" title="Edit ${typeLabel} Network">
            <i class="fa">&#xf044;</i>
          </button>
          <button class="mesh-action-icon-btn btn-mesh-delete" title="Remove ${typeLabel} Network">
            <i class="fa">&#xf1f8;</i>
          </button>
        </div>
      </div>

      <div class="mesh-card-body">
        <div class="mesh-endpoint-line">${escapeHtml(it.detailsLine1)}</div>
        <div class="mesh-sub-line">${escapeHtml(it.detailsLine2)}</div>
        ${it.status?.setup_key_info ? `
          <div style="font-size: 10px; color: var(--accent); margin-top: 2px;">
            <i class="fa" style="margin-right: 3px;">&#xf084;</i> Setup Key: <b>${escapeHtml(it.status.setup_key_info.name)}</b> (Group: ${escapeHtml(it.status.setup_key_info.auto_groups.join(', ') || 'Client')})
          </div>
        ` : ''}
        ${it.error ? `
          <div class="mesh-card-error-banner">
            <i class="fa" style="margin-top: 1px; flex-shrink: 0;">&#xf071;</i>
            <span>${escapeHtml(it.error)}</span>
          </div>
        ` : ''}

        ${(it.status?.peers && it.status.peers.length > 0) ? `
          <div class="mesh-exit-node-banner" style="margin: 8px 0; padding: 6px 8px; background: rgba(0,0,0,0.22); border-radius: 4px; border: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
              <span style="font-size: 10px; font-weight: 600; color: var(--text-main);">
                <i class="fa" style="color: var(--accent); margin-right: 4px;">&#xf126;</i> Default Exit Node / Gateway Peer
              </span>
              <span style="font-size: 9px; color: var(--green);">● Active</span>
            </div>
            <select class="mesh-exit-node-select modal-input" data-mesh-type="${it.type}" style="height: 24px; font-size: 10.5px; padding: 0 6px;">
              <option value="">Default (Auto Routing Peer)</option>
              ${it.status.peers.map((peer) => {
                const peerIp = peer.ip || (peer.tailscale_ips && peer.tailscale_ips[0]) || '';
                const peerName = peer.name || peer.hostname || 'Peer';
                const isSel = (it.type === 'netbird' ? appConfig.netbird?.exit_node : appConfig.tailscale?.exit_node) === peerIp;
                return `<option value="${escapeHtml(peerIp)}" ${isSel ? 'selected' : ''}>${escapeHtml(peerName)} (${escapeHtml(peerIp)})</option>`;
              }).join('')}
            </select>
          </div>
          <div class="mesh-peers-wrapper">
            <div class="mesh-peers-header">
              <span>Peers (${it.status.peers.filter(p => p.status === 'connected' || p.online).length}/${it.status.peers.length} Online)</span>
            </div>
            <div class="mesh-peers-list">
              ${it.status.peers.map((peer) => {
                const isOnline = peer.status === 'connected' || peer.online;
                const peerIp = peer.ip || (peer.tailscale_ips && peer.tailscale_ips[0]) || '';
                const peerName = peer.name || peer.hostname || 'Peer';
                const osIcon = getOsIconClass(peer.os);
                return `
                  <div class="mesh-peer-row">
                    <div class="mesh-peer-info">
                      <span class="status-dot ${isOnline ? 'online' : 'offline'}" style="width: 6px; height: 6px; flex-shrink: 0;"></span>
                      <i class="fa ${osIcon}" style="font-size: 11px; color: var(--text-subtle); width: 14px; text-align: center; flex-shrink: 0;"></i>
                      <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span style="font-weight: 500; color: var(--text-main);">${escapeHtml(peerName)}</span>
                        <span class="mono" style="font-size: 10px; color: var(--text-subtle); margin-left: 4px;">${escapeHtml(peerIp)}</span>
                      </div>
                    </div>
                    <div class="mesh-peer-actions">
                      <button type="button" class="mesh-peer-btn btn-peer-ssh" data-ip="${escapeHtml(peerIp)}" data-name="${escapeHtml(peerName)}" data-route="${it.type}" title="Open SSH terminal to ${escapeHtml(peerName)} (${escapeHtml(peerIp)})">
                        <i class="fa">&#xf120;</i> SSH
                      </button>
                      <button type="button" class="mesh-peer-btn btn-peer-copy" data-ip="${escapeHtml(peerIp)}" title="Copy IP ${escapeHtml(peerIp)}" style="padding: 0 6px;">
                        <i class="fa">&#xf0c5;</i>
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="mesh-card-footer">
        <button class="mesh-connect-btn ${it.isActive ? 'connected' : ''}">
          <i class="fa ${it.isActive ? 'fa-power-off' : 'fa-play'}" style="margin-right: 5px;"></i>
          ${it.isActive ? 'Disconnect' : 'Connect'}
        </button>
      </div>
    `;

    card.querySelectorAll('.btn-peer-ssh').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ip = btn.getAttribute('data-ip');
        const name = btn.getAttribute('data-name');
        const route = btn.getAttribute('data-route');
        connectToMeshPeer({ name, host: ip, route });
      });
    });

    card.querySelectorAll('.btn-peer-copy').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ip = btn.getAttribute('data-ip');
        if (ip) {
          setSystemClipboardText(ip);
          showToast(`✓ Copied peer IP ${ip}`, 'info');
        }
      });
    });

    const exitNodeSel = card.querySelector('.mesh-exit-node-select');
    if (exitNodeSel) {
      exitNodeSel.addEventListener('change', async (e) => {
        const val = e.target.value;
        const meshType = exitNodeSel.getAttribute('data-mesh-type');
        if (meshType === 'netbird' && appConfig.netbird) {
          appConfig.netbird.exit_node = val || null;
          persistConfig(true);
          showToast(`NetBird exit node set to: ${val || 'Default'}`, 'info');
        } else if (meshType === 'tailscale' && appConfig.tailscale) {
          appConfig.tailscale.exit_node = val || null;
          persistConfig(true);
          showToast(`Tailscale exit node set to: ${val || 'Default'}`, 'info');
        }
      });
    }

    const connectBtn = card.querySelector('.mesh-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        connectBtn.disabled = true;
        const origHtml = connectBtn.innerHTML;
        connectBtn.innerHTML = '<i class="fa fa-spinner fa-spin" style="margin-right: 5px;"></i> Verifying...';

        try {
          if (it.isActive) {
            await invoke('disconnect_all_mesh_sessions');
            showToast(`${typeLabel} disconnected`, 'info');
          } else {
            if (it.type === 'wireguard') {
              await invoke('toggle_wireguard_profile_session', { profile: it.raw, active: true });
            } else if (it.type === 'tailscale') {
              await invoke('toggle_tailscale_session', { config: appConfig.tailscale, active: true, enabled: true });
            } else if (it.type === 'netbird') {
              await invoke('toggle_netbird_session', { config: appConfig.netbird, active: true, enabled: true });
            }
            showToast(`✓ Connected to ${it.name} (${typeLabel})`, 'success');
          }
        } catch (err) {
          console.error(`Mesh connection error:`, err);
          showToast(`Connection failed: ${err}`, 'error');
        } finally {
          await renderUnifiedMeshDrawer();
          connectBtn.disabled = false;
        }
      });
    }

    const editBtn = card.querySelector('.btn-mesh-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modalMesh = document.getElementById('modal-add-mesh') || document.getElementById('modal-add-wireguard');
        const meshFormType = document.getElementById('mesh-form-type');
        const meshFormName = document.getElementById('mesh-form-name') || document.getElementById('wg-form-name');
        const wgConfText = document.getElementById('wg-form-conf');
        const tsAuthKey = document.getElementById('ts-form-auth-key');
        const tsControlUrl = document.getElementById('ts-form-control-url');
        const tsHostname = document.getElementById('ts-form-hostname');
        const nbToken = document.getElementById('nb-form-token') || document.getElementById('nb-form-setup-key');
        const nbMgmtUrl = document.getElementById('nb-form-mgmt-url');

        editingMeshId = it.id;
        editingMeshType = it.type;

        if (meshFormType) {
          meshFormType.value = it.type;
          meshFormType.disabled = false;
        }
        if (meshFormName) meshFormName.value = it.name;

        if (it.type === 'wireguard') {
          invoke('export_wireguard_config_text', { profile: it.raw }).then((exported) => {
            if (wgConfText) wgConfText.value = exported;
          });
        } else if (it.type === 'tailscale') {
          if (tsAuthKey) {
            tsAuthKey.value = '';
            tsAuthKey.placeholder = it.raw.auth_key ? '•••••••••••• (leave blank to keep current key)' : 'tskey-auth-...';
          }
          if (tsControlUrl) tsControlUrl.value = it.raw.control_url || '';
          if (tsHostname) tsHostname.value = it.raw.hostname || '';
        } else if (it.type === 'netbird') {
          if (nbToken) {
            nbToken.value = '';
            nbToken.placeholder = (it.raw.personal_access_token || it.raw.setup_key) ? '•••••••••••• (leave blank to keep current token)' : 'nbp_xxxxxxxxxxxxxxxxxxxx';
          }
          if (nbMgmtUrl) nbMgmtUrl.value = it.raw.management_url || 'https://api.netbird.io';
        }

        const titleEl = document.getElementById('modal-mesh-title') || document.getElementById('modal-wg-title');
        if (titleEl) {
          titleEl.innerHTML = `<i class="fa" style="color: #98c379; margin-right: 6px;">&#xf3ed;</i> Edit ${typeLabel} Network`;
        }

        resetMeshKeyToggles();
        updateMeshTypeFields(it.type);

        if (modalMesh) modalMesh.classList.remove('hidden');
      });
    }

    const exportBtn = card.querySelector('.btn-mesh-export');
    if (exportBtn && it.type === 'wireguard') {
      exportBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const confText = await invoke('export_wireguard_config_text', { profile: it.raw });
          await navigator.clipboard.writeText(confText);
          showToast(`✓ WireGuard '${it.name}' configuration copied to clipboard`, 'success');
        } catch (err) {
          showToast(`Export failed: ${err}`, 'error');
        }
      });
    }

    const deleteBtn = card.querySelector('.btn-mesh-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to remove the ${typeLabel} network '${it.name}'?`)) return;
        if (it.isActive) {
          try {
            await invoke('disconnect_all_mesh_sessions');
          } catch (_) {}
        }
        if (it.type === 'wireguard') {
          appConfig.wireguard_profiles = (appConfig.wireguard_profiles || []).filter((p) => p.id !== it.id);
        } else if (it.type === 'tailscale') {
          delete appConfig.tailscale;
        } else if (it.type === 'netbird') {
          delete appConfig.netbird;
        }
        await saveConfig();
        showToast(`✓ ${typeLabel} network '${it.name}' removed`, 'info');
        renderUnifiedMeshDrawer();
      });
    }

    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('.mesh-card-actions') || e.target.closest('.mesh-connect-btn')) return;
      connectBtn?.click();
    });

    listEl.appendChild(card);
  });
}

// ── Cloud Providers Drawer & Management (In-Memory Only) ──
function setupCloudDrawer() {
  const providerSelect = document.getElementById('cloud-provider-select');
  const settingsBtn = document.getElementById('cloud-settings-btn');
  const refreshBtn = document.getElementById('cloud-refresh-btn');
  const searchInput = document.getElementById('cloud-search-input');

  const modalSettings = document.getElementById('modal-cloud-settings');
  const modalClose = document.getElementById('modal-cloud-settings-close');
  const modalCancel = document.getElementById('modal-cloud-settings-cancel');
  const modalSubmit = document.getElementById('modal-cloud-settings-submit');

  const tabGcp = document.getElementById('cloud-tab-btn-gcp');
  const tabAws = document.getElementById('cloud-tab-btn-aws');
  const tabAzure = document.getElementById('cloud-tab-btn-azure');

  const panelGcp = document.getElementById('cloud-panel-gcp');
  const panelAws = document.getElementById('cloud-panel-aws');
  const panelAzure = document.getElementById('cloud-panel-azure');

  function switchCloudTab(provider) {
    [tabGcp, tabAws, tabAzure].forEach((btn) => {
      if (!btn) return;
      const isTarget = btn.dataset.cloud === provider;
      btn.classList.toggle('active', isTarget);
    });

    if (panelGcp) panelGcp.classList.toggle('active', provider === 'gcp');
    if (panelAws) panelAws.classList.toggle('active', provider === 'aws');
    if (panelAzure) panelAzure.classList.toggle('active', provider === 'azure');
  }

  if (tabGcp) tabGcp.addEventListener('click', () => switchCloudTab('gcp'));
  if (tabAws) tabAws.addEventListener('click', () => switchCloudTab('aws'));
  if (tabAzure) tabAzure.addEventListener('click', () => switchCloudTab('azure'));

  const browseGcpBtn = document.getElementById('btn-browse-gcp-sa-path');
  if (browseGcpBtn) {
    browseGcpBtn.addEventListener('click', async () => {
      try {
        const picked = await invoke('pick_cloud_key_file');
        if (picked && typeof picked === 'string') {
          const saInput = document.getElementById('cloud-gcp-sa-path');
          if (saInput) saInput.value = picked;
          showToast('✓ Service account key file selected', 'success');
        }
      } catch (err) {
        showToast(`Failed to pick key file: ${err}`, 'error');
      }
    });
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      clearCloudCache(providerSelect.value || 'gcp');
      renderCloudDrawer(true);
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      switchCloudTab(currentCloudProvider);
      try {
        const creds = await invoke('get_cloud_credentials');
        if (creds) {
          const saInput = document.getElementById('cloud-gcp-sa-path');
          const gcpTokInput = document.getElementById('cloud-gcp-access-token');
          const projInput = document.getElementById('cloud-gcp-project');

          const awsTokInput = document.getElementById('cloud-aws-session-token');
          const awsKeyInput = document.getElementById('cloud-aws-access-key');
          const awsSecInput = document.getElementById('cloud-aws-secret-key');
          const awsRegInput = document.getElementById('cloud-aws-region');
          const awsProfInput = document.getElementById('cloud-aws-profile');

          const azTokInput = document.getElementById('cloud-azure-access-token');
          const azSubInput = document.getElementById('cloud-azure-sub-id');
          const azTenInput = document.getElementById('cloud-azure-tenant-id');
          const azClientInput = document.getElementById('cloud-azure-client-id');
          const azSecInput = document.getElementById('cloud-azure-client-secret');
          const azRgInput = document.getElementById('cloud-azure-rg');

          if (saInput) saInput.value = creds.gcp_service_account_path || creds.gcp_service_account_json || '';
          if (gcpTokInput) gcpTokInput.value = creds.gcp_access_token || '';
          if (projInput) projInput.value = creds.gcp_default_project || '';

          if (awsTokInput) awsTokInput.value = creds.aws_session_token || '';
          if (awsKeyInput) awsKeyInput.value = creds.aws_access_key_id || '';
          if (awsSecInput) awsSecInput.value = creds.aws_secret_access_key || '';
          if (awsRegInput) awsRegInput.value = creds.aws_default_region || 'us-east-1';
          if (awsProfInput) awsProfInput.value = creds.aws_profile || 'default';

          if (azTokInput) azTokInput.value = creds.azure_access_token || '';
          if (azSubInput) azSubInput.value = creds.azure_subscription_id || '';
          if (azTenInput) azTenInput.value = creds.azure_tenant_id || '';
          if (azClientInput) azClientInput.value = creds.azure_client_id || '';
          if (azSecInput) azSecInput.value = creds.azure_client_secret || '';
          if (azRgInput) azRgInput.value = creds.azure_default_resource_group || '';
        }
      } catch (err) {
        console.warn('Could not load cloud credentials:', err);
      }
      if (modalSettings) modalSettings.classList.remove('hidden');
    });
  }

  if (modalClose) modalClose.addEventListener('click', () => modalSettings?.classList.add('hidden'));
  if (modalCancel) modalCancel.addEventListener('click', () => modalSettings?.classList.add('hidden'));

  if (modalSubmit) {
    modalSubmit.addEventListener('click', async () => {
      const saInput = document.getElementById('cloud-gcp-sa-path');
      const gcpTokInput = document.getElementById('cloud-gcp-access-token');
      const projInput = document.getElementById('cloud-gcp-project');

      const awsTokInput = document.getElementById('cloud-aws-session-token');
      const awsKeyInput = document.getElementById('cloud-aws-access-key');
      const awsSecInput = document.getElementById('cloud-aws-secret-key');
      const awsRegInput = document.getElementById('cloud-aws-region');
      const awsProfInput = document.getElementById('cloud-aws-profile');

      const azTokInput = document.getElementById('cloud-azure-access-token');
      const azSubInput = document.getElementById('cloud-azure-sub-id');
      const azTenInput = document.getElementById('cloud-azure-tenant-id');
      const azClientInput = document.getElementById('cloud-azure-client-id');
      const azSecInput = document.getElementById('cloud-azure-client-secret');
      const azRgInput = document.getElementById('cloud-azure-rg');

      const config = {
        gcp_service_account_path: saInput?.value.trim() || null,
        gcp_service_account_json: null, // do NOT store raw key in config
        gcp_access_token: gcpTokInput?.value.trim() || null,
        gcp_default_project: projInput?.value.trim() || null,

        aws_session_token: awsTokInput?.value.trim() || null,
        aws_access_key_id: awsKeyInput?.value.trim() || null,
        aws_secret_access_key: awsSecInput?.value.trim() || null,
        aws_default_region: awsRegInput?.value.trim() || 'us-east-1',
        aws_profile: awsProfInput?.value.trim() || 'default',

        azure_access_token: azTokInput?.value.trim() || null,
        azure_subscription_id: azSubInput?.value.trim() || null,
        azure_tenant_id: azTenInput?.value.trim() || null,
        azure_client_id: azClientInput?.value.trim() || null,
        azure_client_secret: azSecInput?.value.trim() || null,
        azure_default_resource_group: azRgInput?.value.trim() || null,
      };

      try {
        await invoke('save_cloud_credentials', { config });
        showToast('✓ Cloud provider credentials saved', 'success');
        if (modalSettings) modalSettings.classList.add('hidden');
        clearCloudCache(currentCloudProvider);
        renderCloudDrawer(true);
      } catch (err) {
        showToast(`Failed to save cloud credentials: ${err}`, 'error');
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      clearCloudCache(currentCloudProvider);
      renderCloudDrawer(true);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => renderCloudTree());
  }

  // Setup low-rate (5 min) background instance polling
  setupCloudPollingTimer();
}

function isCloudAuthError(err) {
  if (!err) return false;
  const msg = (typeof err === 'string' ? err : (err.message || JSON.stringify(err))).toLowerCase();
  return msg.includes('token') ||
    msg.includes('expired') ||
    msg.includes('unauthorized') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('forbidden') ||
    msg.includes('reauth') ||
    msg.includes('credential') ||
    msg.includes('access denied') ||
    msg.includes('login') ||
    msg.includes('sign in') ||
    msg.includes('invalid grant') ||
    msg.includes('not authenticated') ||
    msg.includes('no azure credentials') ||
    msg.includes('no gcp credentials') ||
    msg.includes('no aws credentials');
}

function handleCloudAuthError(err) {
  const msg = typeof err === 'string' ? err : (err?.message || 'Authentication session or credentials expired.');
  cloudDataCache.authError = msg;
  if (cloudDataCache.auth) {
    cloudDataCache.auth.is_authenticated = false;
  }
  const authPill = document.getElementById('cloud-auth-pill');
  if (authPill) {
    authPill.textContent = 'Not connected';
    authPill.className = 'status-pill offline';
    authPill.style.color = 'var(--red)';
  }
  renderCloudTree();
}

const CLOUD_POLL_INTERVAL_MS = 300000; // 5 minutes

function setupCloudPollingTimer() {
  if (cloudPollInterval) {
    clearInterval(cloudPollInterval);
  }
  cloudPollInterval = setInterval(async () => {
    // 1. Only poll if Cloud tab is currently selected and visible
    if (activeCategory !== 'cloud') return;
    const drawer = document.getElementById('left-drawer');
    if (drawer && drawer.classList.contains('collapsed')) return;

    // 2. Only poll if connected and no auth error
    if (cloudDataCache.authError || !cloudDataCache.auth?.is_authenticated) return;

    // 3. Target only selected or expanded projects
    const targetPids = [];
    if (cloudDataCache.selectedProjectId) {
      targetPids.push(cloudDataCache.selectedProjectId);
    } else {
      targetPids.push(...Array.from(cloudDataCache.expandedProjects));
    }

    if (targetPids.length === 0) return;

    // 4. Poll active projects quietly
    for (const pid of targetPids) {
      await fetchProjectInstances(pid, true);
    }
  }, CLOUD_POLL_INTERVAL_MS);
}

async function renderCloudDrawer(forceRefresh = false) {
  const providerSelect = document.getElementById('cloud-provider-select');
  const authPill = document.getElementById('cloud-auth-pill');
  const treeList = document.getElementById('cloud-tree-list');
  if (!treeList) return;

  if (providerSelect && providerSelect.value !== currentCloudProvider) {
    clearCloudCache(providerSelect.value || 'gcp');
  }

  const providerName = currentCloudProvider === 'gcp' ? 'GCP' : (currentCloudProvider === 'aws' ? 'AWS' : 'Azure');

  // If already in memory and not force refresh, render immediately from memory without API calls
  if (!forceRefresh && cloudDataCache.projects !== null) {
    if (authPill) {
      const isOnline = cloudDataCache.auth?.is_authenticated && !cloudDataCache.authError;
      authPill.textContent = isOnline ? 'Connected' : 'Not connected';
      authPill.className = `status-pill ${isOnline ? 'online' : 'offline'}`;
      authPill.style.color = isOnline ? 'var(--green)' : 'var(--red)';
    }
    renderCloudTree();
    return;
  }

  // Check auth first if not cached or force refresh
  if (forceRefresh || !cloudDataCache.auth) {
    try {
      const auth = await invoke('check_cloud_auth', { provider: currentCloudProvider });
      cloudDataCache.auth = auth;
      cloudDataCache.authError = null;

      if (authPill) {
        authPill.textContent = auth.is_authenticated ? 'Connected' : 'Not connected';
        authPill.className = `status-pill ${auth.is_authenticated ? 'online' : 'offline'}`;
        authPill.style.color = auth.is_authenticated ? 'var(--green)' : 'var(--red)';
      }

      if (!auth.is_authenticated) {
        cloudDataCache.projects = [];
        renderCloudTree();
        return;
      }
    } catch (err) {
      console.warn('Cloud auth check failed:', err);
      handleCloudAuthError(err);
      return;
    }
  }

  if (cloudDataCache.loadingProjects) return;
  cloudDataCache.loadingProjects = true;

  treeList.innerHTML = `
    <div style="padding: 32px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
      <i class="fa fa-spinner fa-spin" style="font-size: 24px; color: var(--accent); margin-bottom: 10px; display: block;"></i>
      Loading ${providerName} projects...
    </div>
  `;

  try {
    const projects = await invoke('list_cloud_projects', { provider: currentCloudProvider, defaultProject: null });
    cloudDataCache.projects = projects || [];
    cloudDataCache.authError = null;

    // If only one project exists, auto-expand it and fetch its instances
    if (cloudDataCache.projects.length === 1) {
      const singleProj = cloudDataCache.projects[0];
      cloudDataCache.expandedProjects.add(singleProj.id);
      cloudDataCache.selectedProjectId = singleProj.id;
      fetchProjectInstances(singleProj.id);
    }
  } catch (err) {
    console.error('Failed to list cloud projects:', err);
    if (isCloudAuthError(err)) {
      handleCloudAuthError(err);
    } else {
      cloudDataCache.projects = [];
      showToast(`Error listing ${providerName} projects: ${err}`, 'error');
    }
  } finally {
    cloudDataCache.loadingProjects = false;
    renderCloudTree();
  }
}

async function fetchProjectInstances(projectId, isBackgroundPoll = false) {
  if (!projectId) return;
  if (cloudDataCache.loadingInstances[projectId]) return;
  cloudDataCache.loadingInstances[projectId] = true;

  if (!isBackgroundPoll) {
    renderCloudTree();
  }

  try {
    const instances = await invoke('list_cloud_instances', {
      provider: currentCloudProvider,
      projectId: projectId,
      zone: null,
    });
    cloudDataCache.instances[projectId] = instances || [];
    cloudDataCache.authError = null;
    cloudDataCache.lastPollTimestamp = Date.now();
  } catch (err) {
    console.warn(`Failed to list instances for project ${projectId}:`, err);
    if (isCloudAuthError(err)) {
      handleCloudAuthError(err);
    } else {
      if (!cloudDataCache.instances[projectId]) {
        cloudDataCache.instances[projectId] = [];
      }
      if (!isBackgroundPoll) {
        showToast(`Failed to load instances: ${err}`, 'error');
      }
    }
  } finally {
    cloudDataCache.loadingInstances[projectId] = false;
    renderCloudTree();
  }
}

function renderCloudTree() {
  const treeList = document.getElementById('cloud-tree-list');
  const searchInput = document.getElementById('cloud-search-input');
  if (!treeList) return;

  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const providerName = currentCloudProvider === 'gcp' ? 'GCP' : (currentCloudProvider === 'aws' ? 'AWS' : 'Azure');

  // 1. Auth error or unauthenticated state: show clear re-auth prompt
  if (cloudDataCache.authError || (cloudDataCache.auth && !cloudDataCache.auth.is_authenticated)) {
    const errorDetail = cloudDataCache.authError || cloudDataCache.auth?.message || 'Authentication required.';
    treeList.innerHTML = `
      <div style="padding: 36px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
        <i class="fa" style="font-size: 32px; color: var(--border-color); margin-bottom: 12px; display: block;">&#xf0c2;</i>
        <b style="color: var(--text-main); font-size: 12px;">${providerName} is not connected.</b><br>
        <p style="margin: 8px 0 14px 0; line-height: 1.4; color: var(--text-subtle);">${escapeHtml(errorDetail)}</p>
        <button id="btn-cloud-open-settings-prompt" class="btn-primary" style="padding: 6px 14px; font-size: 11px; margin: 0 auto; display: inline-flex; align-items: center; gap: 6px;">
          <i class="fa">&#xf013;</i> ${cloudDataCache.authError ? 'Re-Authenticate' : 'Configure'} ${providerName} Credentials
        </button>
      </div>
    `;
    document.getElementById('btn-cloud-open-settings-prompt')?.addEventListener('click', () => {
      document.getElementById('cloud-settings-btn')?.click();
    });
    return;
  }

  // 2. Projects loading state
  if (cloudDataCache.projects === null && cloudDataCache.loadingProjects) {
    treeList.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
        <i class="fa fa-spinner fa-spin" style="font-size: 24px; color: var(--accent); margin-bottom: 10px; display: block;"></i>
        Loading ${providerName} projects...
      </div>
    `;
    return;
  }

  // 3. No projects found
  if (!cloudDataCache.projects || cloudDataCache.projects.length === 0) {
    treeList.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
        <i class="fa" style="font-size: 28px; color: var(--border-color); margin-bottom: 8px; display: block;">&#xf0c2;</i>
        No ${providerName} projects or regions detected.<br>
        Verify your account permissions or click ⚙️ above to check settings.
      </div>
    `;
    return;
  }

  treeList.innerHTML = '';

  cloudDataCache.projects.forEach((proj) => {
    const instances = cloudDataCache.instances[proj.id];
    const isLoadingInst = !!cloudDataCache.loadingInstances[proj.id];
    const isExpanded = cloudDataCache.expandedProjects.has(proj.id) || !!query;

    let filteredInstances = instances || [];
    if (query) {
      filteredInstances = filteredInstances.filter((inst) => {
        return inst.name.toLowerCase().includes(query) ||
          inst.id.toLowerCase().includes(query) ||
          (inst.zone && inst.zone.toLowerCase().includes(query)) ||
          (inst.external_ip && inst.external_ip.includes(query)) ||
          (inst.internal_ip && inst.internal_ip.includes(query)) ||
          proj.name.toLowerCase().includes(query) ||
          proj.id.toLowerCase().includes(query);
      });
      if (filteredInstances.length === 0 && !proj.name.toLowerCase().includes(query) && !proj.id.toLowerCase().includes(query)) {
        return;
      }
    }

    const group = document.createElement('div');
    group.className = 'cloud-project-group';

    let countBadge = '';
    if (isLoadingInst) {
      countBadge = `<i class="fa fa-spinner fa-spin" style="font-size: 10px; color: var(--accent);"></i>`;
    } else if (instances === undefined) {
      countBadge = `<span style="font-size: 9.5px; padding: 1px 5px; border-radius: 8px; background: var(--bg-card-hover); color: var(--text-subtle);">Click to load</span>`;
    } else {
      countBadge = `<span style="font-size: 10px; padding: 1px 6px; border-radius: 10px; background: var(--bg-card-hover); color: var(--text-subtle);">${filteredInstances.length}</span>`;
    }

    const chevronRotation = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    const folderIcon = isExpanded ? '&#xf07c;' : '&#xf07b;';

    group.innerHTML = `
      <div class="cloud-project-header" style="cursor: pointer; user-select: none;">
        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">
          <i class="fa fa-chevron-down" style="font-size: 10px; color: var(--text-subtle); transition: transform 0.15s; transform: ${chevronRotation};"></i>
          <i class="fa" style="font-size: 11px; color: #61afef;">${folderIcon}</i>
          <span title="${escapeHtml(proj.name)} (${escapeHtml(proj.id)})" style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(proj.name)}</span>
        </div>
        ${countBadge}
      </div>
      <div class="cloud-instance-list" style="display: ${isExpanded ? 'flex' : 'none'};"></div>
    `;

    const header = group.querySelector('.cloud-project-header');
    const instListEl = group.querySelector('.cloud-instance-list');

    header.addEventListener('click', () => {
      if (cloudDataCache.expandedProjects.has(proj.id)) {
        cloudDataCache.expandedProjects.delete(proj.id);
        if (cloudDataCache.selectedProjectId === proj.id) {
          cloudDataCache.selectedProjectId = null;
        }
        renderCloudTree();
      } else {
        cloudDataCache.expandedProjects.add(proj.id);
        cloudDataCache.selectedProjectId = proj.id;
        if (cloudDataCache.instances[proj.id] === undefined) {
          fetchProjectInstances(proj.id);
        } else {
          renderCloudTree();
        }
      }
    });

    if (isExpanded) {
      if (isLoadingInst) {
        instListEl.innerHTML = `
          <div style="padding: 10px 12px; font-size: 10.5px; color: var(--text-subtle); text-align: center;">
            <i class="fa fa-spinner fa-spin" style="margin-right: 6px; color: var(--accent);"></i> Loading instances...
          </div>
        `;
      } else if (instances === undefined) {
        instListEl.innerHTML = `
          <div style="padding: 10px 12px; font-size: 10.5px; color: var(--text-subtle); text-align: center; cursor: pointer;" class="cloud-load-inst-hint">
            <i class="fa fa-arrow-down" style="margin-right: 4px; color: var(--accent);"></i> Click to fetch compute instances
          </div>
        `;
        instListEl.querySelector('.cloud-load-inst-hint')?.addEventListener('click', (e) => {
          e.stopPropagation();
          fetchProjectInstances(proj.id);
        });
      } else if (filteredInstances.length === 0) {
        instListEl.innerHTML = `
          <div style="padding: 8px 12px; font-size: 10.5px; color: var(--text-subtle); text-align: center;">
            No compute instances found in this project.
          </div>
        `;
      } else {
        filteredInstances.forEach((inst) => {
          const card = document.createElement('div');
          card.className = 'cloud-instance-card';
          card.setAttribute('title', `Double click to SSH connect to ${inst.name}`);

          const isRunning = (inst.status || '').toLowerCase().includes('running');
          const statusClass = isRunning ? 'running' : 'stopped';

          const extIp = inst.external_ip || 'No External IP';
          const zoneText = inst.zone || 'Global';

          card.innerHTML = `
            <div class="cloud-instance-header">
              <div class="cloud-instance-name">
                <span class="status-dot ${isRunning ? 'online' : 'offline'}" style="width: 6px; height: 6px;"></span>
                <span>${escapeHtml(inst.name)}</span>
              </div>
              <span class="cloud-status-indicator ${statusClass}">${escapeHtml(inst.status)}</span>
            </div>
            <div class="cloud-instance-meta">
              <span><i class="fa fa-map-marker" style="margin-right: 3px;"></i>${escapeHtml(zoneText)}</span>
              <span style="color: ${inst.external_ip ? 'var(--text-main)' : 'var(--text-subtle)'};">${escapeHtml(extIp)}</span>
            </div>
          `;

          card.addEventListener('dblclick', () => {
            connectCloudInstance(inst);
          });

          instListEl.appendChild(card);
        });
      }
    }

    treeList.appendChild(group);
  });
}

async function connectCloudInstance(inst) {
  showToast(`Connecting to ${inst.name} (${inst.provider.toUpperCase()})...`, 'info');

  try {
    const ep = await invoke('get_cloud_instance_ssh_endpoint', { instance: inst });

    const cloudHost = {
      id: `cloud-${inst.provider}-${inst.id}`,
      name: `${inst.name} (${inst.provider.toUpperCase()})`,
      host: ep.host || inst.external_ip || inst.internal_ip || '127.0.0.1',
      port: ep.port || 22,
      user: ep.user || 'root',
      auth_type: 'key',
      key_path: '.ssh/id_ed25519',
      has_docker: false,
      enable_port_scan: false,
      icon: '&#xf0c2;',
      cloud_provider: inst.provider,
      cloud_project_id: inst.project_id,
      cloud_zone: inst.zone,
      cloud_instance_id: inst.id,
    };

    await connectToHost(cloudHost);
  } catch (err) {
    showToast(`Failed to establish SSH connection to ${inst.name}: ${err}`, 'error');
  }
}

function getOsIconClass(osName) {
  if (!osName) return 'fa-server';
  const os = osName.toLowerCase();
  if (os.includes('linux') || os.includes('ubuntu') || os.includes('debian')) return 'fa-linux';
  if (os.includes('windows')) return 'fa-windows';
  if (os.includes('darwin') || os.includes('mac') || os.includes('apple') || os.includes('ios')) return 'fa-apple';
  if (os.includes('android')) return 'fa-android';
  return 'fa-server';
}

function connectToMeshPeer(peerInfo) {
  const peerHostObj = {
    id: `peer-${peerInfo.route}-${peerInfo.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    name: `${peerInfo.name} (${peerInfo.route.toUpperCase()})`,
    host: peerInfo.host,
    port: 22,
    user: 'root',
    auth_type: 'password',
    key_path: null,
    password: '',
    network_route: 'mesh',
    has_docker: false,
    enable_port_scan: false,
    icon: '&#xf3ed;',
  };

  connectToHost(peerHostObj);
}

function refreshActiveMeshSilent() {
  const profiles = appConfig.wireguard_profiles || [];
  invoke('get_wireguard_runtime_statuses', { profiles })
    .then((statuses) => {
      if (statuses) {
        wgStatusesCache = statuses;
      }
    })
    .catch(() => {});
}

// ── Unified App Logs & Diagnostics Drawer ──
let isRenderingLogs = false;

async function renderLogsDrawer() {
  if (isRenderingLogs) return;
  const list = document.getElementById('logs-entries-list');
  const countBadge = document.getElementById('logs-count-badge');
  const levelFilter = document.getElementById('logs-level-filter')?.value || 'ALL';
  const searchQuery = (document.getElementById('logs-search-input')?.value || '').toLowerCase().trim();
  const autoScroll = document.getElementById('logs-autoscroll')?.checked ?? true;

  if (!list) return;

  isRenderingLogs = true;
  try {
    const rawLogs = await invoke('get_app_logs');
    const logs = Array.isArray(rawLogs) ? rawLogs : [];

    const filtered = logs.filter((entry) => {
      if (levelFilter !== 'ALL' && entry.level.toUpperCase() !== levelFilter) {
        return false;
      }
      if (searchQuery) {
        const hay = `${entry.time} ${entry.level} ${entry.source} ${entry.message}`.toLowerCase();
        if (!hay.includes(searchQuery)) return false;
      }
      return true;
    });

    if (countBadge) {
      countBadge.textContent = `${filtered.length} log${filtered.length === 1 ? '' : 's'}`;
    }

    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="logs-empty-state">
          <i class="fa" style="font-size: 24px; opacity: 0.5;">&#xf188;</i>
          <span>No logs recorded matching current filter</span>
        </div>
      `;
      return;
    }

    list.innerHTML = filtered.map((entry) => {
      const lvl = (entry.level || 'INFO').toLowerCase();
      const src = escapeHtml(entry.source || 'app');
      const time = escapeHtml(entry.time || '');
      const msg = escapeHtml(entry.message || '');
      const srcClass = src === 'webview' ? 'webview' : '';
      return `
        <div class="log-entry-row ${lvl}">
          <span class="log-entry-time">${time}</span>
          <span class="log-level-badge ${lvl}">${escapeHtml(entry.level || 'INFO')}</span>
          <span class="log-source-tag ${srcClass}">${src}</span>
          <span class="log-entry-msg">${msg}</span>
        </div>
      `;
    }).join('');

    if (autoScroll) {
      list.scrollTop = list.scrollHeight;
    }
  } catch (err) {
    console.error('Failed to fetch app logs:', err);
  } finally {
    isRenderingLogs = false;
  }
}

function setupLogsDrawer() {
  const levelFilter = document.getElementById('logs-level-filter');
  if (levelFilter) {
    levelFilter.addEventListener('change', () => renderLogsDrawer());
  }

  const searchInput = document.getElementById('logs-search-input');
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener('input', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => renderLogsDrawer(), 150);
    });
  }

  const refreshBtn = document.getElementById('logs-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => renderLogsDrawer());
  }

  const clearBtn = document.getElementById('logs-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      try {
        await invoke('clear_app_logs');
        renderLogsDrawer();
        showToast('App log buffer cleared', 'info');
      } catch (err) {
        showToast(`Failed to clear logs: ${err}`, 'error');
      }
    });
  }

  const copyBtn = document.getElementById('logs-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const text = await invoke('export_app_logs_text');
        await setSystemClipboardText(text || 'No logs');
        showToast('Logs copied to clipboard', 'success');
      } catch (err) {
        showToast(`Failed to copy logs: ${err}`, 'error');
      }
    });
  }

  const exportBtn = document.getElementById('logs-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const text = await invoke('export_app_logs_text');
        const blob = new Blob([text || ''], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `taris-app-logs-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Exported logs to text file', 'success');
      } catch (err) {
        showToast(`Failed to export logs: ${err}`, 'error');
      }
    });
  }
}

// ── Initialize App ──
window.addEventListener('DOMContentLoaded', async () => {
  setupActivityRailDragDrop();
  setupTabInteractivity();
  setupSplitters();
  setupCodeEditor();
  setupSettingsView();
  setupAddHostModal();
  setupTunnelModal();
  setupSnippetModal();
  setupControlledContextMenu();
  setupHostContextMenu();
  setupDatabaseView();
  setupSftpExplorer();
  setupSftpColumnResizers();
  setupSftpColumnContextMenu();
  setupAutoHideScrollbars();
  setupSftpContextMenu();
  setupSftpClipboardListener();
  setupTauriEventListeners();
  setupMeshDrawer();
  setupCloudDrawer();
  setupLogsDrawer();

  // Load config, real disk files & external editors
  await loadConfig();
  await loadAvailableShells();
  await loadLocalFiles();
  await loadExternalEditors();

  // Apply saved file column visibility preferences
  applyFileColumnVisibility();

  // Initialize primary local terminal tab & button states
  updateDockerButtonState('local');
  updatePortsButtonState('local');
  initTerminalSession('session-local', 'terminal-container-local', appConfig.settings.default_shell || 'powershell');

  // Start background periodic host alive checks (every 8s, minimal CPU load)
  pollHostsAlive();
  setInterval(pollHostsAlive, 8000);

  // Minimal rate background polling for Docker, PortScan, Tunnels & WireGuard/Mesh & Logs
  setInterval(() => {
    if (activeCategory === 'docker') {
      refreshDockerSilent();
    } else if (activeCategory === 'ports') {
      refreshPortsSilent();
    } else if (activeCategory === 'tunnels') {
      renderTunnelsDrawer();
    } else if (activeCategory === 'wireguard') {
      refreshActiveMeshSilent();
    } else if (activeCategory === 'logs') {
      renderLogsDrawer();
    }
  }, 3000);

  // Start remote telemetry polling (runs only when active connected remote tab is open)
  updateRemoteTelemetry();
  setInterval(updateRemoteTelemetry, 3000);

  // Auto-resize on window resize
  window.addEventListener('resize', resizeAllTerminals);
});

