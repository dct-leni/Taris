// ── 16. Native WSL & Linux Virtual Machine Management ──
let wslStatus = { is_installed: false, distros: [], default_distro: null };
let wslFilterText = '';
window.wslFilterText = '';
let wslOnlineDistros = [
  { name: 'Ubuntu', friendly_name: 'Ubuntu' },
  { name: 'Debian', friendly_name: 'Debian GNU/Linux' },
  { name: 'kali-linux', friendly_name: 'Kali Linux Rolling' },
  { name: 'Ubuntu-24.04', friendly_name: 'Ubuntu 24.04 LTS' },
  { name: 'openSUSE-Tumbleweed', friendly_name: 'openSUSE Tumbleweed' }
];
let wslCatalogFilterText = '';
let wslActiveModalTab = 'catalog';

const WSL_ONLINE_SIZES = {
  'ubuntu': '~580 MB download (~1.4 GB disk)',
  'ubuntu-24.04': '~580 MB download (~1.4 GB disk)',
  'ubuntu-22.04': '~540 MB download (~1.3 GB disk)',
  'ubuntu-20.04': '~490 MB download (~1.2 GB disk)',
  'debian': '~140 MB download (~380 MB disk)',
  'kali-linux': '~320 MB download (~950 MB disk)',
  'opensuse-tumbleweed': '~310 MB download (~850 MB disk)',
  'opensuse-leap-15.6': '~290 MB download (~800 MB disk)',
  'suse-linux-enterprise-15-sp5': '~340 MB download (~900 MB disk)',
  'oraclelinux_8_5': '~390 MB download (~1.1 GB disk)',
  'oraclelinux_9_1': '~380 MB download (~1.0 GB disk)',
  'almalinux-8': '~250 MB download (~700 MB disk)',
  'almalinux-9': '~260 MB download (~720 MB disk)',
  'rocky-8': '~250 MB download (~700 MB disk)',
  'rocky-9': '~260 MB download (~720 MB disk)',
};

function getOnlineDistroSize(name) {
  if (!name) return '~450 MB download';
  const installed = (wslStatus.distros || []).find((d) => d.name.toLowerCase() === name.toLowerCase());
  if (installed && installed.image_size_formatted) {
    return `${installed.image_size_formatted} (installed)`;
  }
  const key = name.toLowerCase();
  if (WSL_ONLINE_SIZES[key]) {
    return WSL_ONLINE_SIZES[key];
  }
  for (const [k, v] of Object.entries(WSL_ONLINE_SIZES)) {
    if (key.includes(k) || k.includes(key)) {
      return v;
    }
  }
  return '~450 MB download';
}

async function checkWslAvailability() {
  try {
    const status = await invoke('wsl_get_status');
    wslStatus = status || { is_installed: false, distros: [], default_distro: null };
    const railBtnWsl = document.getElementById('rail-btn-wsl');
    if (railBtnWsl) {
      railBtnWsl.style.display = wslStatus.is_installed ? 'flex' : 'none';
    }
  } catch (err) {
    console.warn('WSL status check failed:', err);
  }
}

async function loadWslStatus(render = true) {
  try {
    const status = await invoke('wsl_get_status');
    wslStatus = status || { is_installed: false, distros: [], default_distro: null };
    const railBtnWsl = document.getElementById('rail-btn-wsl');
    if (railBtnWsl) {
      railBtnWsl.style.display = wslStatus.is_installed ? 'flex' : 'none';
    }
    if (render && activeCategory === 'wsl') {
      renderWslDrawer();
    }
  } catch (err) {
    console.error('Failed to load WSL status:', err);
  }
}

let wslOnlineDistrosLoaded = false;
let wslOnlineDistrosLoading = false;

