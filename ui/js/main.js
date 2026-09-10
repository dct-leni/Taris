// ── 6. Activity Rail & Collapsible Drawer ──
const drawer = document.getElementById('left-drawer');
const drawerTitle = document.getElementById('drawer-title');

function getActiveTargetInfo(view) {
  const activeTab = document.querySelector('.tab-card.active');
  const targetView = view || activeTab?.getAttribute('data-view') || 'local';

  if (targetView.startsWith('host-')) {
    const hostId = targetView.replace('host-', '');
    const host = (appConfig.hosts || []).find((h) => h.id === hostId);
    return { isRemote: true, isWsl: false, host: host || null, name: host ? host.name : 'Remote Host' };
  }

  if (targetView.startsWith('docker-logs-') || targetView.startsWith('docker-exec-')) {
    const tabEl = (view && document.querySelector(`.tab-card[data-view="${view}"]`)) || activeTab;
    const hostId = tabEl?.getAttribute('data-host-id');
    const host = hostId ? (appConfig.hosts || []).find((h) => h.id === hostId) : (typeof terminalSessions !== 'undefined' ? terminalSessions[`session-${targetView}`]?.host : null);
    if (host) {
      return { isRemote: true, isWsl: false, isDocker: true, host, name: host.name };
    } else {
      return { isRemote: false, isWsl: false, isDocker: true, host: null, name: 'Local Machine' };
    }
  }

  if (targetView.startsWith('wsl-')) {
    const distroName = targetView.replace('wsl-', '');
    const d = (typeof wslStatus !== 'undefined' && wslStatus.distros)
      ? wslStatus.distros.find((x) => x.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_') === distroName.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))
      : null;
    const realDistroName = d ? d.name : distroName;
    return { isRemote: false, isWsl: true, distro: realDistroName, host: null, name: `WSL: ${realDistroName}` };
  }

  const tabEl = (view && document.querySelector(`.tab-card[data-view="${view}"]`)) || activeTab;
  if (tabEl) {
    const hostId = tabEl.getAttribute('data-host-id');
    const isRemote = tabEl.getAttribute('data-is-remote') === 'true';
    if (hostId) {
      const host = (appConfig.hosts || []).find((h) => h.id === hostId);
      if (host) {
        return { isRemote, isWsl: false, host, name: host.name };
      }
    }
  }

  return { isRemote: false, isWsl: false, host: null, name: 'Local Machine' };
}

let isRailDragging = false;

function switchDrawerCategory(tab, forceOpen = false) {
  const btn = document.querySelector(`.rail-btn[data-tab="${tab}"]`);
  const drawerSettings = document.getElementById('drawer-settings');
  const drawerItems = document.getElementById('drawer-items');
  const drawerFiles = document.getElementById('drawer-files');
  const drawerDocker = document.getElementById('drawer-docker');
  const drawerPorts = document.getElementById('drawer-ports');
  const drawerTunnels = document.getElementById('drawer-tunnels');
  const drawerSnippets = document.getElementById('drawer-snippets');
  const drawerCloud = document.getElementById('drawer-cloud');
  const drawerWireguard = document.getElementById('drawer-wireguard');
  const drawerWsl = document.getElementById('drawer-wsl');
  const drawerLogs = document.getElementById('drawer-logs');
  const drawerSearch = document.getElementById('drawer-search-box');
  const addHostBtn = document.getElementById('btn-open-add-host');
  const importHostsBtn = document.getElementById('btn-open-import-hosts');
  const addSnippetBtn = document.getElementById('btn-open-add-snippet');
  const wslHeaderImportBtn = document.getElementById('btn-wsl-header-import');
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
    if (drawerWsl) { drawerWsl.classList.add('hidden'); drawerWsl.style.display = 'none'; }
    if (drawerLogs) { drawerLogs.classList.add('hidden'); drawerLogs.style.display = 'none'; }
    if (addHostBtn) addHostBtn.style.display = 'none';
    if (importHostsBtn) importHostsBtn.style.display = 'none';
    if (addSnippetBtn) addSnippetBtn.style.display = 'none';
    if (wslHeaderImportBtn) wslHeaderImportBtn.style.display = 'none';
    if (ipToggleWrapper) ipToggleWrapper.style.display = 'none';
  }

  if (tab === 'settings') {
    if (activeCategory === 'settings' && !drawer.classList.contains('collapsed') && !forceOpen) {
      drawer.classList.add('collapsed');
      if (btn) btn.classList.remove('active');
      return;
    }

    drawer.classList.remove('collapsed');
    document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    activeCategory = 'settings';
    drawerTitle.textContent = 'SETTINGS';
    if (!appConfig.session) appConfig.session = {};
    appConfig.session.active_category = 'settings';

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

  if (tab === activeCategory && !drawer.classList.contains('collapsed') && !forceOpen) {
    drawer.classList.add('collapsed');
    if (btn) btn.classList.remove('active');
    return;
  }

  drawer.classList.remove('collapsed');
  document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  activeCategory = tab;
  drawerTitle.textContent = tab === 'snippets' ? 'NOTES & ALIASES' : (tab === 'files' ? 'FILES' : (tab === 'cloud' ? 'CLOUD PROVIDERS' : (tab === 'wireguard' ? 'MESH VPN' : (tab === 'wsl' ? 'WSL & LINUX VIRTUAL MACHINES' : (tab === 'logs' ? 'APP LOGS' : tab.toUpperCase())))));
  if (!appConfig.session) appConfig.session = {};
  appConfig.session.active_category = tab;

  hideAllDrawers();
  if (addHostBtn) addHostBtn.style.display = tab === 'hosts' ? 'inline' : 'none';
  if (importHostsBtn) importHostsBtn.style.display = tab === 'hosts' ? 'inline' : 'none';
  if (ipToggleWrapper) ipToggleWrapper.style.display = tab === 'hosts' ? 'inline-flex' : 'none';
  if (wslHeaderImportBtn) wslHeaderImportBtn.style.display = tab === 'wsl' ? 'inline' : 'none';

  if (tab === 'files') {
    if (drawerSearch) drawerSearch.style.display = 'none';
    if (drawerFiles) {
      drawerFiles.classList.remove('hidden');
      drawerFiles.style.display = 'flex';
    }
    const target = getActiveTargetInfo();
    if (target.isRemote && target.host) {
      sftpMode = 'remote';
      sftpCurrentHost = target.host;
      sftpCurrentDistro = null;
      drawerTitle.textContent = `FILES: ${target.host.name}`;
      loadRemoteFiles(target.host, sftpRemotePaths[target.host.id] || '~');
    } else if (target.isWsl && target.distro) {
      sftpMode = 'wsl';
      sftpCurrentHost = null;
      sftpCurrentDistro = target.distro;
      drawerTitle.textContent = `FILES: WSL (${target.distro})`;
      const uncPath = (sftpCurrentPath && sftpCurrentPath.startsWith(`\\\\wsl.localhost\\${target.distro}`))
        ? sftpCurrentPath
        : `\\\\wsl.localhost\\${target.distro}`;
      loadLocalFiles(uncPath);
    } else {
      sftpMode = 'local';
      sftpCurrentHost = null;
      sftpCurrentDistro = null;
      drawerTitle.textContent = 'FILES: Local Workspace';
      const localPathToLoad = (typeof sftpTrueLocalPath !== 'undefined' && sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
        ? sftpTrueLocalPath
        : (typeof sftpLocalPath !== 'undefined' && sftpLocalPath && !sftpLocalPath.startsWith('\\\\wsl') && !sftpLocalPath.startsWith('/') ? sftpLocalPath : '.');
      loadLocalFiles(localPathToLoad);
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
  } else if (tab === 'wsl') {
    drawerTitle.textContent = 'WSL BOXES';
    if (wslHeaderImportBtn) wslHeaderImportBtn.style.display = 'inline';
    if (drawerSearch) drawerSearch.style.display = 'none';
    if (drawerWsl) {
      drawerWsl.classList.remove('hidden');
      drawerWsl.style.display = 'flex';
    }
    const wslInput = document.getElementById('wsl-search-input');
    if (wslInput) {
      wslInput.value = (typeof wslFilterText !== 'undefined' ? wslFilterText : '');
    }
    const isWindows = navigator.userAgent.includes('Windows') || (typeof navigator.userAgentData !== 'undefined' && navigator.userAgentData?.platform === 'Windows');
    if (isWindows && typeof wslStatus !== 'undefined' && wslStatus?.is_installed && typeof loadWslOnlineDistros === 'function') {
      loadWslOnlineDistros();
    }
    renderWslDrawer();
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
      drawerTitle.textContent = 'HOSTS';
      const searchInput = document.getElementById('drawer-search-input');
      if (searchInput) {
        searchInput.placeholder = 'Filter hosts...';
        searchInput.value = (typeof hostSearchText !== 'undefined' ? hostSearchText : '');
      }
      renderHostsList(appConfig.hosts || []);
    } else {
      drawerItems.innerHTML = `<div style="padding: 16px 12px; color: var(--text-subtle);">Active listeners & config for ${tab}</div>`;
    }
  }
}
window.switchDrawerCategory = switchDrawerCategory;

document.querySelectorAll('.rail-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (isRailDragging || btn.classList.contains('disabled')) return;
    const tab = btn.getAttribute('data-tab');
    switchDrawerCategory(tab);
  });
});

