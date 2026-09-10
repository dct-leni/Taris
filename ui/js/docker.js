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

  const existingList = document.getElementById('docker-cards-list');
  const existingBadge = container.querySelector('.docker-target-badge span');

  if (existingList && existingBadge && existingBadge.textContent === target.name) {
    const countEl = document.getElementById('docker-container-count');
    if (countEl) countEl.textContent = 'Refreshing...';
  } else {
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
  }

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
const lastContainerStatsFetched = {};

function fetchContainerStatsIfVisible(containerId, cardElement) {
  if (!visibleDockerIds.has(containerId)) return;
  const now = Date.now();
  if (lastContainerStatsFetched[containerId] && (now - lastContainerStatsFetched[containerId] < 15000)) {
    return;
  }
  lastContainerStatsFetched[containerId] = now;

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
    if (host) {
      tab.setAttribute('data-host-id', host.id);
      tab.setAttribute('data-is-remote', 'true');
    }
    tab.draggable = true;
    tab.innerHTML = `
      <i class="fa" style="color: var(--accent);">&#xf1b2;</i>
      <span class="tab-title">Logs: ${container.name}</span>
      <span class="tab-close">✕</span>
    `;
    document.getElementById('add-tab-btn').before(tab);
    setupTabInteractivity();
  } else {
    if (host) {
      tab.setAttribute('data-host-id', host.id);
      tab.setAttribute('data-is-remote', 'true');
    } else {
      tab.removeAttribute('data-host-id');
      tab.removeAttribute('data-is-remote');
    }
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

  const cmd = `docker logs -f --tail 200 ${container.id}`;
  if (host) {
    initTerminalSession(sessionId, `terminal-container-${viewId}`, 'docker', { host: host, command: cmd });
  } else {
    initTerminalSession(sessionId, `terminal-container-${viewId}`, cmd);
  }
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
    if (host) {
      tab.setAttribute('data-host-id', host.id);
      tab.setAttribute('data-is-remote', 'true');
    }
    tab.draggable = true;
    tab.innerHTML = `
      <i class="fa" style="color: var(--green);">&#xf120;</i>
      <span class="tab-title">Exec: ${container.name}</span>
      <span class="tab-close">✕</span>
    `;
    document.getElementById('add-tab-btn').before(tab);
    setupTabInteractivity();
  } else {
    if (host) {
      tab.setAttribute('data-host-id', host.id);
      tab.setAttribute('data-is-remote', 'true');
    } else {
      tab.removeAttribute('data-host-id');
      tab.removeAttribute('data-is-remote');
    }
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

  const cmd = `docker exec -it ${container.id} sh`;
  if (host) {
    initTerminalSession(sessionId, `terminal-container-${viewId}`, 'docker', { host: host, command: cmd });
  } else {
    initTerminalSession(sessionId, `terminal-container-${viewId}`, cmd);
  }
  switchView(viewId);
}
