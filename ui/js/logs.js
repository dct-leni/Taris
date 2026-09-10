// ── Unified App Logs & Diagnostics Drawer ──
let isRenderingLogs = false;
let lastRenderedLogsFingerprint = '';

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

    const lastEntry = filtered[filtered.length - 1];
    const fingerprint = `${filtered.length}:${lastEntry?.time || ''}:${lastEntry?.message || ''}:${levelFilter}:${searchQuery}`;
    if (fingerprint === lastRenderedLogsFingerprint && list.children.length > 0) {
      return;
    }
    lastRenderedLogsFingerprint = fingerprint;

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
    refreshBtn.addEventListener('click', () => {
      lastRenderedLogsFingerprint = '';
      renderLogsDrawer();
    });
  }

  const clearBtn = document.getElementById('logs-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      try {
        await invoke('clear_app_logs');
        lastRenderedLogsFingerprint = '';
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
