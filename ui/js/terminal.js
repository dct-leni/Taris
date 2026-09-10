// ── 2. Terminal Engine (xterm.js + ConPTY Channel Streaming) ──
const terminalSessions = {};

let THEMES = {};
let availableThemesList = [];

// Fallback theme in case filesystem or network is temporarily unavailable
const DEFAULT_FALLBACK_THEME = {
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
};

async function loadAllTerminalThemes() {
  try {
    // 1. Try loading from Tauri backend command scanning ui/themes/*.json
    if (window.__TAURI__ && typeof invoke === 'function') {
      try {
        const items = await invoke('load_all_terminal_themes');
        if (Array.isArray(items) && items.length > 0) {
          availableThemesList = items;
          for (const item of items) {
            if (item && item.id && item.theme) {
              THEMES[item.id] = item.theme;
            }
          }
          syncTerminalThemeSelectUI();
          return THEMES;
        }
      } catch (err) {
        console.warn('Backend load_all_terminal_themes failed, falling back to static fetch:', err);
      }
    }

    // 2. Fallback: fetch theme files directly from themes/
    const defaultIds = [
      'one_dark', 'tokyo_night', 'dracula', 'catppuccin', 'nord',
      'monokai_pro', 'solarized_dark', 'gruvbox_dark', 'synthwave', 'alacritty_dark'
    ];
    await Promise.all(
      defaultIds.map(async (id) => {
        try {
          const resp = await fetch(`themes/${id}.json`);
          if (resp.ok) {
            const data = await resp.json();
            THEMES[id] = data;
          }
        } catch (_) {}
      })
    );

    // Merge any custom themes stored in appConfig
    if (appConfig?.settings?.custom_themes) {
      for (const [key, val] of Object.entries(appConfig.settings.custom_themes)) {
        if (val && val.theme) {
          THEMES[key] = val.theme;
        }
      }
    }

    syncTerminalThemeSelectUI();
  } catch (e) {
    console.error('Error loading terminal theme files:', e);
  }
  return THEMES;
}

function syncTerminalThemeSelectUI() {
  const termThemeSelect = document.getElementById('setting-terminal-theme');
  if (!termThemeSelect) return;

  const currentVal = termThemeSelect.value || appConfig?.settings?.terminal_theme || 'one_dark';
  termThemeSelect.innerHTML = '';

  const themeDisplayNames = {
    one_dark: 'One Dark Pro',
    tokyo_night: 'Tokyo Night',
    dracula: 'Dracula',
    catppuccin: 'Catppuccin Mocha',
    nord: 'Nord Arctic',
    monokai_pro: 'Monokai Pro',
    solarized_dark: 'Solarized Dark',
    gruvbox_dark: 'Gruvbox Dark',
    synthwave: "Synthwave '84",
    alacritty_dark: 'Alacritty Dark',
  };

  const allKeys = Object.keys(THEMES);
  for (const key of allKeys) {
    const opt = document.createElement('option');
    opt.value = key;
    const themeObj = THEMES[key];
    const name = themeObj?.name || themeDisplayNames[key] || (key.startsWith('custom_') ? `Custom: ${key.slice(7)}` : key);
    opt.textContent = name;
    termThemeSelect.appendChild(opt);
  }

  if (THEMES[currentVal]) {
    termThemeSelect.value = currentVal;
  } else if (THEMES['one_dark']) {
    termThemeSelect.value = 'one_dark';
  }
}

function getXtermTheme(themeName) {
  return THEMES[themeName] || THEMES.one_dark || DEFAULT_FALLBACK_THEME;
}

// ── Terminal CWD & Directory Following ──
let followTermDebounceTimer = null;

