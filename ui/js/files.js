// ── 5. Real Local & Remote SFTP Explorer ──
let sftpMode = 'local'; // 'local' | 'remote' | 'wsl'
let sftpCurrentHost = null;
let sftpCurrentDistro = null;
let sftpTrueLocalPath = '.';
let sftpLocalPath = '.';
let sftpCurrentPath = '.';
let selectedSftpItem = null; // { file, isRemote, host }
const sftpRemotePaths = {}; // hostId -> path
const sftpWslPaths = {}; // distroName -> uncPath
let sftpFollowTerminalEnabled = true;

function syncFileExplorerWithActiveTerminal() {
  if (!sftpFollowTerminalEnabled) return;
  const target = getActiveTargetInfo();
  if (target.isRemote && target.host) {
    const path = sftpRemotePaths[target.host.id] || '~';
    if (activeCategory === 'files') {
      loadRemoteFiles(target.host, path);
    }
  } else if (target.isWsl && target.distro) {
    const uncPath = (sftpCurrentPath && sftpCurrentPath.startsWith(`\\\\wsl.localhost\\${target.distro}`))
      ? sftpCurrentPath
      : `\\\\wsl.localhost\\${target.distro}`;
    if (activeCategory === 'files') {
      loadLocalFiles(uncPath);
    }
  } else {
    const path = (sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
      ? sftpTrueLocalPath
      : '.';
    if (activeCategory === 'files') {
      loadLocalFiles(path);
    }
  }
}

async function loadLocalFiles(dirPath = null) {
  const container = document.getElementById('sftp-file-list');
  const title = document.getElementById('drawer-title') || document.getElementById('sftp-header-title');
  const pathText = document.getElementById('sftp-current-path');
  if (!container) return;

  const isWsl = !!(dirPath && (dirPath.startsWith('\\\\wsl.localhost') || dirPath.startsWith('\\\\wsl$') || dirPath.startsWith('/')));

  if (isWsl) {
    sftpMode = 'wsl';
    sftpCurrentHost = null;
    const activeTarget = typeof getActiveTargetInfo === 'function' ? getActiveTargetInfo() : null;
    sftpCurrentDistro = activeTarget?.distro || sftpCurrentDistro || null;
    sftpCurrentPath = dirPath;
    if (activeCategory === 'files' && title) {
      title.textContent = sftpCurrentDistro ? `FILES: WSL (${sftpCurrentDistro})` : 'FILES: WSL';
    }
  } else {
    sftpMode = 'local';
    sftpCurrentHost = null;
    sftpCurrentDistro = null;
    if (dirPath && !dirPath.startsWith('\\\\wsl') && !dirPath.startsWith('/')) {
      sftpTrueLocalPath = dirPath;
      sftpLocalPath = dirPath;
    }
    sftpLocalPath = (sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
      ? sftpTrueLocalPath
      : (dirPath || '.');
    sftpCurrentPath = sftpLocalPath;
    if (activeCategory === 'files' && title) title.textContent = 'FILES: Local Workspace';
  }

  if (pathText) {
    pathText.value = sftpCurrentPath;
    pathText.textContent = sftpCurrentPath;
  }

  container.innerHTML = '<div style="padding: 12px; color: var(--text-subtle);">Loading local files...</div>';

  try {
    const pathToQuery = isWsl ? dirPath : (dirPath || sftpLocalPath || '.');
    const files = await invoke('list_local_files', { dirPath: pathToQuery });
    if (files && files.length > 0 && files[0].path) {
      const samplePath = files[0].path;
      const lastSep = Math.max(samplePath.lastIndexOf('/'), samplePath.lastIndexOf('\\'));
      if (lastSep > 0) {
        const detectedDir = samplePath.substring(0, lastSep);
        if (detectedDir && (sftpLocalPath === '.' || sftpLocalPath === '~' || isWsl)) {
          if (!isWsl) {
            sftpTrueLocalPath = detectedDir;
            sftpLocalPath = detectedDir;
          }
          sftpCurrentPath = detectedDir;
          if (isWsl && sftpCurrentDistro && typeof sftpWslPaths !== 'undefined') {
            sftpWslPaths[sftpCurrentDistro] = detectedDir;
          }
          if (pathText) {
            pathText.value = sftpCurrentPath;
            pathText.textContent = sftpCurrentPath;
          }
        }
      }
    }
    renderSftpFileList(files, false, null);
  } catch (err) {
    console.error('Failed to read local directory:', err);
    container.innerHTML = `
      <div style="padding: 16px; text-align: center; color: var(--text-subtle);">
        <div style="color: var(--red); font-weight: 500; margin-bottom: 6px;"><i class="fa">&#xf071;</i> Error reading directory</div>
        <div style="font-size: 11px; opacity: 0.85; margin-bottom: 12px; word-break: break-all;">${escapeHtml(err)}</div>
        <button class="drawer-action-btn" style="margin: 0 auto; padding: 4px 12px; cursor: pointer; border: 1px solid var(--border); border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--text-main);" onclick="sftpMode='local'; sftpCurrentDistro=null; loadLocalFiles('.')">
          <i class="fa">&#xf015;</i> Return to Local Workspace Root
        </button>
      </div>
    `;
  }
}

async function loadRemoteFiles(host, dirPath = null) {
  const container = document.getElementById('sftp-file-list');
  const title = document.getElementById('drawer-title') || document.getElementById('sftp-header-title');
  const pathText = document.getElementById('sftp-current-path');
  if (!container || !host) return;

  sftpMode = 'remote';
  sftpCurrentHost = host;
  sftpCurrentPath = dirPath || sftpRemotePaths[host.id] || '~';
  sftpRemotePaths[host.id] = sftpCurrentPath;

  if (activeCategory === 'files' && title) title.textContent = `FILES: ${host.name}`;
  if (pathText) {
    pathText.value = sftpCurrentPath;
    pathText.textContent = sftpCurrentPath;
  }

  container.innerHTML = `<div style="padding: 12px; color: var(--text-subtle);">Loading files from ${escapeHtml(host.name)}...</div>`;

  try {
    const res = await invoke('list_remote_files', { host, remotePath: sftpCurrentPath });
    const files = Array.isArray(res) ? res : (res?.files || []);
    if (res && res.current_path) {
      sftpCurrentPath = res.current_path;
      sftpRemotePaths[host.id] = sftpCurrentPath;
      if (pathText) {
        pathText.value = sftpCurrentPath;
        pathText.textContent = sftpCurrentPath;
      }
    }
    renderSftpFileList(files, true, host);
  } catch (err) {
    container.innerHTML = `
      <div style="padding: 16px; text-align: center; color: var(--text-subtle);">
        <div style="color: var(--red); font-weight: 500; margin-bottom: 6px;"><i class="fa">&#xf071;</i> SFTP Error (${escapeHtml(host.name)})</div>
        <div style="font-size: 11px; opacity: 0.85; margin-bottom: 12px; word-break: break-all;">${escapeHtml(err)}</div>
        <button class="drawer-action-btn" style="margin: 0 auto; padding: 4px 12px; cursor: pointer; border: 1px solid var(--border); border-radius: 4px; background: rgba(255,255,255,0.06); color: var(--text-main);" onclick="loadRemoteFiles(sftpCurrentHost, sftpCurrentPath)">
          <i class="fa">&#xf021;</i> Retry SFTP
        </button>
      </div>
    `;
  }
}

function renderSftpFileList(files, isRemote, host) {
  const container = document.getElementById('sftp-file-list');
  if (!container) return;
  container.innerHTML = '';
  selectedSftpItem = null;

  if (!files || files.length === 0) {
    container.innerHTML = '<div style="padding: 12px; color: var(--text-subtle);">Directory is empty</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.fileData = f;
    const isArch = !f.is_dir && (f.name.endsWith('.zip') || f.name.endsWith('.tar.gz') || f.name.endsWith('.tgz') || f.name.endsWith('.tar') || f.name.endsWith('.7z'));
    const icon = f.is_dir ? '&#xf07b;' : f.is_db ? '&#xf1c0;' : isArch ? '&#xf1c6;' : '&#xf15b;';
    const ext = f.name.lastIndexOf('.') > 0 ? f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase() : '';
    const fileType = f.is_dir ? 'DIR' : isArch ? 'ARCHIVE' : (ext ? ext : 'FILE');
    const filePerms = f.permissions || (f.is_dir ? 'drwxr-xr-x' : '-rw-r--r--');

    row.innerHTML = `
      <i class="fa" style="color: var(--text-muted);">${icon}</i>
      <span class="file-name" style="color: var(--text-primary);" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="file-date">${f.modified}</span>
      <span class="file-size">${f.size}</span>
      <span class="file-type">${fileType}</span>
      <span class="file-perms">${filePerms}</span>
    `;

    fragment.appendChild(row);
  });

  container.appendChild(fragment);

  // Single delegated click & double-click listener on file container
  container.onclick = (e) => {
    const row = e.target.closest('.file-row');
    if (row && row.fileData) {
      e.stopPropagation();
      document.querySelectorAll('#sftp-file-list .file-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      selectedSftpItem = {
        file: row.fileData,
        isRemote: isRemote,
        host: host,
      };
    } else {
      document.querySelectorAll('#sftp-file-list .file-row').forEach(r => r.classList.remove('selected'));
      selectedSftpItem = null;
    }
  };

  container.ondblclick = (e) => {
    const row = e.target.closest('.file-row');
    if (!row || !row.fileData) return;
    const f = row.fileData;
    if (f.is_dir) {
      if (isRemote && host) {
        loadRemoteFiles(host, f.path);
      } else {
        loadLocalFiles(f.path);
      }
    } else if (f.is_db) {
      openDbTab(f.name, f.path, isRemote, host);
    } else if (!f.is_dir && (f.name.endsWith('.zip') || f.name.endsWith('.tar.gz') || f.name.endsWith('.tgz') || f.name.endsWith('.tar') || f.name.endsWith('.7z'))) {
      openArchiveModal(f.name, f.path, isRemote, host);
    } else {
      openEditorTab(f.name, f.path, isRemote, host);
    }
  };
}

async function openArchiveModal(name, path, isRemote, host) {
  const modal = document.getElementById('modal-archive-inspector');
  const titleEl = document.getElementById('archive-modal-title');
  const countEl = document.getElementById('archive-entry-count');
  const filterInput = document.getElementById('archive-filter-input');
  const bodyEl = document.getElementById('archive-entries-body');
  const closeBtn = document.getElementById('modal-archive-close-btn');
  const doneBtn = document.getElementById('modal-archive-done-btn');

  if (!modal || !bodyEl) return;
  if (titleEl) titleEl.textContent = name;
  if (countEl) countEl.textContent = 'Reading archive central directory...';
  if (filterInput) filterInput.value = '';
  bodyEl.innerHTML = '<tr><td colspan="4" style="padding: 24px; text-align: center; color: var(--accent);"><i class="fa fa-spin">&#xf021;</i> Reading central directory headers...</td></tr>';
  modal.classList.remove('hidden');

  const closeModal = () => modal.classList.add('hidden');
  if (closeBtn) closeBtn.onclick = closeModal;
  if (doneBtn) doneBtn.onclick = closeModal;

  try {
    const entries = await invoke('inspect_archive', {
      host: isRemote ? host : null,
      archivePath: path,
    });

    const currentEntries = entries || [];
    function renderEntries(list) {
      if (!list || list.length === 0) {
        bodyEl.innerHTML = '<tr><td colspan="4" style="padding: 16px; text-align: center; color: var(--text-subtle);">Archive has no matching files</td></tr>';
        if (countEl) countEl.textContent = '0 entries';
        return;
      }

      let rowsHtml = '';
      list.forEach((e) => {
        const icon = e.is_dir ? '&#xf07b;' : '&#xf15b;';
        const sizeStr = e.is_dir ? '-' : formatBytes(e.size);
        const compStr = e.is_dir ? '-' : formatBytes(e.compressed_size);
        rowsHtml += `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
            <td style="padding: 5px 10px; display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <i class="fa" style="color: var(--text-muted); font-size: 11px;">${icon}</i>
              <span title="${escapeHtml(e.path)}">${escapeHtml(e.path)}</span>
            </td>
            <td style="padding: 5px 10px; color: var(--text-muted);">${sizeStr}</td>
            <td style="padding: 5px 10px; color: var(--text-subtle);">${compStr}</td>
            <td style="padding: 5px 10px; color: var(--text-muted);">${escapeHtml(e.modified)}</td>
          </tr>
        `;
      });
      bodyEl.innerHTML = rowsHtml;
      if (countEl) countEl.textContent = `${list.length} entry/entries`;
    }

    renderEntries(currentEntries);

    if (filterInput) {
      filterInput.oninput = (ev) => {
        const q = ev.target.value.toLowerCase().trim();
        if (!q) {
          renderEntries(currentEntries);
        } else {
          renderEntries(currentEntries.filter((e) => e.path.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)));
        }
      };
    }
  } catch (err) {
    console.error('Failed to inspect archive:', err);
    bodyEl.innerHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--red);">Error inspecting archive: ${escapeHtml(err.message || err)}</td></tr>`;
    if (countEl) countEl.textContent = 'Inspection failed';
  }
}

