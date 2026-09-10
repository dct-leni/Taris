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

  // Re-render snippet notes so commands match the active terminal theme palette
  renderSnippetsList();
}

function applyTheme(themeName) {
  applyAppTheme(themeName);
}

function applyFont(fontFamily) {
  if (!fontFamily) fontFamily = 'Cascadia Code';
  appConfig.settings.font_family = fontFamily;
  document.documentElement.style.setProperty('--font-main', `'${fontFamily}', monospace`);

  const select = document.getElementById('setting-font-family');
  const customRow = document.getElementById('setting-custom-font-row');
  const customInput = document.getElementById('setting-custom-font-input');

  if (select) {
    let found = false;
    for (let opt of select.options) {
      if (opt.value === fontFamily) {
        select.value = fontFamily;
        found = true;
        break;
      }
    }
    if (!found) {
      select.value = '__custom__';
      if (customRow) customRow.style.display = 'flex';
      if (customInput) customInput.value = fontFamily;
    } else {
      if (customRow) {
        customRow.style.display = (select.value === '__custom__') ? 'flex' : 'none';
      }
    }
  }

  Object.values(terminalSessions).forEach((sess) => {
    if (sess && sess.term) {
      sess.term.options.fontFamily = fontFamily;
      resizeSession(sess);
    }
  });

  renderSnippetsList();
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
  const s = Math.max(100, Math.min(100000, parseInt(lines) || 2500));
  appConfig.settings.scrollback = s;
  const input = document.getElementById('setting-scrollback');
  if (input) input.value = s;

  Object.values(terminalSessions).forEach((sess) => {
    if (sess?.term) {
      sess.term.options.scrollback = s;
    }
  });
}


async function updateMcpStatusUI() {
  const statusText = document.getElementById('mcp-status-text');
  if (!statusText) return;
  try {
    const status = await invoke('get_mcp_status');
    if (status && status.active) {
      statusText.innerHTML = `<i class="fa" style="color: #4ec9b0;">&#xf111;</i> Active: ${status.url}`;
    } else {
      statusText.innerHTML = `<i class="fa" style="color: #666;">&#xf111;</i> Stopped`;
    }
  } catch (err) {
    statusText.innerHTML = `<i class="fa" style="color: #e06c75;">&#xf111;</i> Off`;
  }
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

  // Font family dropdown & custom font input
  const fontSelect = document.getElementById('setting-font-family');
  const customFontRow = document.getElementById('setting-custom-font-row');
  const customFontInput = document.getElementById('setting-custom-font-input');

  if (fontSelect) {
    fontSelect.addEventListener('change', (e) => {
      if (e.target.value === '__custom__') {
        if (customFontRow) customFontRow.style.display = 'flex';
        if (customFontInput) {
          customFontInput.focus();
          if (customFontInput.value.trim()) {
            applyFont(customFontInput.value.trim());
            persistConfig();
          }
        }
      } else {
        if (customFontRow) customFontRow.style.display = 'none';
        applyFont(e.target.value);
        persistConfig();
      }
    });
  }

  if (customFontInput) {
    let fontDebounce = null;
    customFontInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (fontDebounce) clearTimeout(fontDebounce);
      fontDebounce = setTimeout(() => {
        if (val) {
          applyFont(val);
          persistConfig();
        }
      }, 300);
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
      if (typeof updateLocalTabTitle === 'function') {
        updateLocalTabTitle(e.target.value);
      }
      persistConfig();
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

  // MCP Server Toggle & Port
  const mcpCheckbox = document.getElementById('setting-enable-mcp-server');
  const mcpBox = document.getElementById('mcp-server-config');
  const mcpPortInput = document.getElementById('setting-mcp-port');
  const copyMcpBtn = document.getElementById('btn-copy-mcp-endpoint');

  if (mcpCheckbox) {
    mcpCheckbox.addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      const port = parseInt(mcpPortInput?.value) || 8765;
      if (mcpBox) mcpBox.style.display = enabled ? 'block' : 'none';
      try {
        const res = await invoke('toggle_mcp_server', { enabled, port });
        appConfig.settings.enable_mcp_server = enabled;
        appConfig.settings.mcp_server_port = res.port;
        updateMcpStatusUI();
        showToast(enabled ? `MCP server listening on port ${res.port}` : 'MCP server stopped', 'info');
      } catch (err) {
        console.error('Failed to toggle MCP server:', err);
        showToast(`MCP error: ${err}`, 'error');
      }
    });
  }

  if (mcpPortInput) {
    mcpPortInput.addEventListener('change', async (e) => {
      const port = parseInt(e.target.value) || 8765;
      appConfig.settings.mcp_server_port = port;
      if (mcpCheckbox && mcpCheckbox.checked) {
        try {
          await invoke('toggle_mcp_server', { enabled: true, port });
          updateMcpStatusUI();
          showToast(`MCP server port updated to ${port}`, 'info');
        } catch (err) {
          console.error('Failed to update MCP port:', err);
        }
      }
    });
  }

  if (copyMcpBtn) {
    copyMcpBtn.addEventListener('click', () => {
      const port = parseInt(mcpPortInput?.value) || 8765;
      const url = `http://127.0.0.1:${port}/mcp`;
      navigator.clipboard.writeText(url).then(() => {
        showToast('MCP endpoint copied to clipboard', 'success');
      });
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
        if (mcpCheckbox) {
          appConfig.settings.enable_mcp_server = mcpCheckbox.checked;
        }
        if (mcpPortInput) {
          appConfig.settings.mcp_server_port = parseInt(mcpPortInput.value) || 8765;
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