async function loadWslOnlineDistros(force = false) {
  const isWindows = navigator.userAgent.includes('Windows') || (typeof navigator.userAgentData !== 'undefined' && navigator.userAgentData?.platform === 'Windows');
  if (!isWindows || !wslStatus || !wslStatus.is_installed) {
    return;
  }
  if (wslOnlineDistrosLoaded && !force) {
    return;
  }
  if (wslOnlineDistrosLoading) return;
  wslOnlineDistrosLoading = true;
  try {
    const list = await invoke('wsl_get_available_distros');
    if (Array.isArray(list) && list.length > 0) {
      wslOnlineDistros = list;
      wslOnlineDistrosLoaded = true;
    }
    if (activeCategory === 'wsl' && wslFilterText) {
      renderWslDrawer();
    }
    const modal = document.getElementById('modal-install-wsl');
    if (modal && !modal.classList.contains('hidden') && wslActiveModalTab === 'catalog') {
      renderWslCatalogList(wslCatalogFilterText);
    }
  } catch (err) {
    console.warn('Failed to load online distros:', err);
  } finally {
    wslOnlineDistrosLoading = false;
  }
}

function createWslBoxItem(distro) {
  const isRunning = distro.state === 'Running';
  const item = document.createElement('div');
  item.className = isRunning ? 'host-item wsl-box-card active' : 'host-item wsl-box-card';
  item.setAttribute('data-distro', distro.name);
  item.title = `${distro.name} - Click to select, double-click to open terminal`;

  const dotClass = isRunning ? 'online-dot active' : 'online-dot';
  const dotTitle = isRunning ? 'Running' : 'Stopped';

  const versionPillHtml = `<span class="host-cloud-pill" style="background: rgba(255,255,255,0.06); color: var(--text-dim); border: 1px solid var(--border); font-size: 8.5px; padding: 0 4px; margin: 0; flex-shrink: 0;">WSL ${distro.version}</span>`;
  const sizePillHtml = distro.image_size_formatted
    ? `<span class="host-cloud-pill" style="background: rgba(255,255,255,0.06); color: var(--text-dim); border: 1px solid var(--border); font-family: var(--font-mono, monospace); margin: 0; padding: 0 4px; font-size: 9px; flex-shrink: 0;" title="Virtual disk size"><i class="fa" style="font-size: 8px;">&#xf0a0;</i> ${escapeHtml(distro.image_size_formatted)}</span>`
    : '';

  item.innerHTML = `
    <!-- Line 1: Name & Status -->
    <div class="wsl-card-row-top">
      <span class="${dotClass}" title="${dotTitle}"></span>
      <div class="host-icon-box" style="width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">
        <i class="fa" style="${isRunning ? 'color: var(--green);' : 'color: var(--text-dim);'} font-size: 13px;">&#xf17c;</i>
      </div>
      <span class="host-name" style="margin: 0; flex: 1 1 auto; font-weight: 600; font-size: 12px; color: var(--text-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(distro.name)}">
        ${escapeHtml(distro.name)}
      </span>
      ${versionPillHtml}
      <span class="host-ip" style="color: ${isRunning ? 'var(--green)' : 'var(--text-subtle)'}; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; margin-left: auto; flex-shrink: 0;">
        ${escapeHtml(distro.state)}
      </span>
    </div>

    <!-- Line 2: Size & Path -->
    <div class="wsl-card-row-mid">
      ${sizePillHtml}
      <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9.5px; opacity: 0.8; flex: 1 1 auto; font-family: var(--font-mono, monospace);" title="${escapeHtml(distro.base_path || distro.plan9_path || '')}">
        <i class="fa" style="font-size: 8.5px; margin-right: 3px; opacity: 0.7;">&#xf07b;</i>${escapeHtml(distro.base_path || distro.plan9_path || 'WSL VFS')}
      </span>
    </div>

    <!-- Line 3: Control Buttons -->
    <div class="wsl-card-row-bottom">
      <span class="host-edit-btn wsl-toggle-btn" title="${isRunning ? 'Stop / Terminate Box' : 'Start Linux Box'}">
        <i class="fa">${isRunning ? '&#xf04d;' : '&#xf04b;'}</i>
      </span>
      <span class="host-edit-btn wsl-term-btn" title="Open interactive terminal">
        <i class="fa">&#xf120;</i>
      </span>
      <span class="host-edit-btn wsl-files-btn" title="Browse files in Explorer (Plan9 9P VFS)">
        <i class="fa">&#xf07b;</i>
      </span>
      <span class="host-edit-btn wsl-bookmark-btn" title="Bookmark in Homelab hosts">
        <i class="fa">&#xf02e;</i>
      </span>
      <span class="host-del-btn wsl-del-btn" title="Unregister / Delete box" style="margin-left: auto;">✕</span>
    </div>
  `;

  // Select on single click
  item.addEventListener('click', (e) => {
    if (e.target.closest('.host-edit-btn, .host-del-btn, button')) return;
    document.querySelectorAll('#drawer-wsl-list .host-item').forEach((i) => i.classList.remove('selected'));
    item.classList.add('selected');
  });

  // Connect on double click
  item.addEventListener('dblclick', (e) => {
    if (e.target.closest('.host-edit-btn, .host-del-btn, button')) return;
    openWslTerminal(distro.name);
  });

  // Actions
  const toggleBtn = item.querySelector('.wsl-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWslDistro(distro.name, !isRunning);
    });
  }

  const termBtn = item.querySelector('.wsl-term-btn');
  if (termBtn) {
    termBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openWslTerminal(distro.name);
    });
  }

  const filesBtn = item.querySelector('.wsl-files-btn');
  if (filesBtn) {
    filesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      browseWslFiles(distro.name);
    });
  }

  const bookmarkBtn = item.querySelector('.wsl-bookmark-btn');
  if (bookmarkBtn) {
    bookmarkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addWslToBookmarks(distro.name);
    });
  }

  const delBtn = item.querySelector('.wsl-del-btn');
  if (delBtn) {
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      unregisterWslDistro(distro.name);
    });
  }

  return item;
}