function sftpGoUp() {
  if (sftpMode === 'remote' && sftpCurrentHost) {
    if (sftpCurrentPath === '/' || sftpCurrentPath === '') return;
    const parentPath = sftpCurrentPath.replace(/\/[^\/]+\/?$/, '') || '/';
    loadRemoteFiles(sftpCurrentHost, parentPath);
  } else {
    if (sftpCurrentPath === '.' || sftpCurrentPath === '') {
      loadLocalFiles('..');
    } else {
      let parentPath = sftpCurrentPath.replace(/[\\\/][^\\\/]+[\\\/]?$/, '');
      if (!parentPath) {
        parentPath = '.';
      } else if (/^[a-zA-Z]:$/.test(parentPath)) {
        parentPath = `${parentPath}\\`;
      }
      loadLocalFiles(parentPath);
    }
  }
}

function renderDockerContainerFilesNotice() {
  sftpMode = 'docker';
  sftpCurrentHost = null;
  sftpCurrentDistro = null;
  sftpCurrentPath = '';
  selectedSftpItem = null;
  const titleEl = document.getElementById('drawer-title') || document.getElementById('sftp-header-title');
  if (titleEl && activeCategory === 'files') {
    titleEl.textContent = 'FILES: Container (Isolated)';
  }
  const pathText = document.getElementById('sftp-current-path');
  if (pathText) {
    pathText.value = 'Container filesystem is isolated';
    pathText.textContent = 'Container filesystem is isolated';
  }
  const container = document.getElementById('sftp-file-list');
  if (container) {
    container.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-dim);">
        <i class="fa" style="font-size: 32px; margin-bottom: 12px; color: var(--text-subtle); display: block;">&#xf1b2;</i>
        <div style="font-weight: 600; margin-bottom: 8px; color: var(--text-main); font-size: 13px;">Docker Container Session</div>
        <div style="font-size: 11.5px; line-height: 1.5; color: var(--text-muted); max-width: 260px; margin: 0 auto 12px;">
          Files cannot be browsed for Docker exec or logs sessions because the container filesystem is isolated from host SFTP.
        </div>
        <div style="font-size: 11px; color: var(--text-subtle);">
          Switch to a host or local terminal tab to explore files.
        </div>
      </div>
    `;
  }
}

function syncFileExplorerWithView(view) {
  const target = getActiveTargetInfo(view);
  const drawerEl = document.getElementById('left-drawer');
  const titleEl = document.getElementById('drawer-title') || document.getElementById('sftp-header-title');
  const isDrawerOpen = activeCategory === 'files' && drawerEl && !drawerEl.classList.contains('collapsed');

  if (target.isRemote && target.host) {
    const prevHostId = sftpCurrentHost?.id;
    const wasNotThisRemote = (sftpMode !== 'remote' || prevHostId !== target.host.id);
    sftpMode = 'remote';
    sftpCurrentHost = target.host;
    sftpCurrentDistro = null;
    if (titleEl && activeCategory === 'files') titleEl.textContent = `FILES: ${target.host.name}`;
    if (isDrawerOpen && (wasNotThisRemote || !document.querySelector('#sftp-file-list .file-row'))) {
      loadRemoteFiles(target.host, sftpRemotePaths[target.host.id] || '~');
    }
  } else if (target.isWsl && target.distro) {
    const wasNotThisWsl = (sftpMode !== 'wsl' || sftpCurrentDistro !== target.distro);
    sftpMode = 'wsl';
    sftpCurrentHost = null;
    sftpCurrentDistro = target.distro;
    const uncPath = (sftpCurrentPath && sftpCurrentPath.startsWith(`\\\\wsl.localhost\\${target.distro}`))
      ? sftpCurrentPath
      : `\\\\wsl.localhost\\${target.distro}`;
    if (isDrawerOpen && (wasNotThisWsl || !document.querySelector('#sftp-file-list .file-row'))) {
      loadLocalFiles(uncPath);
    }
  } else {
    // Target is Local Machine!
    const wasNotLocal = (sftpMode !== 'local');
    const isWslPath = sftpCurrentPath && (sftpCurrentPath.startsWith('\\\\wsl.localhost') || sftpCurrentPath.startsWith('\\\\wsl$') || sftpCurrentPath.startsWith('/'));
    sftpMode = 'local';
    sftpCurrentHost = null;
    sftpCurrentDistro = null;
    if (titleEl && activeCategory === 'files') titleEl.textContent = 'FILES: Local Workspace';

    const localPathToLoad = (sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
      ? sftpTrueLocalPath
      : (sftpLocalPath && !sftpLocalPath.startsWith('\\\\wsl') && !sftpLocalPath.startsWith('/') ? sftpLocalPath : '.');

    if (isDrawerOpen && (wasNotLocal || isWslPath || !document.querySelector('#sftp-file-list .file-row'))) {
      loadLocalFiles(localPathToLoad);
    } else if (wasNotLocal || isWslPath) {
      sftpCurrentPath = localPathToLoad;
      sftpLocalPath = localPathToLoad;
      const pathText = document.getElementById('sftp-current-path');
      if (pathText) {
        pathText.value = sftpCurrentPath;
        pathText.textContent = sftpCurrentPath;
      }
      const fileContainer = document.getElementById('sftp-file-list');
      if (fileContainer) fileContainer.innerHTML = '';
    }
  }
}



// ── 14. SFTP Explorer Controls ──
function setupSftpExplorer() {
  const upBtn = document.getElementById('sftp-up-btn');
  const refreshBtn = document.getElementById('sftp-refresh-btn');
  const searchInput = document.getElementById('sftp-search-input');

  if (upBtn) {
    upBtn.addEventListener('click', () => {
      sftpGoUp();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      const target = getActiveTargetInfo();
      if (target.isRemote && target.host) {
        loadRemoteFiles(target.host, sftpCurrentPath);
      } else if (target.isWsl && target.distro) {
        const uncPath = (sftpCurrentPath && sftpCurrentPath.startsWith(`\\\\wsl.localhost\\${target.distro}`))
          ? sftpCurrentPath
          : `\\\\wsl.localhost\\${target.distro}`;
        loadLocalFiles(uncPath);
      } else {
        const localPath = (sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
          ? sftpTrueLocalPath
          : (sftpLocalPath && !sftpLocalPath.startsWith('\\\\wsl') && !sftpLocalPath.startsWith('/') ? sftpLocalPath : '.');
        loadLocalFiles(localPath);
      }
    });
  }

  const followBtn = document.getElementById('sftp-follow-term-btn');
  if (followBtn) {
    followBtn.addEventListener('click', () => {
      sftpFollowTerminalEnabled = !sftpFollowTerminalEnabled;
      followBtn.classList.toggle('active', sftpFollowTerminalEnabled);
      followBtn.style.color = sftpFollowTerminalEnabled ? 'var(--accent)' : 'var(--text-subtle)';
      followBtn.title = sftpFollowTerminalEnabled
        ? 'Follow Active Terminal Directory (Auto-tracking ON)'
        : 'Follow Active Terminal Directory (Auto-tracking OFF)';
      showToast(
        sftpFollowTerminalEnabled ? 'File Explorer following terminal directory' : 'File Explorer detached from terminal',
        'info'
      );
      if (sftpFollowTerminalEnabled) {
        syncFileExplorerWithActiveTerminal();
      }
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      const rows = document.querySelectorAll('#sftp-file-list .file-row');
      rows.forEach((row) => {
        const nameSpan = row.querySelector('.file-name');
        const text = (nameSpan ? nameSpan.textContent : row.textContent).toLowerCase();
        row.style.display = text.includes(query) ? 'flex' : 'none';
      });
    });
  }

  // Editable path input
  const pathInput = document.getElementById('sftp-current-path');
  if (pathInput) {
    pathInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const targetPath = pathInput.value.trim();
        if (!targetPath) return;

        if (sftpMode === 'remote') {
          if (!sftpCurrentHost) {
            showCopyToast('No active remote host selected');
            return;
          }
          // Validate remote directory existence before navigating
          try {
            const res = await invoke('list_remote_files', { host: sftpCurrentHost, remotePath: targetPath });
            const files = Array.isArray(res) ? res : (res?.files || []);
            if (res && res.current_path) {
              sftpCurrentPath = res.current_path;
              sftpRemotePaths[sftpCurrentHost.id] = sftpCurrentPath;
              pathInput.value = sftpCurrentPath;
            } else {
              sftpCurrentPath = targetPath;
              sftpRemotePaths[sftpCurrentHost.id] = targetPath;
            }
            renderSftpFileList(files, true, sftpCurrentHost);
            pathInput.blur();
          } catch (err) {
            showCopyToast(`Path does not exist: ${err}`);
            pathInput.value = sftpCurrentPath;
          }
        } else {
          // Local or WSL mode
          try {
            await loadLocalFiles(targetPath);
            pathInput.blur();
          } catch (err) {
            showCopyToast(`Path does not exist: ${err}`);
            pathInput.value = sftpCurrentPath;
          }
        }
      } else if (e.key === 'Escape') {
        pathInput.value = sftpCurrentPath;
        pathInput.blur();
      }
    });
  }
}

// ── File Explorer Column Customization & Resizers ──
let fileColConfig = {
  date: true,
  size: true,
  type: false,
  perms: false,
};

function applyFileColumnVisibility() {
  const drawerFiles = document.getElementById('drawer-files');
  if (!drawerFiles) return;

  const cols = ['date', 'size', 'type', 'perms'];
  let allSecondaryHidden = true;
  cols.forEach((col) => {
    const isVisible = fileColConfig[col] === true;
    if (isVisible) allSecondaryHidden = false;
    drawerFiles.classList.toggle(`hide-col-${col}`, !isVisible);
    const checkEl = document.getElementById(`check-col-${col}`);
    if (checkEl) {
      checkEl.textContent = isVisible ? '✓' : '';
    }
  });

  const resizerName = document.getElementById('resizer-col-name');
  if (resizerName) {
    resizerName.style.display = allSecondaryHidden ? 'none' : '';
  }
}

function setupSftpColumnContextMenu() {
  const menu = document.getElementById('sftp-col-context-menu');
  if (!menu) return;

  const handleToggle = (item) => {
    const colAction = item.getAttribute('data-col-action');
    const colTarget = item.getAttribute('data-col-target');

    if (colAction === 'only-name') {
      fileColConfig = {
        date: false,
        size: false,
        type: false,
        perms: false,
      };
    } else if (colTarget && colTarget !== 'name') {
      fileColConfig[colTarget] = !fileColConfig[colTarget];
    }

    if (!appConfig.file_explorer) appConfig.file_explorer = {};
    appConfig.file_explorer.col_date = fileColConfig.date;
    appConfig.file_explorer.col_size = fileColConfig.size;
    appConfig.file_explorer.col_type = fileColConfig.type;
    appConfig.file_explorer.col_perms = fileColConfig.perms;
    persistConfig(true);

    applyFileColumnVisibility();
    menu.classList.add('hidden');
  };

  menu.querySelectorAll('.context-menu-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleToggle(item);
    });
  });
}

function setupSftpColumnResizers() {
  const container = document.getElementById('drawer-files') || document.getElementById('left-drawer');
  if (!container) return;

  // Restore saved column widths from config.toml
  const initialDateW = appConfig?.file_explorer?.width_date || appConfig?.settings?.sftp_col_date_width || 105;
  const initialSizeW = appConfig?.file_explorer?.width_size || appConfig?.settings?.sftp_col_size_width || 55;
  const initialTypeW = appConfig?.file_explorer?.width_type || 50;
  const initialPermsW = appConfig?.file_explorer?.width_perms || 75;

  container.style.setProperty('--col-date-w', `${initialDateW}px`);
  container.style.setProperty('--col-size-w', `${initialSizeW}px`);
  container.style.setProperty('--col-type-w', `${initialTypeW}px`);
  container.style.setProperty('--col-perms-w', `${initialPermsW}px`);

  function saveColWidths() {
    if (!appConfig.file_explorer) appConfig.file_explorer = {};
    appConfig.file_explorer.width_date = parseInt(container.style.getPropertyValue('--col-date-w')) || 105;
    appConfig.file_explorer.width_size = parseInt(container.style.getPropertyValue('--col-size-w')) || 55;
    appConfig.file_explorer.width_type = parseInt(container.style.getPropertyValue('--col-type-w')) || 50;
    appConfig.file_explorer.width_perms = parseInt(container.style.getPropertyValue('--col-perms-w')) || 75;
    persistConfig(false);
  }

  function getVisibleFileColumns() {
    const allCols = ['date', 'size', 'type', 'perms'];
    return allCols.filter((col) => fileColConfig[col] === true);
  }

  function bindResizer(resizer, onStart, onDrag, onEnd) {
    if (!resizer) return;
    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const startX = e.clientX;
      if (onStart) onStart();

      function onMouseMove(moveEvent) {
        const deltaX = moveEvent.clientX - startX;
        onDrag(deltaX);
      }

      function onMouseUp() {
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        if (onEnd) onEnd();
      }

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // 1. Resizer between 'Name' and the first visible secondary column (left side of that column)
  const resizerName = document.getElementById('resizer-col-name');
  if (resizerName) {
    let targetCol = null;
    let startW = 60;
    bindResizer(
      resizerName,
      () => {
        const visible = getVisibleFileColumns();
        targetCol = visible.length > 0 ? visible[0] : null;
        if (targetCol) {
          startW = parseInt(getComputedStyle(container).getPropertyValue(`--col-${targetCol}-w`)) || 60;
        }
      },
      (deltaX) => {
        if (!targetCol) return;
        // Dragging left (deltaX < 0) expands the column from its left edge
        // Dragging right (deltaX > 0) shrinks the column from its left edge
        const newW = Math.max(25, Math.min(350, startW - deltaX));
        container.style.setProperty(`--col-${targetCol}-w`, `${newW}px`);
      },
      () => {
        saveColWidths();
      }
    );
  }

  // 2. Resizers for secondary columns (both sides supported)
  const secondaryCols = ['date', 'size', 'type', 'perms'];
  secondaryCols.forEach((col) => {
    const resizer = document.getElementById(`resizer-col-${col}`);
    if (!resizer) return;

    let nextCol = null;
    let startLeftW = 60;
    let startRightW = 60;
    let isLastVisible = false;

    bindResizer(
      resizer,
      () => {
        const visible = getVisibleFileColumns();
        const colIdx = visible.indexOf(col);
        if (colIdx === -1) {
          nextCol = null;
          isLastVisible = false;
          return;
        }

        startLeftW = parseInt(getComputedStyle(container).getPropertyValue(`--col-${col}-w`)) || 60;

        if (colIdx + 1 < visible.length) {
          nextCol = visible[colIdx + 1];
          startRightW = parseInt(getComputedStyle(container).getPropertyValue(`--col-${nextCol}-w`)) || 60;
          isLastVisible = false;
        } else {
          nextCol = null;
          isLastVisible = true;
        }
      },
      (deltaX) => {
        if (isLastVisible) {
          // col is the rightmost visible column - dragging right expands it from right side
          const newW = Math.max(25, Math.min(350, startLeftW + deltaX));
          container.style.setProperty(`--col-${col}-w`, `${newW}px`);
        } else if (nextCol) {
          // Divider sits between 'col' (left) and 'nextCol' (right)
          // Dragging right expands col (its right side) and shrinks nextCol (its left side)
          // Dragging left shrinks col (its right side) and expands nextCol (its left side)
          let finalLeftW = startLeftW + deltaX;
          let finalRightW = startRightW - deltaX;

          if (finalLeftW < 25) {
            finalRightW += (finalLeftW - 25);
            finalLeftW = 25;
          }
          if (finalRightW < 25) {
            finalLeftW += (finalRightW - 25);
            finalRightW = 25;
          }

          finalLeftW = Math.max(25, Math.min(350, finalLeftW));
          finalRightW = Math.max(25, Math.min(350, finalRightW));

          container.style.setProperty(`--col-${col}-w`, `${finalLeftW}px`);
          container.style.setProperty(`--col-${nextCol}-w`, `${finalRightW}px`);
        }
      },
      () => {
        saveColWidths();
      }
    );
  });
}

function setupAutoHideScrollbars() {
  // Capture all scroll events across document to show scrollbar thumb and auto-hide 900ms after scroll ends
  document.addEventListener('scroll', (e) => {
    const el = e.target;
    if (!el || !el.classList) return;
    el.classList.add('has-active-scroll');
    if (el._scrollHideTimer) clearTimeout(el._scrollHideTimer);
    el._scrollHideTimer = setTimeout(() => {
      el.classList.remove('has-active-scroll');
      el._scrollHideTimer = null;
    }, 900);
  }, { passive: true, capture: true });
}

let discoveredShells = [];

function getShellDisplayName(shellId) {
  if (!shellId) return 'PowerShell';
  if (shellId === 'cmd') return 'CMD';
  if (shellId === 'git-bash' || shellId === 'bash') return 'Git Bash';
  if (shellId === 'pwsh') return 'PowerShell 7';
  if (shellId === 'wsl') return 'WSL';
  const found = discoveredShells.find((s) => s.id === shellId);
  return found ? found.name : shellId;
}

async function loadAvailableShells() {
  const select = document.getElementById('setting-default-shell');
  try {
    const shells = await invoke('get_available_shells');
    if (Array.isArray(shells) && shells.length > 0) {
      discoveredShells = shells;
      if (select) {
        select.innerHTML = '';
        shells.forEach((sh) => {
          const opt = document.createElement('option');
          opt.value = sh.id;
          opt.textContent = sh.name;
          select.appendChild(opt);
        });
        const currentVal = appConfig?.settings?.default_shell || 'powershell';
        if (!shells.some((s) => s.id === currentVal)) {
          const opt = document.createElement('option');
          opt.value = currentVal;
          opt.textContent = currentVal;
          select.appendChild(opt);
        }
        select.value = currentVal;
      }
      if (typeof updateLocalTabTitle === 'function') {
        updateLocalTabTitle(appConfig?.settings?.default_shell);
      }
    }
  } catch (err) {
    console.error('Failed to discover available shells:', err);
  }
}

let discoveredEditors = [];

async function loadExternalEditors() {
  const select = document.getElementById('setting-external-editor');
  try {
    const editors = await invoke('discover_external_editors');
    if (Array.isArray(editors) && editors.length > 0) {
      discoveredEditors = editors;
      if (select) {
        select.innerHTML = '<option value="auto">Auto-detect (Zed / Code / Notepad++)</option>';
        editors.forEach((ed) => {
          const opt = document.createElement('option');
          opt.value = ed.path;
          const displayCmd = (ed.path && (ed.path === ed.id || (!ed.path.includes('\\') && !ed.path.includes('/'))))
            ? ` (${ed.path})`
            : '';
          opt.textContent = `${ed.name}${displayCmd}`;
          select.appendChild(opt);
        });
        if (appConfig.settings.external_editor) {
          select.value = appConfig.settings.external_editor;
        }
      }
      updateExternalEditorLabel();
    }
  } catch (err) {
    console.error('Failed to discover external editors:', err);
  }
}

function updateExternalEditorLabel() {
  const label = document.getElementById('sftp-ctx-external-label');
  if (!label) return;
  const currentVal = appConfig.settings.external_editor || 'auto';
  if (currentVal === 'auto') {
    const defaultEd = discoveredEditors[0];
    label.textContent = defaultEd ? `Edit in ${defaultEd.name}` : 'Edit in External Editor';
  } else {
    const matched = discoveredEditors.find((e) => e.path === currentVal || e.id === currentVal);
    label.textContent = matched ? `Edit in ${matched.name}` : `Edit in ${currentVal}`;
  }
}

function showToast(message, type = 'info') {
  const existing = document.querySelectorAll('.taris-toast');
  existing.forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = 'taris-toast';
  let iconHtml = '<i class="fa" style="color: var(--accent);">&#xf05a;</i>';
  if (type === 'success') {
    iconHtml = '<i class="fa" style="color: var(--green);">&#xf00c;</i>';
    toast.style.borderLeftColor = 'var(--green)';
  } else if (type === 'error') {
    iconHtml = '<i class="fa" style="color: var(--red);">&#xf06a;</i>';
    toast.style.borderLeftColor = 'var(--red)';
  } else if (type === 'sync') {
    iconHtml = '<i class="fa fa-spin" style="color: var(--cyan);">&#xf021;</i>';
    toast.style.borderLeftColor = 'var(--cyan)';
  }

  toast.innerHTML = `${iconHtml}<span>${message}</span>`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

async function openFileInExternalEditor(file, isRemote, host) {
  try {
    const editorPref = appConfig.settings.external_editor;
    const editorPath = (editorPref && editorPref !== 'auto') ? editorPref : null;

    showToast(`Opening '${file.name}' in external editor...`, 'sync');

    const res = await invoke('open_in_external_editor', {
      host: isRemote ? host : null,
      remotePath: isRemote ? file.path : null,
      localPath: isRemote ? null : file.path,
      editorPath: editorPath,
    });

    showToast(res || `Opened ${file.name} in external editor`, 'success');
  } catch (err) {
    console.error('External editor error:', err);
    showToast(`Failed to open external editor: ${err}`, 'error');
  }
}

async function openInNativeExplorer(file, isRemote, host) {
  try {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.includes('Mac');
    const explorerName = isMac ? 'Finder' : 'File Explorer';

    if (isRemote && file.is_dir) {
      showToast('Remote SSH directories cannot be opened in native File Explorer.', 'info');
      return;
    }

    showToast(`Opening in ${explorerName}...`, 'sync');

    const normalizedLocalPath = (!isRemote && file?.path && typeof normalizeWslPath === 'function')
      ? normalizeWslPath(file.path, sftpCurrentDistro)
      : (file ? file.path : null);

    const res = await invoke('open_in_native_explorer', {
      host: isRemote ? host : null,
      remotePath: isRemote ? file.path : null,
      localPath: isRemote ? null : normalizedLocalPath,
    });

    showToast(res || `Opened in ${explorerName}`, 'success');
  } catch (err) {
    console.error('Failed to open in native explorer:', err);
    showToast(`Failed to open in native explorer: ${err}`, 'error');
  }
}

// ── 16. Multi-Threaded Transfers & Clipboard Paste ──
async function downloadRemoteFile(file, host) {
  try {
    const transferId = 'dl-' + Date.now();
    showToast(`Downloading '${file.name}'...`, 'sync');
    await invoke('sftp_download_file', {
      transferId,
      host,
      remotePath: file.path,
      localDestDir: '.',
    });
    showToast(`Downloaded '${file.name}' to local workspace.`, 'success');
    if (sftpMode === 'local') {
      loadLocalFiles(sftpCurrentPath);
    }
  } catch (err) {
    console.error('Download error:', err);
    showToast(`Download failed: ${err}`, 'error');
  }
}

async function pasteClipboardFiles(targetDir) {
  try {
    const files = await invoke('get_clipboard_files');
    if (!files || files.length === 0) {
      showToast('Clipboard has no files copied from Windows Explorer.', 'info');
      return;
    }

    const cleanDestDir = targetDir || sftpCurrentPath || '.';
    showToast(`Pasting ${files.length} file(s)...`, 'sync');

    if (sftpMode === 'remote' && sftpCurrentHost) {
      for (const filePath of files) {
        const transferId = 'up-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const fileName = filePath.split(/[\\/]/).pop();
        showToast(`Uploading ${fileName}...`, 'sync');
        await invoke('sftp_upload_file', {
          transferId,
          host: sftpCurrentHost,
          localPath: filePath,
          remoteDestDir: cleanDestDir,
        });
      }
      showToast(`Uploaded ${files.length} file(s) via SFTP.`, 'success');
      loadRemoteFiles(sftpCurrentHost, cleanDestDir);
    } else {
      const copied = await invoke('copy_local_files', {
        sourcePaths: files,
        destDir: cleanDestDir,
      });
      showToast(`Copied ${copied.length} file(s) locally.`, 'success');
      loadLocalFiles(cleanDestDir);
    }
  } catch (err) {
    console.error('Paste error:', err);
    showToast(`Paste failed: ${err}`, 'error');
  }
}

async function deleteSftpItem(item) {
  if (!item || !item.file) return;

  const isDir = !!item.file.is_dir;
  const typeName = isDir ? 'folder' : 'file';
  const targetName = item.file.name;
  const targetPath = item.file.path;
  const locationDesc = item.isRemote ? `from remote host (${item.host?.name || 'remote'})` : 'from local disk';

  const confirmed = window.confirm(`Are you sure you want to delete the ${typeName} "${targetName}" ${locationDesc}?\n\nThis action cannot be undone.`);
  if (!confirmed) return;

  try {
    showToast(`Deleting ${typeName} '${targetName}'...`, 'sync');
    if (item.isRemote) {
      if (!item.host) {
        showToast('No active remote host selected', 'error');
        return;
      }
      await invoke('delete_remote_file', {
        host: item.host,
        remotePath: targetPath,
      });
      showToast(`Deleted remote ${typeName} '${targetName}'`, 'success');
      loadRemoteFiles(item.host, sftpCurrentPath);
    } else {
      await invoke('delete_local_file', {
        path: targetPath,
      });
      showToast(`Deleted local ${typeName} '${targetName}'`, 'success');
      loadLocalFiles(sftpCurrentPath);
    }
    selectedSftpItem = null;
  } catch (err) {
    console.error('Delete error:', err);
    showToast(`Failed to delete ${typeName}: ${err}`, 'error');
  }
}

function triggerCurrentMenuRefresh() {
  // 1. Check active tab view first (e.g. database query)
  const activeTab = document.querySelector('.tab-card.active');
  const view = activeTab?.getAttribute('data-view') || '';

  if (view === 'db' || view.startsWith('db-')) {
    const runBtn = document.getElementById('db-run-query-btn');
    if (runBtn) {
      runBtn.click();
      showToast('Database refreshed', 'info');
      return true;
    }
  }

  // 2. Check active drawer category
  if (activeCategory === 'files') {
    const target = getActiveTargetInfo();
    if (target.isRemote && target.host) {
      loadRemoteFiles(target.host, sftpCurrentPath);
      showToast(`Refreshed files: ${target.host.name}`, 'info');
    } else if (target.isWsl && target.distro) {
      const uncPath = (sftpCurrentPath && sftpCurrentPath.startsWith(`\\\\wsl.localhost\\${target.distro}`))
        ? sftpCurrentPath
        : `\\\\wsl.localhost\\${target.distro}`;
      loadLocalFiles(uncPath);
      showToast(`Refreshed WSL files: ${target.distro}`, 'info');
    } else {
      const localPath = (sftpTrueLocalPath && !sftpTrueLocalPath.startsWith('\\\\wsl') && !sftpTrueLocalPath.startsWith('/'))
        ? sftpTrueLocalPath
        : (sftpLocalPath && !sftpLocalPath.startsWith('\\\\wsl') && !sftpLocalPath.startsWith('/') ? sftpLocalPath : '.');
      loadLocalFiles(localPath);
      showToast('Refreshed local files', 'info');
    }
    return true;
  }

  if (activeCategory === 'docker') {
    const refreshBtn = document.getElementById('docker-refresh-btn');
    if (refreshBtn) {
      refreshBtn.click();
    } else {
      renderDockerDrawer();
    }
    showToast('Refreshed Docker containers', 'info');
    return true;
  }

  if (activeCategory === 'ports') {
    const refreshBtn = document.getElementById('ports-refresh-btn');
    if (refreshBtn) {
      refreshBtn.click();
    } else {
      renderPortsDrawer();
    }
    showToast('Refreshed network ports', 'info');
    return true;
  }

  if (activeCategory === 'tunnels') {
    renderTunnelsDrawer();
    showToast('Refreshed port forwarding tunnels', 'info');
    return true;
  }

  if (activeCategory === 'cloud') {
    clearCloudCache(currentCloudProvider);
    renderCloudDrawer(true);
    showToast('Refreshed cloud projects & instances', 'info');
    return true;
  }

  if (activeCategory === 'hosts') {
    pollHostsAlive();
    showToast('Refreshed hosts status', 'info');
    return true;
  }

  return false;
}

function setupSftpClipboardListener() {
  const sftpSection = document.getElementById('drawer-files');
  if (!sftpSection) return;

  let isHoveringSftp = false;
  let isSftpActive = false;

  sftpSection.addEventListener('mouseenter', () => { isHoveringSftp = true; });
  sftpSection.addEventListener('mouseleave', () => { isHoveringSftp = false; });
  sftpSection.addEventListener('mousemove', () => { isHoveringSftp = true; });

  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#drawer-files, #sftp-context-menu')) {
      isSftpActive = true;
    } else {
      isSftpActive = false;
    }
  });

  window.addEventListener('keydown', (e) => {
    // Intercept Ctrl+R and F5 to disable app reload / restart
    if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') || e.key === 'F5') {
      e.preventDefault();
      e.stopPropagation();
      triggerCurrentMenuRefresh();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.id === 'editor-textarea')) {
        return;
      }
      const inSftp = isHoveringSftp || isSftpActive || active?.closest('#drawer-files');
      if (inSftp) {
        e.preventDefault();
        e.stopPropagation();
        pasteClipboardFiles(sftpCurrentPath);
      }
    }

    if (e.key === 'Delete' || e.key === 'Del') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable || active.id === 'editor-textarea')) {
        return;
      }
      const inSftp = isHoveringSftp || isSftpActive || active?.closest('#drawer-files');
      if (inSftp) {
        const selectedRow = document.querySelector('#sftp-file-list .file-row.selected');
        const itemToDelete = selectedSftpItem || (selectedRow && selectedRow.fileData ? {
          file: selectedRow.fileData,
          isRemote: sftpMode === 'remote',
          host: sftpCurrentHost,
        } : null);

        if (itemToDelete) {
          e.preventDefault();
          e.stopPropagation();
          deleteSftpItem(itemToDelete);
        }
      }
    }
  });
}

function setupSftpContextMenu() {
  // Seamlessly handled by unified setupControlledContextMenu()
}

let transferHideTimeout = null;

function updateTransferWidget(payload) {
  const widget = document.getElementById('status-transfer-widget');
  const textElem = document.getElementById('status-transfer-text');
  const fillElem = document.getElementById('status-transfer-fill');
  const speedElem = document.getElementById('status-transfer-speed');

  if (!widget || !textElem || !fillElem || !speedElem) return;

  if (transferHideTimeout) {
    clearTimeout(transferHideTimeout);
    transferHideTimeout = null;
  }

  widget.classList.remove('hidden');

  const dirVerb = payload.direction === 'download' ? 'Downloading' : 'Uploading';
  textElem.textContent = `${dirVerb} ${payload.fileName} (${payload.progressPercent}%)`;
  fillElem.style.width = `${Math.min(100, Math.max(0, payload.progressPercent))}%`;
  speedElem.textContent = payload.speedStr || '0.0 KB/s';

  if (payload.status === 'completed' || payload.progressPercent >= 100) {
    textElem.textContent = `Completed ${payload.fileName}`;
    transferHideTimeout = setTimeout(() => {
      widget.classList.add('hidden');
    }, 2500);
  }
}

function setupTauriEventListeners() {
  if (listen) {
    listen('transfer-progress', (event) => {
      if (event && event.payload) {
        updateTransferWidget(event.payload);
      }
    }).catch(console.error);

    listen('file-synced-remote', (event) => {
      if (event && event.payload) {
        const p = event.payload;
        showToast(`✓ Auto-synced remote file: ${p.fileName} (${p.hostName})`, 'success');
        if (sftpMode === 'remote' && sftpCurrentHost && sftpCurrentHost.name === p.hostName) {
          loadRemoteFiles(sftpCurrentHost, sftpCurrentPath);
        }
      }
    }).catch(console.error);
  }
}
