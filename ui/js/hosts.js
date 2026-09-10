// ── 4. Portable Config & Drawer Loading ──
async function loadConfig() {
  try {
    const cfg = await invoke('get_config');
    if (cfg && cfg.settings) {
      appConfig = cfg;
      isConfigLoaded = true;

      // Load all terminal themes from files
      if (typeof loadAllTerminalThemes === 'function') {
        await loadAllTerminalThemes();
      }

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
      applyScrollback(cfg.settings.scrollback || 2500);
      if (document.getElementById('setting-default-shell')) {
        document.getElementById('setting-default-shell').value = cfg.settings.default_shell || 'powershell';
      }
      if (typeof updateLocalTabTitle === 'function') {
        updateLocalTabTitle(cfg.settings.default_shell);
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
      if (document.getElementById('setting-enable-mcp-server')) {
        const mcpEnabled = cfg.settings.enable_mcp_server === true;
        document.getElementById('setting-enable-mcp-server').checked = mcpEnabled;
        const mcpBox = document.getElementById('mcp-server-config');
        if (mcpBox) mcpBox.style.display = mcpEnabled ? 'block' : 'none';
        if (document.getElementById('setting-mcp-port')) {
          document.getElementById('setting-mcp-port').value = cfg.settings.mcp_server_port || 8765;
        }
        if (typeof updateMcpStatusUI === 'function') {
          updateMcpStatusUI();
        }
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

      console.info(
        `[Taris] Config loaded: ${cfg.hosts ? cfg.hosts.length : 0} hosts, ` +
        `WireGuard: ${cfg.wireguard_profiles ? cfg.wireguard_profiles.length : 0}, ` +
        `Tailscale: ${!!cfg.tailscale}, NetBird: ${!!cfg.netbird}`
      );
      if (!cfg.hosts || cfg.hosts.length === 0) {
        console.warn('[Taris] Warning: 0 hosts configured in loaded config.');
      }
      await loadUsedHostIcons(cfg.hosts || []);
      renderHostsList(cfg.hosts || []);
      renderUnifiedMeshDrawer();
      resizeAllTerminals();
    } else {
      console.error('[Taris] Received empty or invalid config from backend:', cfg);
    }
  } catch (e) {
    console.error('Failed to load config.toml:', e);
  }
}

let hostSearchText = '';
window.hostSearchText = '';
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

let hostIconMap = new Map();
let isLoadingIcons = false;

async function loadUsedHostIcons(hosts) {
  if (!hosts || hosts.length === 0) return;
  const idsToFetch = [];
  hosts.forEach((h) => {
    if (!h.icon) return;
    let cleanId = h.icon.trim();
    if (cleanId.startsWith('icons/')) cleanId = cleanId.slice(6);
    if (cleanId.endsWith('.svg')) cleanId = cleanId.slice(0, -4);
    if (cleanId === '' || cleanId === '&#xf233;' || (cleanId.length === 1 && cleanId.charCodeAt(0) === 0xf233)) {
      cleanId = 'server';
    }
    if (!hostIconMap.has(cleanId.toLowerCase())) {
      idsToFetch.push(cleanId);
    }
  });

  if (idsToFetch.length > 0) {
    try {
      const fetched = await invoke('get_host_icons', { ids: idsToFetch });
      if (fetched) {
        for (const [k, v] of Object.entries(fetched)) {
          hostIconMap.set(k.toLowerCase(), v);
          if (v.id) hostIconMap.set(v.id.toLowerCase(), v);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch host icons:', e);
    }
  }
}

async function ensureAllIconsLoaded() {
  if (Array.isArray(window.ALL_ICONS) && window.ALL_ICONS.length > 0) return window.ALL_ICONS;
  if (isLoadingIcons) {
    while (isLoadingIcons) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return window.ALL_ICONS || [];
  }

  isLoadingIcons = true;
  try {
    const res = await fetch('icons.json');
    if (res.ok) {
      window.ALL_ICONS = await res.json();
      for (let i = 0; i < window.ALL_ICONS.length; i++) {
        const item = window.ALL_ICONS[i];
        if (item && item.id) {
          hostIconMap.set(item.id.toLowerCase(), item);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load icons.json:', err);
  } finally {
    isLoadingIcons = false;
  }
  return window.ALL_ICONS || [];
}

function getHostIconItem(cleanId, iconStr) {
  if (hostIconMap.size > 0) {
    const item = hostIconMap.get(cleanId.toLowerCase()) || hostIconMap.get(iconStr.toLowerCase());
    if (item) return item;
  }
  if (Array.isArray(window.ALL_ICONS)) {
    return window.ALL_ICONS.find((i) => i.id.toLowerCase() === cleanId.toLowerCase() || i.id.toLowerCase() === iconStr.toLowerCase());
  }
  return null;
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

  // Look up in window.ALL_ICONS via indexed Map for O(1) performance
  const item = getHostIconItem(cleanId, iconStr);
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

  // Ensure search input is wired for live host and WSL filtering
  const searchInput = document.getElementById('drawer-search-input');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = 'true';
    searchInput.addEventListener('input', (e) => {
      if (typeof activeCategory !== 'undefined' && activeCategory === 'wsl') {
        if (typeof wslFilterText !== 'undefined') wslFilterText = e.target.value;
        window.wslFilterText = e.target.value;
        if (typeof renderWslDrawer === 'function') renderWslDrawer();
      } else {
        if (typeof hostSearchText !== 'undefined') hostSearchText = e.target.value.toLowerCase().trim();
        window.hostSearchText = e.target.value.toLowerCase().trim();
        if (typeof renderHostsList === 'function') renderHostsList(appConfig.hosts || []);
      }
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

    const moshPillHtml = h.protocol === 'mosh' ? `<span class="host-cloud-pill" style="background: rgba(229,192,123,0.15); color: #e5c07b; border: 1px solid rgba(229,192,123,0.3);"><i class="fa" style="font-size: 8px;">&#xf0e7;</i> MOSH</span>` : '';

    item.innerHTML = `
      <span class="${dotClass}" title="${dotTitle}"></span>
      <div class="host-icon-box">${iconHtml}</div>
      <span class="host-name" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}${cloudPillHtml}${routePillHtml}${moshPillHtml}</span>
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
      const inst = {
        id: h.cloud_instance_id || h.id,
        name: h.name,
        provider: h.cloud_provider,
        project_id: h.cloud_project_id || '',
        zone: h.cloud_zone || '',
        external_ip: h.host && h.host !== '127.0.0.1' ? h.host : null,
        internal_ip: null,
      };
      const ep = await invoke('get_cloud_instance_ssh_endpoint', { instance: inst });
      targetHost = ep.host || '127.0.0.1';
      targetPort = ep.port || 22;
      showToast(`${h.cloud_provider.toUpperCase()} tunnel active on ${targetHost}:${targetPort}`, 'success');
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
    const moshBadgeHtml = h.protocol === 'mosh' ? '<span class="badge-mosh" title="Mosh (Mobile Shell) - Roaming & Predictive Echo" style="font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(229, 192, 123, 0.18); color: #e5c07b; margin-left: 4px; border: 1px solid rgba(229, 192, 123, 0.3); font-family: var(--font-mono);"><i class="fa">&#xf0e7;</i> MOSH</span>' : '';
    tab.innerHTML = `
      ${tabIconHtml}
      <span class="online-dot ${isAlive ? 'active' : ''}" style="margin-right: -4px;"></span>
      <span class="tab-title">${escapeHtml(tabLabel)}</span>
      ${moshBadgeHtml}
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

  // 5. Initialize or focus terminal session
  initTerminalSession(sessionId, `terminal-container-${viewId}`, sshCmd, { host: h });
  updateHostStatusDots();
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
  const protocolSelect = document.getElementById('host-form-protocol');

  function updateNetworkRouteOptions(selectedRoute = 'direct') {
    if (!networkRouteSelect) return;
    let html = `
      <option value="direct">Direct Connect (Standard)</option>
      <option value="mesh">Active Mesh / VPN (Uses currently connected mesh)</option>
    `;
    if (appConfig?.tailscale?.enabled) {
      html += `<option value="tailscale">Tailscale (${appConfig.tailscale.name || 'Tailscale'})</option>`;
    }
    if (appConfig?.netbird?.enabled) {
      html += `<option value="netbird">NetBird (${appConfig.netbird.name || 'NetBird'})</option>`;
    }
    if (Array.isArray(appConfig?.wireguard_profiles)) {
      for (const p of appConfig.wireguard_profiles) {
        html += `<option value="wireguard:${p.id}">WireGuard: ${p.name || p.id}</option>`;
      }
    }
    networkRouteSelect.innerHTML = html;
    networkRouteSelect.value = selectedRoute || 'direct';
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

  async function renderIconGrid(filterText = '') {
    if (!iconGrid) return;
    await ensureAllIconsLoaded();
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
      if (protocolSelect) protocolSelect.value = 'ssh';
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
    if (protocolSelect) protocolSelect.value = h.protocol || 'ssh';
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
        protocol: (protocolSelect && protocolSelect.value === 'mosh') ? 'mosh' : null,
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

function setIdleTelemetryPlaceholders() {
  const fCpu = document.getElementById('footer-cpu');
  const fRam = document.getElementById('footer-ram');
  const fNetTx = document.getElementById('footer-net-tx');
  const fNetRx = document.getElementById('footer-net-rx');
  const fPing = document.getElementById('footer-ping-val');
  if (fCpu && fCpu.textContent !== '--') fCpu.textContent = '--';
  if (fRam && fRam.textContent !== '--') fRam.textContent = '--';
  if (fNetTx && fNetTx.textContent !== '-- KB/s') fNetTx.textContent = '-- KB/s';
  if (fNetRx && fNetRx.textContent !== '-- KB/s') fNetRx.textContent = '-- KB/s';
  if (fPing && fPing.textContent !== '--') { fPing.textContent = '--'; fPing.className = 'stat-val'; }
}

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
    setIdleTelemetryPlaceholders();
    return;
  }

  const hostId = view.replace('host-', '');
  const host = (appConfig.hosts || []).find((h) => h.id === hostId);
  if (!host) {
    setIdleTelemetryPlaceholders();
    return;
  }

  // Guard: if terminal session is closed or dead, do not query telemetry or hold connection
  const sess = typeof terminalSessions !== 'undefined' ? terminalSessions[`session-${view}`] : null;
  if (!sess || sess.connected === false) {
    setIdleTelemetryPlaceholders();
    return;
  }

  // Circuit breaker: skip if host is known offline or has accumulated failures
  if (window.hostAliveMap && window.hostAliveMap[hostId] === false) {
    setIdleTelemetryPlaceholders();
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

        if (fNetTx && fNetTx.textContent !== txStr) fNetTx.textContent = txStr;
        if (fNetRx && fNetRx.textContent !== rxStr) fNetRx.textContent = rxStr;
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

  document.getElementById('host-ctx-sftp')?.addEventListener('click', () => {
    document.getElementById('host-context-menu')?.classList.add('hidden');
    if (contextMenuTargetHost) {
      sftpMode = 'remote';
      sftpCurrentHost = contextMenuTargetHost;
      const railFilesBtn = document.getElementById('rail-btn-files');
      if (activeCategory !== 'files' && railFilesBtn) {
        railFilesBtn.click();
      } else {
        if (drawerTitle) drawerTitle.textContent = `FILES: ${contextMenuTargetHost.name}`;
        loadRemoteFiles(contextMenuTargetHost, sftpRemotePaths[contextMenuTargetHost.id] || '~');
      }
    }
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

function setupHostImporterModal() {
  const modal = document.getElementById('modal-import-hosts');
  const openBtn = document.getElementById('btn-open-import-hosts');
  const closeBtn = document.getElementById('modal-import-close-btn');
  const cancelBtn = document.getElementById('modal-import-cancel-btn');
  const confirmBtn = document.getElementById('modal-import-confirm-btn');
  const scanBtn = document.getElementById('btn-detect-system-hosts');
  const fileInput = document.getElementById('input-import-file');
  const selectAll = document.getElementById('import-select-all');
  const countEl = document.getElementById('import-detected-count');
  const listEl = document.getElementById('import-candidates-list');

  let detectedCandidates = [];

  const closeModal = () => modal?.classList.add('hidden');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      modal.classList.remove('hidden');
      if (detectedCandidates.length === 0) {
        scanSystemHosts();
      }
    });
  }

  async function scanSystemHosts() {
    if (!listEl) return;
    listEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--accent);"><i class="fa fa-spin">&#xf021;</i> Scanning OpenSSH, PuTTY, KiTTY, FileZilla, and WSL...</div>';
    if (confirmBtn) confirmBtn.disabled = true;

    try {
      const hosts = await invoke('detect_all_importable_hosts');
      renderCandidates(hosts || []);
    } catch (err) {
      console.error('Scan error:', err);
      listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--red);">Scan failed: ${escapeHtml(err.message || err)}</div>`;
    }
  }

  scanBtn?.addEventListener('click', scanSystemHosts);

  fileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const ext = file.name.split('.').pop().toLowerCase();
      const parsed = await invoke('parse_imported_host_file', { format: ext, content: text });
      renderCandidates(parsed || []);
      showToast(`Parsed ${parsed?.length || 0} host(s) from ${file.name}`, 'info');
    } catch (err) {
      console.error('Failed to parse import file:', err);
      showToast(`Import parse failed: ${err}`, 'error');
    }
  });

  function renderCandidates(candidates) {
    detectedCandidates = candidates || [];
    if (!listEl) return;

    if (detectedCandidates.length === 0) {
      listEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-subtle);">No SSH host profiles detected on this machine.</div>';
      if (countEl) countEl.textContent = '0 hosts found';
      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa">&#xf067;</i> Import Selected (0)';
      }
      return;
    }

    const existing = appConfig.hosts || [];
    const isExisting = (c) => existing.some((h) => (h.host === c.host && h.port === c.port && h.user === c.user) || h.name.toLowerCase() === c.name.toLowerCase());

    let html = '';
    detectedCandidates.forEach((c, idx) => {
      const dup = isExisting(c);
      const checked = !dup ? 'checked' : '';
      const sourceBadge = `<span style="font-size: 9px; padding: 1px 5px; border-radius: 2px; background: rgba(255,255,255,0.06); text-transform: uppercase; border: 1px solid var(--border);">${escapeHtml(c.source || 'ssh')}</span>`;
      const dupBadge = dup ? `<span style="font-size: 9px; padding: 1px 4px; border-radius: 2px; background: rgba(229,192,123,0.18); color: #e5c07b; margin-left: 4px;">ALREADY ADDED</span>` : '';

      html += `
        <label style="display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; background: ${dup ? 'rgba(0,0,0,0.1)' : 'transparent'};">
          <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
            <input type="checkbox" class="import-candidate-check" data-idx="${idx}" ${checked}>
            <i class="fa" style="color: var(--accent); font-size: 11px;">&#xf233;</i>
            <span style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
            ${dupBadge}
          </div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; font-family: var(--font-mono); color: var(--text-muted);">
            <span>${escapeHtml(c.user)}@${escapeHtml(c.host)}:${c.port}</span>
            ${sourceBadge}
          </div>
        </label>
      `;
    });

    listEl.innerHTML = html;
    if (countEl) countEl.textContent = `${detectedCandidates.length} candidate(s)`;
    updateSelectedCount();

    listEl.querySelectorAll('.import-candidate-check').forEach((cb) => {
      cb.addEventListener('change', updateSelectedCount);
    });
  }

  selectAll?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    listEl?.querySelectorAll('.import-candidate-check').forEach((cb) => (cb.checked = checked));
    updateSelectedCount();
  });

  function updateSelectedCount() {
    const checkedBoxes = listEl?.querySelectorAll('.import-candidate-check:checked') || [];
    const count = checkedBoxes.length;
    if (confirmBtn) {
      confirmBtn.disabled = count === 0;
      confirmBtn.innerHTML = `<i class="fa">&#xf067;</i> Import Selected (${count})`;
    }
  }

  confirmBtn?.addEventListener('click', async () => {
    const checkedBoxes = listEl?.querySelectorAll('.import-candidate-check:checked') || [];
    if (checkedBoxes.length === 0) return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Importing...';

    let importedCount = 0;
    for (const cb of checkedBoxes) {
      const idx = parseInt(cb.getAttribute('data-idx'));
      const c = detectedCandidates[idx];
      if (!c) continue;

      const newHost = {
        id: `host-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: c.name,
        host: c.host,
        port: c.port || 22,
        user: c.user || 'root',
        auth_type: c.auth_type || 'key',
        key_path: c.key_path || null,
        password: null,
        has_docker: true,
        enable_port_scan: true,
        mac_address: null,
        network_route: 'direct',
        protocol: null,
        cloud_provider: null,
        cloud_project_id: null,
        cloud_zone: null,
        cloud_instance_id: null,
        icon: c.icon || 'server',
      };

      try {
        const updated = await invoke('add_host', { host: newHost });
        if (updated) {
          appConfig = updated;
          importedCount++;
        }
      } catch (err) {
        console.error('Failed to import host:', err);
      }
    }

    renderHostsList(appConfig.hosts || []);
    showToast(`✓ Successfully imported ${importedCount} host(s)`, 'success');
    closeModal();
  });
}