function renderWslDrawer() {
  const container = document.getElementById('drawer-wsl-list');
  if (!container) return;

  const countBadge = document.getElementById('wsl-distro-count');
  if (countBadge) {
    countBadge.textContent = `${wslStatus.distros.length} Box${wslStatus.distros.length === 1 ? '' : 'es'}`;
  }

  const wslInput = document.getElementById('wsl-search-input');
  const query = (wslInput ? wslInput.value : (wslFilterText || window.wslFilterText || '')).toLowerCase().trim();
  wslFilterText = query;
  window.wslFilterText = query;

  container.innerHTML = '';

  if (!wslStatus.is_installed) {
    container.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-dim);">
        <i class="fa" style="font-size: 32px; margin-bottom: 12px; color: var(--text-subtle); display: block;">&#xf17c;</i>
        <div style="font-weight: 600; margin-bottom: 6px; color: var(--text-main);">WSL Subsystem Not Installed</div>
        <div style="font-size: 11px; line-height: 1.5; margin-bottom: 16px;">
          Windows Subsystem for Linux is not installed on this host. Run <code class="mono" style="background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 3px;">wsl --install</code> in an Administrator terminal to enable Hyper-V & Linux support.
        </div>
      </div>
    `;
    return;
  }

  const filteredLocal = wslStatus.distros.filter((d) => {
    if (!query) return true;
    return d.name.toLowerCase().includes(query) || (d.base_path && d.base_path.toLowerCase().includes(query));
  });

  const installedNames = new Set(wslStatus.distros.map((d) => d.name.toLowerCase()));
  const matchingOnline = query
    ? (wslOnlineDistros || []).filter((o) => {
        if (installedNames.has(o.name.toLowerCase())) return false;
        const name = (o.name || '').toLowerCase();
        const friendly = (o.friendly_name || '').toLowerCase();
        return name.includes(query) || friendly.includes(query);
      })
    : [];

  // When search query is empty
  if (!query) {
    if (wslStatus.distros.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px 16px; text-align: center; color: var(--text-dim);">
          <i class="fa" style="font-size: 32px; margin-bottom: 12px; color: var(--text-subtle); display: block;">&#xf17c;</i>
          <div style="font-weight: 600; margin-bottom: 6px; color: var(--text-main);">No Linux Boxes Registered</div>
          <div style="font-size: 11px; line-height: 1.5; color: var(--text-subtle);">
            Search above to find and install distributions from the online catalog.
          </div>
        </div>
      `;
      return;
    }

    filteredLocal.forEach((distro) => {
      container.appendChild(createWslBoxItem(distro));
    });
    return;
  }

  // When query is non-empty: show matching local boxes AND matching online distros!
  if (filteredLocal.length === 0 && matchingOnline.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-dim); font-size: 12px;">
        No local boxes or online WSL distributions matching "<span class="mono">${escapeHtml(query)}</span>"
        <div style="margin-top: 14px; font-size: 11px; line-height: 1.6; color: var(--text-subtle);">
          Only distributions directly available in <span class="mono" style="color: var(--text-bright);">wsl --list --online</span> can be installed directly.<br>
          To use custom distributions (such as Alpine), click <a href="#" onclick="openInstallWslModal('import'); return false;" style="color: var(--accent); text-decoration: underline; font-weight: 500;">Import Box</a> with a tar/vhdx rootfs image.
        </div>
      </div>
    `;
    return;
  }

  if (filteredLocal.length > 0) {
    const header = document.createElement('div');
    header.style.cssText = 'font-size: 10px; font-weight: 600; color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.5px; padding: 2px 2px 4px 2px;';
    header.innerHTML = `<i class="fa" style="margin-right: 4px;">&#xf17c;</i> Installed Boxes (${filteredLocal.length})`;
    container.appendChild(header);

    filteredLocal.forEach((distro) => {
      container.appendChild(createWslBoxItem(distro));
    });
  }

  if (matchingOnline.length > 0) {
    const onlineHeader = document.createElement('div');
    onlineHeader.style.cssText = 'font-size: 10px; font-weight: 600; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 2px 4px 2px;';
    onlineHeader.innerHTML = `<i class="fa" style="margin-right: 4px;">&#xf019;</i> Available Online (${matchingOnline.length})`;
    container.appendChild(onlineHeader);

    matchingOnline.forEach((o) => {
      const sizeStr = getOnlineDistroSize(o.name);
      const onlineItem = document.createElement('div');
      onlineItem.className = 'host-item wsl-box-card';
      onlineItem.style.cursor = 'default';
      onlineItem.title = `${o.friendly_name || o.name} (${sizeStr})`;
      onlineItem.innerHTML = `
        <!-- Line 1: Name & Status -->
        <div class="wsl-card-row-top">
          <span class="offline-dot" style="opacity: 0.5;" title="Available online in Microsoft Store catalog"></span>
          <div class="host-icon-box" style="width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <i class="fa" style="color: var(--accent); font-size: 13px;">&#xf17c;</i>
          </div>
          <span class="host-name" style="margin: 0; flex: 1 1 auto; font-weight: 600; font-size: 12px; color: var(--text-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(o.friendly_name || o.name)}">
            ${escapeHtml(o.friendly_name || o.name)}
          </span>
          <span class="host-cloud-pill" style="background: rgba(80,161,255,0.14); color: var(--accent); border: 1px solid rgba(80,161,255,0.25); font-size: 8.5px; padding: 0 4px; margin: 0; flex-shrink: 0;">STORE</span>
        </div>

        <!-- Line 2: Size & Identifier -->
        <div class="wsl-card-row-mid">
          <span class="host-cloud-pill" style="background: rgba(255,255,255,0.06); color: var(--text-dim); border: 1px solid var(--border); font-family: var(--font-mono, monospace); margin: 0; padding: 0 4px; font-size: 9px; flex-shrink: 0;" title="Package download size">
            <i class="fa" style="font-size: 8px;">&#xf0a0;</i> ${escapeHtml(sizeStr)}
          </span>
          <span style="opacity: 0.75; font-family: var(--font-mono, monospace); font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(o.name)}">
            ${escapeHtml(o.name)}
          </span>
        </div>

        <!-- Line 3: Control Buttons -->
        <div class="wsl-card-row-bottom">
          <button type="button" class="btn-primary" onclick="quickInstallWslDistro('${escapeHtml(o.name)}')" style="font-size: 10.5px; padding: 2px 10px; height: 22px; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 5px;" title="Install box ${escapeHtml(o.name)}">
            <i class="fa">&#xf019;</i> Install Box
          </button>
        </div>
      `;
      container.appendChild(onlineItem);
    });
  }
}

