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
        <a href="http://127.0.0.1:${t.local_port}" class="tunnel-port-badge tunnel-open-browser-btn" data-url="http://127.0.0.1:${t.local_port}" title="Click to open http://127.0.0.1:${t.local_port} in browser">
          <span>127.0.0.1:${t.local_port}</span>
          <i class="fa" style="font-size: 10px; margin-left: 4px; opacity: 0.8;">&#xf08e;</i>
        </a>
        <span class="tunnel-arrow">&#x2794;</span>
        <span class="tunnel-target-badge" title="${escapeHtml(t.remote_host)}:${t.remote_port}">
          ${(t.remote_host === '127.0.0.1' || t.remote_host === 'localhost' || !t.remote_host) 
            ? `${escapeHtml(t.host_name)}:${t.remote_port}` 
            : `${escapeHtml(t.remote_host)}:${t.remote_port} (${escapeHtml(t.host_name)})`}
        </span>
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

    card.querySelector('.tunnel-open-browser-btn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = e.currentTarget.getAttribute('data-url');
      if (url) {
        try {
          await invoke('launch_url_in_browser', { url });
          showToast(`Opening ${url} in browser`, 'info');
        } catch (err) {
          window.open(url, '_blank');
        }
      }
    });

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

function updateTunnelModalPreview() {
  const hostSelect = document.getElementById('tunnel-form-host');
  const selectedOption = hostSelect?.options[hostSelect.selectedIndex];
  const hostName = selectedOption ? selectedOption.text.split(' (')[0] : 'host';
  const localPort = document.getElementById('tunnel-form-local-port')?.value || '8080';
  const remotePort = document.getElementById('tunnel-form-remote-port')?.value || '3000';
  const targetHost = document.getElementById('tunnel-form-remote-host')?.value?.trim() || '127.0.0.1';

  const previewLocal = document.getElementById('tunnel-preview-local');
  const previewRemote = document.getElementById('tunnel-preview-remote');
  const previewHost = document.getElementById('tunnel-preview-host');

  if (previewLocal) previewLocal.textContent = `http://127.0.0.1:${localPort}`;
  if (previewRemote) previewRemote.textContent = remotePort;
  if (previewHost) {
    if (targetHost === '127.0.0.1' || targetHost === 'localhost') {
      previewHost.textContent = hostName;
    } else {
      previewHost.textContent = `${targetHost} (via ${hostName})`;
    }
  }
}

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
  document.getElementById('tunnel-form-remote-port').value = '3000';
  document.getElementById('tunnel-form-autostart').checked = false;

  hostSelect.innerHTML = (appConfig.hosts || []).map((h) =>
    `<option value="${h.id}">${escapeHtml(h.name)} (${escapeHtml(h.host)})</option>`
  ).join('');

  updateTunnelModalPreview();
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
  document.getElementById('tunnel-form-remote-port').value = t.remote_port || 3000;
  document.getElementById('tunnel-form-autostart').checked = !!t.auto_start;

  hostSelect.innerHTML = (appConfig.hosts || []).map((h) =>
    `<option value="${h.id}" ${h.id === t.host_id ? 'selected' : ''}>${escapeHtml(h.name)} (${escapeHtml(h.host)})</option>`
  ).join('');

  updateTunnelModalPreview();
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

  ['tunnel-form-host', 'tunnel-form-local-port', 'tunnel-form-remote-port', 'tunnel-form-remote-host'].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', updateTunnelModalPreview);
    el?.addEventListener('change', updateTunnelModalPreview);
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
