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