function openWslTerminal(distroName) {
  const d = (wslStatus.distros || []).find((x) => x.name === distroName);
  if (d && d.state !== 'Running') {
    d.state = 'Running';
    if (activeCategory === 'wsl') renderWslDrawer();
    setTimeout(() => loadWslStatus(true), 600);
    setTimeout(() => loadWslStatus(true), 1500);
  }

  const viewId = `wsl-${distroName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
  const sessionId = `session-${viewId}`;

  // 1. Check if tab already exists
  let tab = document.querySelector(`.tab-card[data-view="${viewId}"]`);
  if (!tab) {
    tab = document.createElement('div');
    tab.className = 'tab-card';
    tab.setAttribute('data-view', viewId);
    tab.draggable = true;
    tab.innerHTML = `
      <i class="fa" style="color: #61afef;">&#xf17c;</i>
      <span class="tab-title">WSL: ${escapeHtml(distroName)}</span>
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

  // 4. Initialize terminal session with wsl:<distroName>
  initTerminalSession(sessionId, `terminal-container-${viewId}`, `wsl:${distroName}`);
  showToast(`Attached terminal to ${distroName}`, 'info');
}

function browseWslFiles(distroName) {
  const uncPath = `\\\\wsl.localhost\\${distroName}`;
  const filesRailBtn = document.getElementById('rail-btn-files');
  if (filesRailBtn) {
    filesRailBtn.click();
  }
  if (typeof loadLocalFiles === 'function') {
    loadLocalFiles(uncPath);
    showToast(`Opened ${distroName} files in Explorer`, 'info');
  }
}

