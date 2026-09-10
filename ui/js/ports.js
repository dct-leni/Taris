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

  const existingArea = document.getElementById('ports-content-area');
  const existingBadge = container.querySelector('.docker-target-badge span');

  if (existingArea && existingBadge && existingBadge.textContent === target.name) {
    const countEl = document.getElementById('ports-socket-count');
    if (countEl) countEl.textContent = 'Inspecting...';
  } else {
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
  }

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