function notifyTerminalCwdChange(sessionId, rawPath) {
  if (!rawPath) return;

  // Docker container exec/logs sessions run inside an isolated container filesystem.
  // Never track CWD or attempt host SFTP operations for Docker containers.
  if (sessionId.startsWith('session-docker-') || sessionId.startsWith('docker-')) {
    return;
  }

  let path = rawPath.trim();
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  // Reject executable file paths (e.g. ConPTY window title 'C:\Program Files\Git\bin\bash.exe')
  if (/\.(exe|cmd|bat|com|dll|bin)$/i.test(path)) {
    return;
  }

  const sess = terminalSessions[sessionId];

  if (sess && sess.host) {
    sess.lastKnownPath = path;
    sftpRemotePaths[sess.host.id] = path;
  } else if (sessionId.startsWith('session-wsl-')) {
    // WSL terminal CWD is not tracked for file explorer following
    return;
  } else {
    // Local terminal session
    const resolvedPath = typeof normalizeWslPath === 'function' ? normalizeWslPath(path, null) : path;
    if (sess) sess.lastKnownPath = resolvedPath;
    if (!resolvedPath.startsWith('\\\\wsl') && !resolvedPath.startsWith('/')) {
      if (typeof sftpTrueLocalPath !== 'undefined') {
        sftpTrueLocalPath = resolvedPath;
      }
      sftpLocalPath = resolvedPath;
    }
  }

  // Check if this session is the active tab
  const activeTab = document.querySelector('.tab-card.active');
  const activeView = activeTab?.getAttribute('data-view') || '';
  const isCurrentActive =
    (activeView && sessionId.includes(activeView)) ||
    (activeView === 'local' && sessionId === 'session-local') ||
    (!activeView && sessionId === 'session-local');

  if (!isCurrentActive) return;
  if (typeof sftpFollowTerminalEnabled !== 'undefined' && !sftpFollowTerminalEnabled) return;

  if (followTermDebounceTimer) clearTimeout(followTermDebounceTimer);
  followTermDebounceTimer = setTimeout(() => {
    const fileContainer = document.getElementById('sftp-file-list');
    const hasFiles = fileContainer && fileContainer.querySelectorAll('.file-row').length > 0;

    if (sess && sess.host) {
      if (hasFiles && sftpMode === 'remote' && sftpCurrentHost?.id === sess.host.id && sftpCurrentPath === path) {
        return;
      }
      if (typeof loadRemoteFiles === 'function') {
        loadRemoteFiles(sess.host, path);
      }
    } else if (sessionId.startsWith('session-wsl-')) {
      // Do not follow terminal for WSL
      return;
    } else {
      const localPath = (typeof sftpTrueLocalPath !== 'undefined' && sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
        ? sftpTrueLocalPath
        : (!path.startsWith('\\\\wsl') && !path.startsWith('/') ? path : '.');
      if (hasFiles && sftpMode === 'local' && sftpCurrentPath === localPath) {
        return;
      }
      if (typeof loadLocalFiles === 'function') {
        loadLocalFiles(localPath);
      }
    }
  }, 200);
}

function extractPathFromPrompt(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Scan backwards from the most recent output lines
  for (let idx = lines.length - 1; idx >= Math.max(0, lines.length - 4); idx--) {
    const clean = lines[idx];

    // Pattern 1: Linux user@host:... [$#%=>❯›»➜]
    // e.g. "leni@ubuntu:/home/leni$ ", "gmktec@GMKtec:~$ ", "[user@host /var/log]# "
    const linuxM = clean.match(/(?:^|[\r\n]|\])\s*(?:\[?[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+[:\s]+)([\/~][^\r\n$#%>\s\]]*)(?:\])?(?:\s+[\[\(][^\r\n]*?[\]\)])?\s*[\$#%=>❯›»➜]\s*$/);
    if (linuxM && linuxM[1]) {
      return linuxM[1].trim();
    }

    // Pattern 2: Bracketed prompt e.g. "[user@hostname path]$ " or "[path]$ "
    const bracketM = clean.match(/\[(?:[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\s+)?([\/~][^\]\r\n]*)\](?:\s+[\[\(][^\r\n]*?[\]\)])?\s*[\$#%=>❯›»➜]\s*$/);
    if (bracketM && bracketM[1]) {
      return bracketM[1].trim();
    }

    // Pattern 3: Host or root prompt e.g. "GMKtec:/home/user# " or "user:/var/log$ "
    const hostM = clean.match(/^(?:[a-zA-Z0-9._-]+:)([\/~][^\r\n$#%>\s\]]*)\s*[\$#%=>❯›»➜]\s*$/);
    if (hostM && hostM[1]) {
      return hostM[1].trim();
    }

    // Pattern 4: Modern Starship / Oh-My-Zsh / fish "in ~/dir on main ❯ " or "~/dir % " or "path ❯ "
    const modernM = clean.match(/^(?:.*?\bin\s+)?([\/~][^\r\n$#%>\s\]]*)(?:\s+on\s+[^\r\n$#%>\s]+)?(?:\s+[\[\(][^\r\n]*?[\]\)])?\s*[\$#%=>❯›»➜]\s*$/);
    if (modernM && modernM[1]) {
      return modernM[1].trim();
    }

    // Pattern 5: Git Bash "user@host MINGW64 /path (main)$ " or "/c/Users/... (main)$ "
    const gitBashM = clean.match(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\s+MINGW(?:32|64)\s+([\/~][^\r\n$#%>\s]*)(?:\s+[\[\(][^\r\n]*?[\]\)])?\s*[\$#%=>]\s*$/);
    if (gitBashM && gitBashM[1]) {
      let gbPath = gitBashM[1].trim();
      const driveM = gbPath.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
      if (driveM) {
        gbPath = `${driveM[1].toUpperCase()}:/${driveM[2] || ''}`;
      }
      return gbPath;
    }

    // Pattern 6: Windows PowerShell "PS C:\path> " or "PS C:\path [main]> "
    const psM = clean.match(/^PS\s+([a-zA-Z]:\\[^\r\n>\[\(]*?)(?:\s+[\[\(][^\r\n]*?[\]\)])?\s*>\s*$/);
    if (psM && psM[1]) {
      return psM[1].trim();
    }

    // Pattern 7: Windows CMD "C:\path> "
    const cmdM = clean.match(/^([a-zA-Z]:\\[^\r\n>\[\(]*?)\s*>\s*$/);
    if (cmdM && cmdM[1]) {
      return cmdM[1].trim();
    }
  }

  return null;
}

function extractPathFromTerminalTitle(title) {
  if (!title) return null;
  const clean = title.trim();

  // Reject executable file names or paths in title (e.g. ConPTY "C:\Program Files\Git\bin\bash.exe")
  if (/\.(exe|cmd|bat|com|dll|bin)$/i.test(clean)) {
    return null;
  }

  // Match Windows drive "C:\path" or "C:/path"
  const winM = clean.match(/(?:^.*?:|^)\s*([a-zA-Z]:[\\\/][^\r\n]*)$/);
  if (winM && winM[1]) {
    const p = winM[1].trim();
    if (!/\.(exe|cmd|bat|com|dll|bin)$/i.test(p)) return p;
  }

  // Match "user@host: /path" or "user@host: ~/path" or "host: /path" or "title: /path"
  const m = clean.match(/(?:^.*?:|^)\s*([\/~][^\r\n]*)$/);
  if (m && m[1]) {
    let p = m[1].trim();
    if (/\.(exe|cmd|bat|com|dll|bin)$/i.test(p)) return null;
    // Translate Git Bash drive mount "/c/Users/..." to "C:/Users/..."
    const gbM = p.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
    if (gbM) {
      p = `${gbM[1].toUpperCase()}:/${gbM[2] || ''}`;
    }
    return p;
  }

  return null;
}

function extractPathFromOsc7(data) {
  if (!data) return null;
  let path = data.trim();
  if (path.startsWith('file://')) {
    const slashIdx = path.indexOf('/', 7);
    if (slashIdx !== -1) {
      path = path.slice(slashIdx);
    } else {
      path = path.replace(/^file:\/\/[^\/]*/, '');
    }
  }
  try {
    path = decodeURIComponent(path);
  } catch (_) {}
  return path.trim() || null;
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
    scrollback: parseInt(appConfig.settings.scrollback) || 2500,
  });

  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  setTimeout(() => {
    resizeSession({ term, fitAddon, containerId });
    term.focus();
  }, 60);

  let streamTextBuffer = '';

  const stripAnsi = (str) =>
    str
      .replace(/\x1B\][^\x07\x1B]*?(?:\x07|\x1B\\)/g, '')
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/\x1B[@-Z\\-_]/g, '')
      .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');

  // Debounced prompt path extraction to prevent stalling the UI thread on high-volume terminal output
  let promptExtractionTimer = null;
  const schedulePromptPathExtraction = (delay = 180) => {
    if (promptExtractionTimer) clearTimeout(promptExtractionTimer);
    promptExtractionTimer = setTimeout(() => {
      if (!streamTextBuffer) return;
      const cleanOutput = stripAnsi(streamTextBuffer);
      const promptPath = extractPathFromPrompt(cleanOutput);
      if (promptPath) {
        notifyTerminalCwdChange(sessionId, promptPath);
      }
    }, delay);
  };

  // Tauri v2 Streaming Channel: directly receives ConPTY output
  const onData = new Channel();
  onData.onmessage = (chunk) => {
    term.write(chunk);

    if (chunk && (chunk.includes('[Connection closed]') || chunk.includes('[Process completed]'))) {
      const s = terminalSessions[sessionId];
      if (s) s.connected = false;
      if (sessionId.startsWith('session-wsl-')) {
        const view = sessionId.replace('session-', '');
        const tabToClose = document.querySelector(`.tab-card[data-view="${view}"]`);
        if (tabToClose) {
          const closeBtn = tabToClose.querySelector('.tab-close');
          if (closeBtn) {
            setTimeout(() => {
              try { closeBtn.click(); } catch (_) {}
            }, 120);
          }
        }
      }
    }

    // Maintain stream buffer for real-time prompt detection
    streamTextBuffer += chunk;
    if (streamTextBuffer.length > 2000) {
      streamTextBuffer = streamTextBuffer.slice(-2000);
    }

    // Fast-path guard: only check OSC sequences if chunk contains escape sequence '\x1B]'
    if (chunk && chunk.includes('\x1B]')) {
      const osc7Match = chunk.match(/\x1B\]7;file:\/\/(?:[^\/]*)\/([^\x07\x1B]+)(?:\x07|\x1B\\)/);
      if (osc7Match) {
        notifyTerminalCwdChange(sessionId, extractPathFromOsc7('file:///' + osc7Match[1]));
      } else {
        const osc9Match = chunk.match(/\x1B\]9;9;["]?([^\x07\x1B"]+)["]?(?:\x07|\x1B\\)/);
        if (osc9Match) {
          notifyTerminalCwdChange(sessionId, osc9Match[1].trim());
        } else {
          const osc1337Match = chunk.match(/\x1B\]1337;CurrentDir=([^\x07\x1B]+)(?:\x07|\x1B\\)/);
          if (osc1337Match) {
            notifyTerminalCwdChange(sessionId, osc1337Match[1].trim());
          }
        }
      }
    } else {
      // Active streaming: debounce regex extraction until output stream pauses (idle)
      schedulePromptPathExtraction(180);
    }
  };

  // Track window title updates (standard in default Linux bash/zsh/vte for directory tracking)
  term.onTitleChange((title) => {
    const p = extractPathFromTerminalTitle(title);
    if (p) {
      notifyTerminalCwdChange(sessionId, p);
    }
  });

  // Register xterm OSC parser handlers if supported by engine
  try {
    if (term.parser && typeof term.parser.registerOscHandler === 'function') {
      term.parser.registerOscHandler(7, (data) => {
        const p = extractPathFromOsc7(data);
        if (p) notifyTerminalCwdChange(sessionId, p);
        return true;
      });
      term.parser.registerOscHandler(9, (data) => {
        if (data && data.startsWith('9;')) {
          const p = data.slice(2).trim().replace(/^["']|["']$/g, '');
          if (p) notifyTerminalCwdChange(sessionId, p);
          return true;
        }
        return false;
      });
    }
  } catch (_) {}

  // Pipe user input to backend PTY & track 'cd <path>' commands
  let inputLineBuffer = '';
  let lineHadTab = false;
  term.onData((data) => {
    invoke('pty_write', { sessionId: sessionId, data: data }).catch(console.error);

    // If Tab key was typed, remote shell handles autocompletion
    if (data.includes('\t')) {
      lineHadTab = true;
    }

    // Skip escape sequences (arrows, home, end, etc.) and mark line tainted
    if (data.includes('\x1b')) {
      lineHadTab = true;
      return;
    }

    // Keystroke parsing for cd commands
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (ch === '\t') {
        lineHadTab = true;
      } else if (ch === '\r' || ch === '\n') {
        const line = inputLineBuffer.trim();
        const hadTab = lineHadTab;
        inputLineBuffer = '';
        lineHadTab = false;
        schedulePromptPathExtraction(100);

        // If Tab was pressed on this line, shell completed the path on the host!
        // DO NOT guess from incomplete keystrokes — prompt/title/OSC will provide authoritative CWD
        if (hadTab) {
          // Check terminal buffer after a short grace period for the new prompt
          setTimeout(() => {
            try {
              if (term && term.buffer && term.buffer.active) {
                const buf = term.buffer.active;
                for (let r = buf.cursorY; r >= Math.max(0, buf.cursorY - 2); r--) {
                  const lineText = buf.getLine(r)?.translateToString(true) || '';
                  const p = extractPathFromPrompt(lineText);
                  if (p) {
                    notifyTerminalCwdChange(sessionId, p);
                    break;
                  }
                }
              }
            } catch (_) {}
          }, 80);
          continue;
        }

        if (line) {
          const cdMatch = line.match(/^cd(?:\s+(.*))?$/);
          if (cdMatch) {
            let target = (cdMatch[1] || '').trim().replace(/^["']|["']$/g, '');
            const sess = terminalSessions[sessionId];
            const current = (sess && sess.lastKnownPath) || (sess && sess.host ? '~' : '.');
            let resolved = target;

            if (!target || target === '~') {
              resolved = '~';
            } else if (target.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(target)) {
              resolved = target;
            } else if (target === '..') {
              if (current === '/' || current === '~') {
                resolved = current;
              } else {
                const parts = current.replace(/\\/g, '/').split('/').filter(Boolean);
                parts.pop();
                resolved = current.startsWith('/') ? '/' + parts.join('/') : parts.join('/') || '.';
              }
            } else if (target.startsWith('../')) {
              let parts = current.replace(/\\/g, '/').split('/').filter(Boolean);
              const subparts = target.split('/');
              for (const p of subparts) {
                if (p === '..') {
                  if (parts.length > 0) parts.pop();
                } else if (p && p !== '.') {
                  parts.push(p);
                }
              }
              resolved = current.startsWith('/') ? '/' + parts.join('/') : parts.join('/') || '.';
            } else if (!target.startsWith('-')) {
              const cleanCurr = current.trimEnd();
              if (cleanCurr === '/' || cleanCurr === '~') {
                resolved = `${cleanCurr === '/' ? '' : '~'}/${target}`;
              } else {
                resolved = `${cleanCurr}/${target}`.replace(/\/+/g, '/');
              }
            }

            // Only notify as a fallback if prompt/title hasn't already updated the path
            if (resolved) {
              const prevPath = sess ? sess.lastKnownPath : null;
              setTimeout(() => {
                const currentSess = terminalSessions[sessionId];
                if (currentSess && currentSess.lastKnownPath !== prevPath) {
                  return; // Prompt or title already set the correct CWD
                }
                notifyTerminalCwdChange(sessionId, resolved);
              }, 400);
            }
          }
        }
      } else if (ch === '\x7f' || ch === '\x08') {
        inputLineBuffer = inputLineBuffer.slice(0, -1);
      } else if (ch === '\x03' || ch === '\x15') {
        inputLineBuffer = '';
        lineHadTab = false;
      } else if (ch >= ' ' && ch <= '~') {
        inputLineBuffer += ch;
      }
    }
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

  // Spawn backend PTY (local or native async russh channel if host is provided)
  invoke('pty_spawn', {
    sessionId: sessionId,
    shellType: shellType,
    cols: term.cols || 80,
    rows: term.rows || 24,
    host: options.host || null,
    command: options.command || null,
    onData: onData,
  }).catch((err) => {
    console.error('pty_spawn error:', err);
    term.write(`\r\n\x1b[31m[Error launching session: ${err}]\x1b[0m\r\n`);
  });

  // Listen for in-band ZMODEM transfer events
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen(`zmodem-event-${sessionId}`, (e) => {
      const payload = e.payload;
      if (!payload) return;
      if (payload.type === 'DownloadOffer') {
        showToast(`📥 ZMODEM download offered: ${payload.data.filename || 'file'}`, 'info');
      } else if (payload.type === 'UploadRequest') {
        showToast('📤 ZMODEM ready for upload (rz active)', 'info');
      } else if (payload.type === 'Complete') {
        showToast(`✓ ZMODEM transfer complete: ${payload.data.filename}`, 'success');
      } else if (payload.type === 'Canceled') {
        showToast(`⚠️ ZMODEM canceled: ${payload.data.reason}`, 'warning');
      }
    }).catch?.(() => {});
  }

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

  terminalSessions[sessionId] = {
    sessionId,
    term,
    fitAddon,
    containerId,
    shellType,
    options,
    host: options.host || null,
    lastKnownPath: options.host ? (sftpRemotePaths[options.host.id] || '~') : (sftpLocalPath || '.'),
  };
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
  if (view) {
    const candidateId = `session-${view}`;
    if (terminalSessions[candidateId]) {
      sessId = candidateId;
    } else if (view.startsWith('host-') || view.startsWith('local-') || view.startsWith('docker-') || view.startsWith('wsl-')) {
      sessId = candidateId;
    }
  }
  if (terminalSessions[sessId]) {
    resizeSession(terminalSessions[sessId]);
  }
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
  themeObj.name = themeName;
  THEMES[cleanId] = themeObj;

  // Persist palette as a file on disk via backend Tauri command
  try {
    if (window.__TAURI__ && typeof invoke === 'function') {
      await invoke('save_terminal_theme', {
        name: cleanId,
        themeJson: JSON.stringify(themeObj, null, 2),
      });
    }
  } catch (err) {
    console.warn('Could not save theme file to disk, persisting in appConfig:', err);
  }

  if (!appConfig.settings.custom_themes) {
    appConfig.settings.custom_themes = {};
  }
  appConfig.settings.custom_themes[cleanId] = {
    name: themeName,
    theme: themeObj,
  };

  syncTerminalThemeSelectUI();
  applyTerminalTheme(cleanId);
  persistConfig(true);
  showToast(`✓ Imported and saved terminal palette file: ${themeName}`, 'success');
}