async function addWslToBookmarks(distroName) {
  const distro = wslStatus.distros.find((d) => d.name === distroName);
  if (!distro) return;
  try {
    const updatedCfg = await invoke('wsl_add_to_hosts', { distro });
    if (updatedCfg && updatedCfg.hosts) {
      appConfig.hosts = updatedCfg.hosts;
      if (typeof renderHostsList === 'function') {
        renderHostsList(appConfig.hosts);
      }
    }
    showToast(`Bookmarked ${distro.name} in Hosts drawer`, 'success');
  } catch (err) {
    console.error('Failed to bookmark WSL distro:', err);
    showToast(`Failed to bookmark: ${err}`, 'error');
  }
}

async function toggleWslDistro(distroName, start) {
  try {
    const d = (wslStatus.distros || []).find((x) => x.name === distroName);
    if (d) {
      d.state = start ? 'Running' : 'Stopped';
      if (activeCategory === 'wsl') renderWslDrawer();
    }
    if (start) {
      showToast(`Starting ${distroName}...`, 'info');
      await invoke('wsl_start_distro', { distro: distroName });
      showToast(`Started ${distroName}`, 'success');
    } else {
      showToast(`Terminating ${distroName}...`, 'info');
      await invoke('wsl_stop_distro', { distro: distroName });
      showToast(`Terminated ${distroName}`, 'info');

      // If File Explorer was showing files from this distro, immediately revert to local files
      const isViewingThisWsl = (typeof sftpMode !== 'undefined' && sftpMode === 'wsl') &&
        (sftpCurrentDistro === distroName || (sftpCurrentPath && sftpCurrentPath.toLowerCase().includes(distroName.toLowerCase())));
      if (isViewingThisWsl) {
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
  } catch (err) {
    console.error(`Failed to toggle ${distroName}:`, err);
    showToast(`Error: ${err}`, 'error');
  } finally {
    setTimeout(() => loadWslStatus(true), 400);
    setTimeout(() => loadWslStatus(true), 1200);
  }
}

async function shutdownAllWslVms() {
  if (!confirm('Shutdown all active WSL2 micro-virtual machines? All unsaved Linux state will be terminated.')) {
    return;
  }
  try {
    showToast('Shutting down all WSL VMs...', 'info');
    await invoke('wsl_shutdown_all');
    showToast('All WSL VMs shutdown cleanly', 'success');

    if (typeof sftpMode !== 'undefined' && sftpMode === 'wsl') {
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

    await loadWslStatus(true);
  } catch (err) {
    console.error('Failed to shutdown WSL:', err);
    showToast(`Error: ${err}`, 'error');
  }
}

async function unregisterWslDistro(distroName) {
  if (!confirm(`Permanently delete and unregister "${distroName}"? This action cannot be undone and deletes its VHDX disk image.`)) {
    return;
  }
  try {
    showToast(`Unregistering ${distroName}...`, 'info');
    await invoke('wsl_unregister_distro', { distro: distroName });
    showToast(`Unregistered ${distroName}`, 'info');

    const isViewingThisWsl = (typeof sftpMode !== 'undefined' && sftpMode === 'wsl') &&
      (sftpCurrentDistro === distroName || (sftpCurrentPath && sftpCurrentPath.toLowerCase().includes(distroName.toLowerCase())));
    if (isViewingThisWsl) {
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

    await loadWslStatus(true);
  } catch (err) {
    console.error(`Failed to unregister ${distroName}:`, err);
    showToast(`Error: ${err}`, 'error');
  }
}

function openInstallWslModal(tab = 'catalog') {
  const modal = document.getElementById('modal-install-wsl');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  switchWslModalTab(tab);

  if (wslOnlineDistros.length === 0) {
    loadWslOnlineDistros();
  } else if (tab === 'catalog') {
    renderWslCatalogList(wslCatalogFilterText);
  }
}

function closeInstallWslModal() {
  const modal = document.getElementById('modal-install-wsl');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function switchWslModalTab(tab) {
  wslActiveModalTab = tab;
  const tabBtnCatalog = document.getElementById('tab-btn-wsl-catalog');
  const tabBtnImport = document.getElementById('tab-btn-wsl-import');
  const panelCatalog = document.getElementById('panel-wsl-catalog');
  const formImport = document.getElementById('form-import-wsl');

  if (tab === 'catalog') {
    if (tabBtnCatalog) {
      tabBtnCatalog.classList.add('active');
      tabBtnCatalog.style.borderBottom = '2px solid var(--accent)';
      tabBtnCatalog.style.color = 'var(--text-main)';
    }
    if (tabBtnImport) {
      tabBtnImport.classList.remove('active');
      tabBtnImport.style.borderBottom = '2px solid transparent';
      tabBtnImport.style.color = 'var(--text-subtle)';
    }
    if (panelCatalog) panelCatalog.style.display = 'flex';
    if (formImport) formImport.style.display = 'none';

    renderWslCatalogList(wslCatalogFilterText);
    const searchInput = document.getElementById('wsl-catalog-search-input');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 50);
    }
  } else {
    if (tabBtnImport) {
      tabBtnImport.classList.add('active');
      tabBtnImport.style.borderBottom = '2px solid var(--accent)';
      tabBtnImport.style.color = 'var(--text-main)';
    }
    if (tabBtnCatalog) {
      tabBtnCatalog.classList.remove('active');
      tabBtnCatalog.style.borderBottom = '2px solid transparent';
      tabBtnCatalog.style.color = 'var(--text-subtle)';
    }
    if (panelCatalog) panelCatalog.style.display = 'none';
    if (formImport) formImport.style.display = 'flex';

    const nameInput = document.getElementById('input-wsl-import-name');
    if (nameInput) {
      setTimeout(() => nameInput.focus(), 50);
    }
  }
}

function renderWslCatalogList(filterText = '') {
  const container = document.getElementById('wsl-catalog-list');
  if (!container) return;

  const query = (filterText || '').toLowerCase().trim();
  const installedNames = new Set(wslStatus.distros.map((d) => d.name.toLowerCase()));

  const filtered = (wslOnlineDistros || []).filter((o) => {
    if (!query) return true;
    return o.name.toLowerCase().includes(query) || (o.friendly_name && o.friendly_name.toLowerCase().includes(query));
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--text-dim); font-size: 12px;">
        No online distributions matching "<span class="mono">${escapeHtml(query)}</span>"
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((distro) => {
      const isInstalled = installedNames.has(distro.name.toLowerCase());
      const sizeStr = getOnlineDistroSize(distro.name);
      return `
        <div class="card" style="padding: 10px 12px; border-radius: 4px; background: var(--bg-card); border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <i class="fa" style="color: var(--accent); font-size: 16px; flex-shrink: 0;">&#xf17c;</i>
            <div style="min-width: 0;">
              <div style="font-size: 12.5px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(distro.friendly_name || distro.name)}
              </div>
              <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
                <span class="host-cloud-pill" style="background: rgba(255,255,255,0.06); color: var(--text-dim); border: 1px solid var(--border); font-family: var(--font-mono, monospace); font-size: 9.5px; padding: 1px 5px; margin: 0;" title="Virtual package size">
                  <i class="fa" style="font-size: 8px;">&#xf0a0;</i> ${escapeHtml(sizeStr)}
                </span>
                <span style="font-size: 10px; color: var(--text-dim); font-family: monospace;">
                  ${escapeHtml(distro.name)}
                </span>
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <span class="badge" style="font-size: 9px; padding: 2px 5px; background: rgba(255,255,255,0.06); color: var(--text-dim); border-radius: 3px;">WSL 2</span>
            ${
              isInstalled
                ? `<span class="status-pill active" style="font-size: 10px;"><i class="fa">&#xf00c;</i> Installed</span>`
                : `<button type="button" class="btn-primary" onclick="quickInstallWslDistro('${escapeHtml(distro.name)}')" style="font-size: 11px; padding: 4px 10px; height: 26px;">
                    <i class="fa">&#xf067;</i> Install Box
                  </button>`
            }
          </div>
        </div>
      `;
    })
    .join('');
}

async function quickInstallWslDistro(distroName) {
  closeInstallWslModal();
  showToast(`Provisioning ${distroName} in background...`, 'info');

  try {
    await invoke('wsl_install_distro', { distroName });
    showToast(`Triggered installation for ${distroName}. Check Windows notification or progress.`, 'success');
    setTimeout(() => loadWslStatus(true), 4000);
    setTimeout(() => loadWslStatus(true), 10000);
  } catch (err) {
    console.error(`Failed to install ${distroName}:`, err);
    showToast(`Install failed: ${err}`, 'error');
  }
}

async function handleImportWslBoxSubmit(e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById('input-wsl-import-name');
  const fileInput = document.getElementById('input-wsl-import-file');
  const dirInput = document.getElementById('input-wsl-import-dir');

  const distroName = nameInput ? nameInput.value.trim() : '';
  const filePath = fileInput ? fileInput.value.trim() : '';
  const installLocation = dirInput ? dirInput.value.trim() : '';

  if (!distroName) {
    showToast('Please enter a name for the virtual box', 'error');
    return;
  }
  if (!filePath) {
    showToast('Please specify the path to a .tar, .tar.gz, or .vhdx file', 'error');
    return;
  }

  closeInstallWslModal();
  showToast(`Importing virtual box "${distroName}"...`, 'info');

  try {
    await invoke('wsl_import_distro', { distroName, installLocation, filePath });
    showToast(`Successfully imported "${distroName}" box`, 'success');
    await loadWslStatus(true);
  } catch (err) {
    console.error(`Failed to import box ${distroName}:`, err);
    showToast(`Import failed: ${err}`, 'error');
  }
}

function setupWslView() {
  const searchInput = document.getElementById('wsl-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      wslFilterText = e.target.value;
      renderWslDrawer();
    });
  }

  const headerSearchInput = document.getElementById('drawer-search-input');
  if (headerSearchInput) {
    headerSearchInput.addEventListener('input', (e) => {
      if (typeof activeCategory !== 'undefined' && activeCategory === 'wsl') {
        wslFilterText = e.target.value;
        const wslInput = document.getElementById('wsl-search-input');
        if (wslInput && wslInput.value !== wslFilterText) wslInput.value = wslFilterText;
        renderWslDrawer();
      }
    });
  }

  const catalogSearchInput = document.getElementById('wsl-catalog-search-input');
  if (catalogSearchInput) {
    catalogSearchInput.addEventListener('input', (e) => {
      wslCatalogFilterText = e.target.value;
      renderWslCatalogList(wslCatalogFilterText);
    });
  }

  const tabBtnCatalog = document.getElementById('tab-btn-wsl-catalog');
  if (tabBtnCatalog) {
    tabBtnCatalog.addEventListener('click', () => switchWslModalTab('catalog'));
  }

  const tabBtnImport = document.getElementById('tab-btn-wsl-import');
  if (tabBtnImport) {
    tabBtnImport.addEventListener('click', () => switchWslModalTab('import'));
  }

  const btnShutdown = document.getElementById('btn-wsl-shutdown-all');
  if (btnShutdown) {
    btnShutdown.addEventListener('click', () => {
      shutdownAllWslVms();
    });
  }

  const btnInstall = document.getElementById('btn-wsl-open-install');
  if (btnInstall) {
    btnInstall.addEventListener('click', () => {
      openInstallWslModal('catalog');
    });
  }

  const btnImport = document.getElementById('btn-wsl-open-import');
  if (btnImport) {
    btnImport.addEventListener('click', () => {
      openInstallWslModal('import');
    });
  }

  const btnHeaderImport = document.getElementById('btn-wsl-header-import');
  if (btnHeaderImport) {
    btnHeaderImport.addEventListener('click', () => {
      openInstallWslModal('import');
    });
  }

  const btnRefresh = document.getElementById('btn-wsl-refresh');
  let isRefreshingWsl = false;
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      if (isRefreshingWsl) return;
      isRefreshingWsl = true;
      const icon = btnRefresh.querySelector('i');
      if (icon) icon.classList.add('fa-spin');
      btnRefresh.style.pointerEvents = 'none';
      btnRefresh.style.opacity = '0.6';

      try {
        await loadWslStatus(true);
        if (!wslOnlineDistrosLoaded) {
          loadWslOnlineDistros(false).catch(() => {});
        }
        showToast('Refreshed WSL distribution status', 'info');
      } catch (err) {
        console.warn('WSL refresh failed:', err);
      } finally {
        setTimeout(() => {
          if (icon) icon.classList.remove('fa-spin');
          btnRefresh.style.pointerEvents = '';
          btnRefresh.style.opacity = '';
          isRefreshingWsl = false;
        }, 300);
      }
    });
  }

  const formImport = document.getElementById('form-import-wsl');
  if (formImport) {
    formImport.addEventListener('submit', handleImportWslBoxSubmit);
  }

  const btnBrowse = document.getElementById('btn-browse-wsl-import');
  const filePicker = document.getElementById('file-picker-wsl-import');
  if (btnBrowse && filePicker) {
    btnBrowse.addEventListener('click', () => filePicker.click());
    filePicker.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const pathInput = document.getElementById('input-wsl-import-file');
        const nameInput = document.getElementById('input-wsl-import-name');
        const pickedPath = file.path || file.name;
        if (pathInput) pathInput.value = pickedPath;
        if (nameInput && !nameInput.value.trim()) {
          const baseName = file.name.replace(/\.(tar\.gz|tar\.xz|tar|vhdx|vhd|tgz)$/i, '');
          nameInput.value = baseName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        }
      }
    });
  }
}