const RAIL_TAB_METADATA = {
  hosts: { name: 'Hosts (Homelab)', icon: '&#xf233;' },
  cloud: { name: 'Cloud Providers (GCP, AWS, Azure)', icon: '&#xf0c2;' },
  files: { name: 'Files (Local & Remote SFTP)', icon: '&#xf07b;' },
  snippets: { name: 'Notes & Aliases', icon: '&#xf249;' },
  docker: { name: 'Docker Containers', icon: '&#xf395;', iconClass: 'fab fa-docker' },
  ports: { name: 'Port & Socket Inspector', icon: '&#xf796;' },
  tunnels: { name: 'Port Forwarding (Tunnels)', icon: '&#xf0ec;' },
  wireguard: { name: 'Mesh VPN (WireGuard, Tailscale, NetBird)', icon: '&#xf3ed;' },
  wsl: { name: 'WSL & Linux Virtual Machines', icon: '&#xf17c;' },
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
  'wsl',
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
        <i class="${meta.iconClass || 'fa'}">${meta.icon}</i>
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

  const target = getActiveTargetInfo(view);
  if (target.host) {
    if (target.host.enable_port_scan !== false) {
      portsBtn.classList.remove('disabled');
      portsBtn.title = `Port & Socket Inspector (${target.host.name})`;
    } else {
      portsBtn.classList.add('disabled');
      portsBtn.title = `Port scanner is disabled for ${target.host.name} in Host Settings`;
    }
    if (activeCategory === 'ports') {
      renderPortsDrawer();
    }
    return;
  }

  // Local Machine or non-host tabs:
  portsBtn.classList.remove('disabled');
  portsBtn.title = 'Port & Socket Inspector (Local Machine)';
  if (activeCategory === 'ports') {
    renderPortsDrawer();
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
  setupHostImporterModal();
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
  try { setupTauriEventListeners(); } catch (e) { console.error('setupTauriEventListeners error:', e); }
  try { setupMeshDrawer(); } catch (e) { console.error('setupMeshDrawer error:', e); }
  try { setupCloudDrawer(); } catch (e) { console.error('setupCloudDrawer error:', e); }
  try { setupWslView(); } catch (e) { console.error('setupWslView error:', e); }
  try { setupLogsDrawer(); } catch (e) { console.error('setupLogsDrawer error:', e); }

  // Load config, real disk files & external editors
  await loadConfig();
  await loadAvailableShells();
  await checkWslAvailability();
  await loadWslStatus(false);
  await loadLocalFiles();
  await loadExternalEditors();

  // Always open hosts drawer by default on app start
  switchDrawerCategory('hosts', true);

  // Apply saved file column visibility preferences
  applyFileColumnVisibility();

  // Initialize primary local terminal tab & button states
  updateDockerButtonState('local');
  updatePortsButtonState('local');
  if (typeof updateLocalTabTitle === 'function') {
    updateLocalTabTitle(appConfig?.settings?.default_shell);
  }
  initTerminalSession('session-local', 'terminal-container-local', appConfig.settings.default_shell || 'powershell');
  setTimeout(() => {
    resizeAllTerminals();
  }, 100);

  // Start background periodic host alive checks (every 8s, minimal CPU load)
  pollHostsAlive();
  setInterval(pollHostsAlive, 8000);

  // Controlled rate background polling: Docker (15s), Ports (12s), Tunnels (5s), WireGuard (5s)
  let lastDockerPoll = 0;
  let lastPortsPoll = 0;
  let lastTunnelsPoll = 0;
  let lastMeshPoll = 0;
  let lastWslPoll = 0;
  let lastLogsPoll = 0;

  setInterval(() => {
    const now = Date.now();
    if (activeCategory === 'docker') {
      if (now - lastDockerPoll >= 15000) {
        lastDockerPoll = now;
        refreshDockerSilent();
      }
    } else if (activeCategory === 'ports') {
      if (now - lastPortsPoll >= 12000) {
        lastPortsPoll = now;
        refreshPortsSilent();
      }
    } else if (activeCategory === 'tunnels') {
      if (now - lastTunnelsPoll >= 5000) {
        lastTunnelsPoll = now;
        renderTunnelsDrawer();
      }
    } else if (activeCategory === 'wireguard') {
      if (now - lastMeshPoll >= 5000) {
        lastMeshPoll = now;
        refreshActiveMeshSilent();
      }
    } else if (activeCategory === 'wsl') {
      if (now - lastWslPoll >= 10000) {
        lastWslPoll = now;
        if (typeof loadWslStatus === 'function') {
          loadWslStatus(true);
        }
      }
    } else if (activeCategory === 'logs') {
      if (now - lastLogsPoll >= 4000) {
        lastLogsPoll = now;
        renderLogsDrawer();
      }
    }
  }, 2000);

  // Start remote telemetry polling (runs only when active connected remote tab is open)
  updateRemoteTelemetry();
  setInterval(updateRemoteTelemetry, 3000);

  // Auto-resize on window resize
  window.addEventListener('resize', resizeAllTerminals);

  // Ctrl+Shift+L shortcut: toggle App Logs & Diagnostics drawer
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      const btnLogs = document.getElementById('rail-btn-logs');
      if (btnLogs) {
        btnLogs.style.display = 'flex';
        btnLogs.click();
      }
    }
  });

  // Idle memory trimming: when inactive for 5 minutes, release cached memory back to the OS
  let lastUserActivity = Date.now();
  let hasTrimmedThisIdle = false;
  const resetIdleTimer = () => {
    lastUserActivity = Date.now();
    hasTrimmedThisIdle = false;
  };
  window.addEventListener('mousemove', resetIdleTimer, { passive: true });
  window.addEventListener('keydown', resetIdleTimer, { passive: true });
  window.addEventListener('click', resetIdleTimer, { passive: true });

  setInterval(() => {
    if (!hasTrimmedThisIdle && Date.now() - lastUserActivity > 5 * 60 * 1000) {
      hasTrimmedThisIdle = true;
      invoke('trim_memory').catch(() => {});
    }
  }, 30000);
});

