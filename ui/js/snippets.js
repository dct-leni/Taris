// ── Notes & Aliases (Snippets) Drawer & Terminal Pasting ──
let snippetsSearchText = '';
let editingSnippetId = null;

function getActiveTerminalSessionId() {
  const activeTab = document.querySelector('.tab-card.active');
  let view = activeTab?.getAttribute('data-view');
  if (!view) {
    const activePane = document.querySelector('.view-pane.active');
    if (activePane && activePane.id) {
      view = activePane.id.replace(/-pane$/, '');
    }
  }
  if (!view || view === 'local') return 'session-local';
  const candidateId = `session-${view}`;
  if (typeof terminalSessions !== 'undefined' && terminalSessions[candidateId]) {
    return candidateId;
  }
  if (view.startsWith('local-') || view.startsWith('host-') || view.startsWith('docker-') || view.startsWith('wsl-')) {
    return candidateId;
  }
  return 'session-local';
}

function pasteToActiveTerminal(text) {
  if (text === null || text === undefined) return;
  const sessionId = getActiveTerminalSessionId();
  const normalized = String(text).replace(/\r\n/g, '\r').replace(/\n/g, '\r');
  invoke('pty_write', { sessionId, data: normalized }).catch(console.error);
  const sess = (typeof terminalSessions !== 'undefined') ? terminalSessions[sessionId] : null;
  if (sess && sess.term) {
    sess.term.focus();
  }
}

function showCopyToast(msg) {
  if (typeof showToast === 'function') {
    showToast(msg, 'info');
  }
}

function renderSnippetsDrawer() {
  const container = document.getElementById('drawer-snippets');
  if (!container) return;

  container.innerHTML = `
    <div class="drawer-search" style="padding: 0; margin-bottom: 4px;">
      <input type="text" id="snippets-search-input" class="search-input" placeholder="Search notes & aliases..." value="${escapeHtml(snippetsSearchText)}">
    </div>
    <div id="snippets-content-list" style="display: flex; flex-direction: column; gap: 4px; flex: 1; overflow-y: auto; padding: 4px 6px 12px 6px; box-sizing: border-box;">
    </div>
  `;

  const searchInput = document.getElementById('snippets-search-input');
  searchInput?.addEventListener('input', (e) => {
    snippetsSearchText = e.target.value.toLowerCase();
    renderSnippetsList();
  });

  renderSnippetsList();
}

function highlightShellCommand(cmd, theme) {
  if (!cmd) return '';
  const regex = /("[^"]*"|'[^']*'|\$\{[^}]+\}|\$[a-zA-Z_0-9]+|--?[a-zA-Z0-9_\-]+|\|\||&&|[|;&><]+|[^\s"'$|;&><]+|\s+)/g;
  const tokens = cmd.match(regex) || [cmd];
  
  let isCommandName = true;
  let html = '';

  for (let token of tokens) {
    if (/^\s+$/.test(token)) {
      html += token;
      continue;
    }
    
    // Quotes / strings
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
      html += `<span style="color: ${theme.green || '#98c379'};">${escapeHtml(token)}</span>`;
      isCommandName = false;
    }
    // Variables ($VAR, ${VAR})
    else if (token.startsWith('$')) {
      html += `<span style="color: ${theme.red || '#e06c75'}; font-weight: 500;">${escapeHtml(token)}</span>`;
      isCommandName = false;
    }
    // Command separators / pipes (|, &&, ||, ;, >, <)
    else if (/^(?:\|\||&&|[|;&><]+)$/.test(token)) {
      html += `<span style="color: ${theme.yellow || '#e5c07b'}; font-weight: 700;">${escapeHtml(token)}</span>`;
      isCommandName = true;
    }
    // CLI Flags (-a, --name, -p, etc.)
    else if (/^--?[a-zA-Z0-9_\-]+$/.test(token)) {
      html += `<span style="color: ${theme.magenta || '#c678dd'};">${escapeHtml(token)}</span>`;
      isCommandName = false;
    }
    // Executable / Command name
    else if (isCommandName) {
      html += `<span style="color: ${theme.cyan || theme.blue || '#61afef'}; font-weight: 600;">${escapeHtml(token)}</span>`;
      isCommandName = false;
    }
    // Arguments / paths / options
    else {
      html += `<span style="color: ${theme.foreground || '#abb2bf'};">${escapeHtml(token)}</span>`;
    }
  }

  return html;
}

function renderSnippetsList() {
  const list = document.getElementById('snippets-content-list');
  if (!list) return;

  const currentTheme = appConfig.settings.terminal_theme || appConfig.settings.theme || 'one_dark';
  const xtermTheme = getXtermTheme(currentTheme);
  const termFont = appConfig.settings.font_family || 'Cascadia Code, monospace';

  const snippets = appConfig.snippets || [];
  const filtered = snippets.filter((s) => {
    if (!snippetsSearchText) return true;
    const titleMatch = s.title?.toLowerCase().includes(snippetsSearchText);
    const cmdMatch = s.command?.toLowerCase().includes(snippetsSearchText);
    const tagMatch = s.tags?.toLowerCase().includes(snippetsSearchText);
    return titleMatch || cmdMatch || tagMatch;
  });

  if (filtered.length === 0) {
    list.innerHTML = `
      <div style="padding: 24px 12px; text-align: center; color: var(--text-subtle); font-size: 11.5px;">
        ${snippets.length === 0 ? 'No notes or aliases configured yet.<br><span style="color: var(--accent); cursor: pointer; text-decoration: underline;" id="snippets-empty-add">+ Add Note / Alias</span>' : 'No matching notes or aliases found.'}
      </div>
    `;
    document.getElementById('snippets-empty-add')?.addEventListener('click', () => {
      document.getElementById('btn-open-add-snippet')?.click();
    });
    return;
  }

  list.innerHTML = '';
  filtered.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'snippet-card';
    card.setAttribute('data-id', s.id);
    card.setAttribute('title', 'Click paste button or double-click to paste to active terminal | Right-click: Copy');

    card.style.background = xtermTheme.background || 'var(--bg-app)';
    card.style.borderColor = 'var(--border)';

    const cmdHtml = highlightShellCommand(s.command, xtermTheme);

    const rawTags = (s.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    const tagsHtml = rawTags.length > 0
      ? `<div class="snippet-term-footer"><div class="snippet-tags-list">${rawTags.map(t => `<span class="snippet-tag-pill">${escapeHtml(t)}</span>`).join('')}</div></div>`
      : '';

    card.innerHTML = `
      <div class="snippet-term-body" style="background: ${xtermTheme.background || 'var(--bg-app)'}; color: ${xtermTheme.foreground || '#abb2bf'}; font-family: ${termFont};">
        <span class="snippet-prompt" style="color: ${xtermTheme.green || '#98c379'}; user-select: none;">$</span>
        <div class="snippet-cmd-text" style="color: ${xtermTheme.foreground || '#abb2bf'}; font-family: ${termFont};" title="${escapeHtml(s.command)}">${cmdHtml}</div>
        <div class="snippet-actions">
          <button class="snippet-action-btn btn-paste" title="Paste to active terminal"><i class="fa">&#xf0ea;</i></button>
          <button class="snippet-action-btn btn-edit" title="Edit note"><i class="fa">&#xf044;</i></button>
          <button class="snippet-action-btn btn-del" title="Delete note"><i class="fa">&#xf1f8;</i></button>
        </div>
      </div>
      ${tagsHtml}
    `;

    // Single click -> select snippet card
    card.addEventListener('click', (e) => {
      if (e.target.closest('.snippet-actions')) return;
      document.querySelectorAll('.snippet-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });

    // Double-click -> paste directly into active terminal at cursor position
    card.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pasteToActiveTerminal(s.command);
      card.classList.add('flash-pasted');
      setTimeout(() => card.classList.remove('flash-pasted'), 450);
      showCopyToast('Pasted command to terminal');
    });

    // Single Right-click -> copy to clipboard (Native OS clipboard)
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSystemClipboardText(s.command).then(() => {
        card.classList.add('flash-pasted');
        setTimeout(() => card.classList.remove('flash-pasted'), 350);
        showCopyToast('Copied to clipboard');
      }).catch(() => {
        navigator.clipboard?.writeText(s.command).then(() => {
          card.classList.add('flash-pasted');
          setTimeout(() => card.classList.remove('flash-pasted'), 350);
          showCopyToast('Copied to clipboard');
        });
      });
    });

    // Paste button
    card.querySelector('.btn-paste')?.addEventListener('click', (e) => {
      e.stopPropagation();
      pasteToActiveTerminal(s.command);
      card.classList.add('flash-pasted');
      setTimeout(() => card.classList.remove('flash-pasted'), 450);
      showCopyToast('Pasted command to terminal');
    });

    // Edit button
    card.querySelector('.btn-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.openEditSnippetModal) {
        window.openEditSnippetModal(s);
      }
    });

    // Delete button
    card.querySelector('.btn-del')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete note "${s.command}"?`)) {
        try {
          const updated = await invoke('delete_snippet', { id: s.id });
          if (updated) {
            appConfig = updated;
            renderSnippetsList();
          }
        } catch (err) {
          console.error('Failed to delete snippet:', err);
        }
      }
    });

    list.appendChild(card);
  });
}

function setupSnippetModal() {
  const modal = document.getElementById('modal-add-snippet');
  const openBtn = document.getElementById('btn-open-add-snippet');
  const closeBtn = document.getElementById('modal-snippet-close');
  const cancelBtn = document.getElementById('modal-snippet-cancel');
  const submitBtn = document.getElementById('modal-snippet-submit');
  const titleEl = document.getElementById('modal-snippet-title');

  const inputTitle = document.getElementById('snippet-form-title');
  const inputCmd = document.getElementById('snippet-form-command');
  const inputTags = document.getElementById('snippet-form-tags');

  const closeModal = () => modal?.classList.add('hidden');
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      editingSnippetId = null;
      if (titleEl) titleEl.textContent = 'Add Note / Alias';
      if (inputTitle) inputTitle.value = '';
      if (inputCmd) inputCmd.value = '';
      if (inputTags) inputTags.value = '';
      modal?.classList.remove('hidden');
      setTimeout(() => inputTitle?.focus(), 50);
    });
  }

  window.openEditSnippetModal = (s) => {
    if (!modal) return;
    editingSnippetId = s.id;
    if (titleEl) titleEl.textContent = `Edit Note / Alias (${s.title})`;
    if (inputTitle) inputTitle.value = s.title || '';
    if (inputCmd) inputCmd.value = s.command || '';
    if (inputTags) inputTags.value = s.tags || '';
    modal.classList.remove('hidden');
    setTimeout(() => inputTitle?.focus(), 50);
  };

  submitBtn?.addEventListener('click', async () => {
    const title = inputTitle?.value.trim();
    const command = inputCmd?.value.trim();
    const tags = inputTags?.value.trim() || null;

    if (!title || !command) {
      alert('Please provide both a Title and Command / Note.');
      return;
    }

    const snippet = {
      id: editingSnippetId || `snip-${Date.now()}`,
      title,
      command,
      tags,
    };

    try {
      const updated = await invoke('save_snippet', { snippet });
      if (updated) {
        appConfig = updated;
        renderSnippetsList();
      }
      closeModal();
      showCopyToast(editingSnippetId ? 'Snippet updated' : 'Snippet added');
    } catch (err) {
      console.error('Failed to save snippet:', err);
      alert(`Error saving snippet: ${err}`);
    }
  });
}
