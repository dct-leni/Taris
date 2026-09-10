// ── In-App Code Editor & Multi-Language Highlighter ──
let currentlyOpenFile = null; // { name, path, isRemote, host, lang }
const openEditorBuffers = {}; // { [viewId]: { viewId, name, path, remotePath, isRemote, host, lang, content, mode, isModified, cursorStart, cursorEnd, scrollTop, scrollLeft } }
let activeEditorViewId = null;
window.openEditorBuffers = openEditorBuffers;

function isTreeSupported(lang) {
  return ['JSON', 'YAML', 'TOML'].includes((lang || '').toUpperCase());
}

function getFileViewId(filePath, isRemote = false, host = null) {
  const prefix = isRemote && host ? `rem_${host.id}_` : 'loc_';
  const normalized = (filePath || '').replace(/\\/g, '/');
  let hash = 0;
  const fullKey = prefix + normalized;
  for (let i = 0; i < fullKey.length; i++) {
    hash = ((hash << 5) - hash) + fullKey.charCodeAt(i);
    hash |= 0;
  }
  const rawName = normalized.split('/').pop() || 'file';
  const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20);
  return `file-${safeName}-${Math.abs(hash).toString(36)}`;
}

function detectLanguage(fileName) {
  if (!fileName) return 'TEXT';
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json') || lower.endsWith('.jsonc') || lower.endsWith('.json5')) return 'JSON';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'YAML';
  if (lower.endsWith('.toml')) return 'TOML';
  if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'BASH';
  if (lower.endsWith('.py')) return 'PYTHON';
  if (lower.endsWith('.rs')) return 'RUST';
  if (lower.endsWith('.sql')) return 'SQL';
  if (lower.includes('dockerfile')) return 'DOCKER';
  if (lower.endsWith('.ini') || lower.endsWith('.conf') || lower.endsWith('.cfg') || lower.endsWith('.service')) return 'CONFIG';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'MARKDOWN';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'CSV';
  if (lower.endsWith('.js') || lower.endsWith('.ts') || lower.endsWith('.jsx') || lower.endsWith('.tsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'JS';
  if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.xml') || lower.endsWith('.svg')) return 'HTML';
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) return 'CSS';
  if (lower.endsWith('.go')) return 'GO';
  if (lower.endsWith('.c') || lower.endsWith('.h') || lower.endsWith('.cpp') || lower.endsWith('.hpp') || lower.endsWith('.cc')) return 'CPP';
  return 'TEXT';
}

let editorCurrentMode = 'code';

function updateEditorModeButtons(lang) {
  const btnCode = document.querySelector('.editor-mode-btn[data-mode="code"]');
  const btnPreview = document.querySelector('.editor-mode-btn[data-mode="preview"]');
  const btnTree = document.querySelector('.editor-mode-btn[data-mode="tree"]');
  const btnGrid = document.querySelector('.editor-mode-btn[data-mode="grid"]');

  if (btnCode) btnCode.style.display = 'inline-flex';
  if (btnPreview) {
    btnPreview.style.display = (lang === 'MARKDOWN') ? 'inline-flex' : 'none';
  }
  if (btnTree) {
    btnTree.style.display = isTreeSupported(lang) ? 'inline-flex' : 'none';
  }
  if (btnGrid) {
    btnGrid.style.display = (['CSV', 'TSV'].includes(lang)) ? 'inline-flex' : 'none';
  }
}

function setEditorMode(mode) {
  const currentLang = currentlyOpenFile?.lang || 'TEXT';
  // Strict guard: Tree preview ONLY for known structured file types
  if (mode === 'tree' && !isTreeSupported(currentLang)) {
    mode = 'code';
  }
  if (mode === 'preview' && currentLang !== 'MARKDOWN') {
    mode = 'code';
  }
  if (mode === 'grid' && !['CSV', 'TSV'].includes(currentLang)) {
    mode = 'code';
  }

  editorCurrentMode = mode;
  if (activeEditorViewId && openEditorBuffers[activeEditorViewId]) {
    openEditorBuffers[activeEditorViewId].mode = mode;
  }

  document.querySelectorAll('.editor-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
  });

  const gutter = document.getElementById('editor-gutter');
  const canvas = document.querySelector('.editor-canvas');
  const previewPane = document.getElementById('editor-preview-pane');
  const treePane = document.getElementById('editor-tree-pane');
  const gridPane = document.getElementById('editor-grid-pane');
  const textarea = document.getElementById('editor-textarea');

  if (!canvas) return;

  if (previewPane) { previewPane.style.display = 'none'; previewPane.style.width = ''; }
  if (treePane) { treePane.style.display = 'none'; treePane.innerHTML = ''; }
  if (gridPane) { gridPane.style.display = 'none'; gridPane.innerHTML = ''; }
  if (gutter) gutter.style.display = '';
  canvas.style.display = '';
  canvas.style.width = '';

  const content = textarea ? textarea.value : '';

  if (mode === 'code') {
    // Standard code view
    if (typeof window.updateEditorView === 'function') {
      window.updateEditorView();
    }
  } else if (mode === 'preview') {
    if (gutter) gutter.style.display = 'none';
    canvas.style.display = 'none';
    if (previewPane) {
      previewPane.style.display = 'block';
      previewPane.style.width = '100%';
      previewPane.innerHTML = renderMarkdown(content);
    }
  } else if (mode === 'tree') {
    if (gutter) gutter.style.display = 'none';
    canvas.style.display = 'none';
    if (treePane) {
      treePane.style.display = 'block';
      renderStructuredTree(treePane, content, currentLang);
    }
  } else if (mode === 'grid') {
    if (gutter) gutter.style.display = 'none';
    canvas.style.display = 'none';
    if (gridPane) {
      gridPane.style.display = 'block';
      renderStructuredGrid(gridPane, content);
    }
  }
}

function saveCurrentBufferState() {
  if (!activeEditorViewId || !openEditorBuffers[activeEditorViewId]) return;
  const buf = openEditorBuffers[activeEditorViewId];
  const textarea = document.getElementById('editor-textarea');
  if (textarea) {
    buf.content = textarea.value;
    buf.cursorStart = textarea.selectionStart;
    buf.cursorEnd = textarea.selectionEnd;
    buf.scrollTop = textarea.scrollTop;
    buf.scrollLeft = textarea.scrollLeft;
  }
  buf.mode = editorCurrentMode;
}

function activateEditorTab(viewId) {
  if (!openEditorBuffers[viewId]) return;

  if (activeEditorViewId && activeEditorViewId !== viewId) {
    saveCurrentBufferState();
  }

  activeEditorViewId = viewId;
  const buf = openEditorBuffers[viewId];
  currentlyOpenFile = buf;

  // 1. Update UI Elements
  const statusText = document.getElementById('editor-status-text');
  const langBadge = document.getElementById('editor-lang-badge');
  const titleElem = document.getElementById('editor-file-title');
  const textarea = document.getElementById('editor-textarea');

  if (langBadge) langBadge.textContent = buf.lang;
  if (titleElem) titleElem.textContent = (buf.isRemote && buf.host ? `${buf.host.name}:` : '') + buf.path;

  if (textarea) {
    textarea.value = buf.content || '';
    if (typeof buf.scrollTop === 'number') {
      textarea.scrollTop = buf.scrollTop;
      textarea.scrollLeft = buf.scrollLeft || 0;
    }
    if (typeof buf.cursorStart === 'number') {
      textarea.selectionStart = buf.cursorStart;
      textarea.selectionEnd = buf.cursorEnd || buf.cursorStart;
    }
  }

  if (statusText) {
    if (buf.isModified) {
      statusText.innerHTML = '<span style="color: var(--orange);"><i class="fa">&#xf111;</i> Modified</span>';
    } else {
      statusText.innerHTML = '<span style="color: var(--green);"><i class="fa">&#xf00c;</i> Ready</span>';
    }
  }

  // 2. Select tab and switch view
  switchView(viewId);

  // 3. Mode buttons visibility
  updateEditorModeButtons(buf.lang);

  // 4. Fallback to code if mode unsupported
  let targetMode = buf.mode || 'code';
  if (targetMode === 'tree' && !isTreeSupported(buf.lang)) targetMode = 'code';
  if (targetMode === 'preview' && buf.lang !== 'MARKDOWN') targetMode = 'code';
  if (targetMode === 'grid' && !['CSV', 'TSV'].includes(buf.lang)) targetMode = 'code';

  setEditorMode(targetMode);

  if (typeof window.updateEditorView === 'function') {
    window.updateEditorView();
  }
}

function closeEditorTab(viewId) {
  if (openEditorBuffers[viewId]) {
    delete openEditorBuffers[viewId];
  }
  if (activeEditorViewId === viewId) {
    activeEditorViewId = null;
    currentlyOpenFile = null;
  }
}

let isPrismLoading = false;
async function ensurePrismLoaded() {
  if (typeof Prism !== 'undefined') return;
  if (isPrismLoading) {
    while (isPrismLoading) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return;
  }
  isPrismLoading = true;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'libs/prism.min.js';
      script.onload = () => {
        resolve();
        if (activeEditorViewId && openEditorBuffers[activeEditorViewId]) {
          const buf = openEditorBuffers[activeEditorViewId];
          const codeOutput = document.getElementById('editor-code-output');
          if (codeOutput && buf.mode === 'code') {
            codeOutput.innerHTML = highlightCode(buf.content, buf.lang);
          }
        }
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  } catch (err) {
    console.warn('Failed to dynamically load prism.min.js:', err);
  } finally {
    isPrismLoading = false;
  }
}

let isYamlLoading = false;
async function ensureYamlLoaded() {
  if (typeof window !== 'undefined' && window.jsyaml) return;
  if (isYamlLoading) {
    while (isYamlLoading) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return;
  }
  isYamlLoading = true;
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'libs/js-yaml.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  } catch (err) {
    console.warn('Failed to dynamically load js-yaml.min.js:', err);
  } finally {
    isYamlLoading = false;
  }
}

async function openEditorTab(fileName, filePath, isRemote = false, host = null) {
  const viewId = getFileViewId(filePath, isRemote, host);
  const lang = detectLanguage(fileName);

  ensurePrismLoaded().catch(() => {});
  if (lang === 'yaml' || lang === 'yml') {
    ensureYamlLoaded().catch(() => {});
  }

  // If already open in memory, activate it without network re-fetch
  if (openEditorBuffers[viewId]) {
    activateEditorTab(viewId);
    return;
  }

  // Save current active buffer before switching
  saveCurrentBufferState();

  // 1. Check if tab card already exists
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
      <i class="fa">&#xf15b;</i>
      <span class="tab-title">${escapeHtml(fileName)}</span>
      <span class="tab-close">✕</span>
    `;
    document.getElementById('add-tab-btn').before(tab);
    setupTabInteractivity();
  }

  // 2. Setup editor view UI
  const statusText = document.getElementById('editor-status-text');
  const langBadge = document.getElementById('editor-lang-badge');
  const titleElem = document.getElementById('editor-file-title');

  if (langBadge) langBadge.textContent = lang;
  if (titleElem) titleElem.textContent = (isRemote && host ? `${host.name}:` : '') + filePath;
  if (statusText) statusText.innerHTML = '<span style="color: var(--text-subtle);">Loading...</span>';

  let content = '';
  try {
    if (isRemote && host) {
      content = await invoke('read_remote_file', { host, remotePath: filePath });
    } else {
      content = await invoke('read_local_file', { path: filePath });
    }
  } catch (err) {
    console.error('Failed to read file:', err);
    if (statusText) statusText.innerHTML = `<span style="color: var(--red);">Error reading file</span>`;
  }

  // 3. Register buffer
  openEditorBuffers[viewId] = {
    viewId,
    name: fileName,
    path: filePath,
    remotePath: filePath,
    isRemote,
    host,
    lang,
    content: content || '',
    mode: 'code',
    isModified: false,
    cursorStart: 0,
    cursorEnd: 0,
    scrollTop: 0,
    scrollLeft: 0,
  };

  activateEditorTab(viewId);
}


// ── 9. Multi-Language Live Syntax Highlighting Code Editor ──
function highlightCode(code, lang = 'text') {
  if (!code) return '';
  const l = (lang || 'text').toLowerCase();

  // 1. Check if Prism.js is available
  const langMap = {
    rs: 'rust',
    rust: 'rust',
    js: 'javascript',
    ts: 'typescript',
    jsx: 'javascript',
    tsx: 'typescript',
    mjs: 'javascript',
    cjs: 'javascript',
    javascript: 'javascript',
    typescript: 'typescript',
    py: 'python',
    python: 'python',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    shell: 'bash',
    sql: 'sql',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    docker: 'docker',
    dockerfile: 'docker',
    html: 'markup',
    htm: 'markup',
    xml: 'markup',
    svg: 'markup',
    css: 'css',
    scss: 'css',
    go: 'go',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    md: 'markdown',
    markdown: 'markdown',
    ini: 'ini',
    conf: 'ini',
    service: 'ini',
  };

  const prismLang = langMap[l] || l;
  if (typeof Prism !== 'undefined' && Prism.languages && Prism.languages[prismLang]) {
    try {
      return Prism.highlight(code, Prism.languages[prismLang], prismLang) + (code.endsWith('\n') ? ' ' : '');
    } catch (err) {
      console.warn('Prism highlight failed:', err);
    }
  }

  // 2. Native single-pass tokenizer fallback
  const isRust = l === 'rust' || l === 'rs';
  const isPython = l === 'python' || l === 'py';
  const isJs = ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'javascript', 'typescript'].includes(l);
  const isJson = l === 'json';
  const isYaml = ['yaml', 'yml'].includes(l);
  const isToml = l === 'toml';
  const isSql = l === 'sql';
  const isBash = ['sh', 'bash', 'zsh', 'shell'].includes(l);
  const isDocker = ['docker', 'dockerfile'].includes(l);
  const isGo = l === 'go';
  const isCpp = ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp'].includes(l);

  const escapeHtml = (str) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let keywords = [];
  let types = [];
  let commentRegex = null;

  if (isRust) {
    keywords = ['fn', 'let', 'mut', 'struct', 'enum', 'impl', 'pub', 'trait', 'use', 'mod', 'type', 'match', 'if', 'else', 'loop', 'while', 'for', 'in', 'return', 'break', 'continue', 'unsafe', 'async', 'await', 'const', 'static', 'ref', 'where', 'as', 'crate', 'super'];
    types = ['String', 'str', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'f32', 'f64', 'bool', 'char', 'Option', 'Some', 'None', 'Result', 'Ok', 'Err', 'Vec', 'Box', 'Rc', 'Arc', 'Self', 'self'];
    commentRegex = '//.*';
  } else if (isJs) {
    keywords = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'default', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'super', 'new', 'this', 'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'async', 'await', 'import', 'export', 'from', 'as', 'yield', 'debugger'];
    types = ['Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Function', 'RegExp', 'Map', 'Set', 'Error', 'any', 'void', 'never', 'unknown'];
    commentRegex = '//.*';
  } else if (isPython) {
    keywords = ['def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'pass', 'break', 'continue', 'lambda', 'yield', 'global', 'nonlocal', 'async', 'await', 'in', 'is', 'not', 'and', 'or'];
    types = ['int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes', 'object', 'self', 'cls'];
    commentRegex = '#.*';
  } else if (isGo) {
    keywords = ['func', 'package', 'import', 'return', 'var', 'const', 'type', 'struct', 'interface', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'select', 'go', 'defer', 'chan', 'map', 'break', 'continue', 'fallthrough'];
    types = ['string', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr', 'byte', 'rune', 'float32', 'float64', 'complex64', 'complex128', 'bool', 'error'];
    commentRegex = '//.*';
  } else if (isCpp) {
    keywords = ['auto', 'break', 'case', 'catch', 'class', 'const', 'constexpr', 'continue', 'default', 'delete', 'do', 'else', 'enum', 'explicit', 'export', 'extern', 'for', 'friend', 'goto', 'if', 'inline', 'mutable', 'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'private', 'protected', 'public', 'return', 'sizeof', 'static', 'static_assert', 'struct', 'switch', 'template', 'this', 'throw', 'try', 'typedef', 'typeid', 'typename', 'union', 'using', 'virtual', 'while'];
    types = ['bool', 'char', 'char16_t', 'char32_t', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned', 'void', 'wchar_t', 'size_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'string', 'vector', 'map', 'unique_ptr', 'shared_ptr'];
    commentRegex = '//.*';
  } else if (isSql) {
    keywords = ['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON', 'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'CREATE', 'TABLE', 'VIEW', 'INDEX', 'DROP', 'ALTER', 'ADD', 'COLUMN', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'DEFAULT', 'NULL', 'NOT', 'AND', 'OR', 'AS', 'IN', 'SET', 'VALUES', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT', 'UNION', 'ALL', 'HAVING', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'PRAGMA', 'TRANSACTION', 'COMMIT', 'ROLLBACK'];
    types = ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'VARCHAR', 'CHAR', 'BOOLEAN', 'DATETIME', 'DATE', 'TIME', 'TIMESTAMP', 'INT', 'BIGINT', 'SMALLINT', 'DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE'];
    commentRegex = '--.*';
  } else if (isDocker) {
    keywords = ['FROM', 'RUN', 'CMD', 'LABEL', 'MAINTAINER', 'EXPOSE', 'ENV', 'ADD', 'COPY', 'ENTRYPOINT', 'VOLUME', 'USER', 'WORKDIR', 'ARG', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL'];
    commentRegex = '#.*';
  } else if (isBash) {
    keywords = ['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until', 'do', 'done', 'function', 'return', 'exit', 'export', 'local', 'echo', 'set', 'unset', 'read', 'source'];
    commentRegex = '#.*';
  } else if (isYaml || isToml) {
    commentRegex = '#.*';
  }

  const parts = [];
  if (commentRegex) parts.push(`(?<comment>${commentRegex})`);
  parts.push(`(?<string>"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|` + '`(?:\\\\.|[^`\\\\])*`)');
  if (isJson || isYaml || isToml) {
    parts.push(`(?<key>^\\s*(?:-\\s*)?[a-zA-Z0-9_\\-\\.]+(?=\\s*[:=]))`);
  }
  parts.push(`(?<number>\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)`);
  parts.push(`(?<word>[a-zA-Z_][a-zA-Z0-9_]*)`);

  const masterRegex = new RegExp(parts.join('|'), isSql ? 'gi' : 'g');
  const kwSet = new Set(keywords.map((k) => (isSql ? k.toUpperCase() : k)));
  const typeSet = new Set(types.map((t) => (isSql ? t.toUpperCase() : t)));
  const boolSet = new Set(['true', 'false', 'null', 'undefined', 'True', 'False', 'None', 'TRUE', 'FALSE', 'NULL', 'nil']);

  const lines = code.split('\n');
  const highlighted = lines.map((line) => {
    let lastIndex = 0;
    let out = '';
    let match;
    masterRegex.lastIndex = 0;

    while ((match = masterRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        out += escapeHtml(line.slice(lastIndex, match.index));
      }
      lastIndex = masterRegex.lastIndex;

      const [matchedStr] = match;
      const g = match.groups || {};

      if (g.comment) {
        out += `<span class="token-comment">${escapeHtml(matchedStr)}</span>`;
      } else if (g.string) {
        out += `<span class="token-str">${escapeHtml(matchedStr)}</span>`;
      } else if (g.key) {
        out += `<span class="token-key">${escapeHtml(matchedStr)}</span>`;
      } else if (g.number) {
        out += `<span class="token-num">${escapeHtml(matchedStr)}</span>`;
      } else if (g.word) {
        const checkWord = isSql ? matchedStr.toUpperCase() : matchedStr;
        if (kwSet.has(checkWord)) {
          out += `<span class="token-kw">${escapeHtml(matchedStr)}</span>`;
        } else if (typeSet.has(checkWord)) {
          out += `<span class="token-type">${escapeHtml(matchedStr)}</span>`;
        } else if (boolSet.has(matchedStr)) {
          out += `<span class="token-bool">${escapeHtml(matchedStr)}</span>`;
        } else {
          out += escapeHtml(matchedStr);
        }
      } else {
        out += escapeHtml(matchedStr);
      }
    }

    if (lastIndex < line.length) {
      out += escapeHtml(line.slice(lastIndex));
    }
    return out;
  });

  return highlighted.join('\n') + (code.endsWith('\n') ? ' ' : '');
}

function setupCodeEditor() {
  const textarea = document.getElementById('editor-textarea');
  const codeElem = document.getElementById('editor-code');
  const preElem = document.getElementById('editor-highlight');
  const gutter = document.getElementById('editor-gutter');
  const statusText = document.getElementById('editor-status-text');
  const linesBadge = document.getElementById('editor-lines-count');
  const saveBtn = document.querySelector('.editor-save-btn');

  if (!textarea || !gutter) return;

  function updateView() {
    const lines = textarea.value.split('\n').length;
    let gutterHtml = '';
    for (let i = 1; i <= lines; i++) {
      gutterHtml += `${i}\n`;
    }
    gutter.textContent = gutterHtml;
    if (linesBadge) {
      linesBadge.textContent = `${lines} lines`;
    }

    if (codeElem) {
      const currentLang = currentlyOpenFile?.language || currentlyOpenFile?.lang || 'text';
      codeElem.innerHTML = highlightCode(textarea.value, currentLang);
    }

    // Update active secondary pane
    const previewPane = document.getElementById('editor-preview-pane');
    const treePane = document.getElementById('editor-tree-pane');
    const gridPane = document.getElementById('editor-grid-pane');

    if (editorCurrentMode === 'preview') {
      if (previewPane) previewPane.innerHTML = renderMarkdown(textarea.value);
    } else if (editorCurrentMode === 'tree') {
      if (treePane) renderStructuredTree(treePane, textarea.value, currentlyOpenFile?.lang || 'YAML');
    } else if (editorCurrentMode === 'grid') {
      if (gridPane) renderStructuredGrid(gridPane, textarea.value);
    }
  }

  window.updateEditorView = updateView;

  // Wire mode switcher buttons
  document.querySelectorAll('.editor-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      setEditorMode(mode);
    });
  });

  textarea.addEventListener('scroll', () => {
    if (preElem) {
      preElem.scrollTop = textarea.scrollTop;
      preElem.scrollLeft = textarea.scrollLeft;
    }
    gutter.scrollTop = textarea.scrollTop;
  });

  textarea.addEventListener('input', () => {
    updateView();
    if (activeEditorViewId && openEditorBuffers[activeEditorViewId]) {
      openEditorBuffers[activeEditorViewId].content = textarea.value;
      openEditorBuffers[activeEditorViewId].isModified = true;
    }
    if (statusText) {
      statusText.innerHTML = '<span style="color: var(--orange);"><i class="fa">&#xf111;</i> Modified</span>';
    }
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      updateView();
      if (activeEditorViewId && openEditorBuffers[activeEditorViewId]) {
        openEditorBuffers[activeEditorViewId].content = textarea.value;
        openEditorBuffers[activeEditorViewId].isModified = true;
      }
      if (statusText) {
        statusText.innerHTML = '<span style="color: var(--orange);"><i class="fa">&#xf111;</i> Modified</span>';
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveBtn?.click();
    }
  });

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      if (currentlyOpenFile) {
        try {
          if (currentlyOpenFile.isRemote) {
            const activeTab = document.querySelector('.tab-card.active');
            const fallbackPath = activeTab?.getAttribute('data-file-path');
            const remotePath = currentlyOpenFile.remotePath || currentlyOpenFile.path || fallbackPath;
            const hostId = activeTab?.getAttribute('data-host-id');
            const host = currentlyOpenFile.host || (hostId ? (appConfig.hosts || []).find((h) => h.id === hostId) : null);
            if (!remotePath) throw new Error('Missing remote file path');
            if (!host) throw new Error('Missing remote host context');

            await invoke('write_remote_file', {
              host,
              remotePath,
              content: textarea.value
            });
          } else {
            const localPath = currentlyOpenFile.path || currentlyOpenFile.remotePath || currentlyOpenFile;
            if (!localPath) throw new Error('Missing file path');
            await invoke('write_local_file', {
              path: localPath,
              content: textarea.value
            });
          }
        } catch (err) {
          console.error('Failed to write file:', err);
          if (statusText) {
            statusText.innerHTML = `<span style="color: var(--red);"><i class="fa">&#xf00d;</i> Error: ${err}</span>`;
          }
          return;
        }
      }
      if (activeEditorViewId && openEditorBuffers[activeEditorViewId]) {
        openEditorBuffers[activeEditorViewId].content = textarea.value;
        openEditorBuffers[activeEditorViewId].isModified = false;
      }
      const origHtml = saveBtn.innerHTML;
      saveBtn.innerHTML = '<i class="fa" style="color: var(--green);">&#xf00c;</i> Saved';
      saveBtn.style.borderColor = 'var(--green)';
      if (statusText) {
        statusText.innerHTML = '<span style="color: var(--green);"><i class="fa">&#xf00c;</i> Saved</span>';
      }
      setTimeout(() => {
        saveBtn.innerHTML = origHtml;
        saveBtn.style.borderColor = 'var(--border)';
      }, 1500);
    });
  }

  updateView();
}

// ── Markdown Live Rendering Engine ──
function renderMarkdown(md) {
  if (!md) return '<p style="color: var(--text-subtle);">Empty document</p>';

  const escape = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  let html = '';
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent = '';
  let inTable = false;
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (!inCodeBlock) {
        if (inList) { html += '</ul>'; inList = false; }
        if (inTable) { html += '</table>'; inTable = false; }
        inCodeBlock = true;
        codeBlockLang = trimmed.slice(3).trim();
        codeBlockContent = '';
      } else {
        inCodeBlock = false;
        html += `<pre><code class="language-${escape(codeBlockLang)}">${escape(codeBlockContent.trimEnd())}</code></pre>`;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      continue;
    }

    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (inList) { html += '</ul>'; inList = false; }
      const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) {
        continue;
      }
      if (!inTable) {
        inTable = true;
        html += '<table><thead><tr>' + cells.map(c => `<th>${formatInlineMarkdown(c)}</th>`).join('') + '</tr></thead><tbody>';
      } else {
        html += '<tr>' + cells.map(c => `<td>${formatInlineMarkdown(c)}</td>`).join('') + '</tr>';
      }
      continue;
    } else if (inTable) {
      html += '</tbody></table>';
      inTable = false;
    }

    if (trimmed === '') {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      if (inList) { html += '</ul>'; inList = false; }
      const level = headingMatch[1].length;
      html += `<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>`;
      continue;
    }

    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0;">';
      continue;
    }

    if (trimmed.startsWith('> ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<blockquote style="border-left: 3px solid var(--accent); margin: 8px 0; padding-left: 12px; color: var(--text-muted);">${formatInlineMarkdown(trimmed.slice(2))}</blockquote>`;
      continue;
    }

    if (trimmed.startsWith('- [ ] ') || trimmed.startsWith('- [x] ')) {
      if (!inList) { html += '<ul style="list-style: none; padding-left: 4px;">'; inList = true; }
      const checked = trimmed.startsWith('- [x] ');
      const text = trimmed.slice(6);
      html += `<li style="display: flex; align-items: center; gap: 6px; margin: 3px 0;"><input type="checkbox" ${checked ? 'checked' : ''} disabled> <span>${formatInlineMarkdown(text)}</span></li>`;
      continue;
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) { html += '<ul style="padding-left: 20px; margin: 6px 0;">'; inList = true; }
      html += `<li>${formatInlineMarkdown(trimmed.slice(2))}</li>`;
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (!inList) { html += '<ol style="padding-left: 20px; margin: 6px 0;">'; inList = true; }
      html += `<li>${formatInlineMarkdown(olMatch[2])}</li>`;
      continue;
    }

    if (inList) { html += inList === true ? '</ul>' : '</ol>'; inList = false; }
    html += `<p style="margin: 6px 0;">${formatInlineMarkdown(line)}</p>`;
  }

  if (inCodeBlock) html += `<pre><code>${escape(codeBlockContent)}</code></pre>`;
  if (inTable) html += '</tbody></table>';
  if (inList) html += '</ul>';

  return html;
}

function formatInlineMarkdown(str) {
  if (!str) return '';
  const escape = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = escape(str);
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%; border-radius: 4px; margin: 6px 0;" />');
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: var(--accent); text-decoration: underline;">$1</a>');
  return out;
}

// ── AST Structured Tree Engine (JSON / YAML / TOML) ──
function parseYaml(yamlText) {
  if (!yamlText || !yamlText.trim()) return {};

  // 1. Industry-standard js-yaml parser if available
  const yamlLib = (typeof window !== 'undefined' && window.jsyaml) ? window.jsyaml : (typeof globalThis !== 'undefined' && globalThis.jsyaml ? globalThis.jsyaml : null);
  if (yamlLib && typeof yamlLib.loadAll === 'function') {
    try {
      const docs = [];
      yamlLib.loadAll(yamlText, (doc) => {
        if (doc !== undefined && doc !== null) {
          docs.push(doc);
        }
      });
      if (docs.length === 0) return {};
      if (docs.length === 1) return docs[0];
      return docs;
    } catch (e) {
      try {
        const single = yamlLib.load(yamlText);
        return single !== undefined && single !== null ? single : {};
      } catch (err) {
        throw err;
      }
    }
  }

  // 2. High-resilience pure JS fallback parser
  const rawLines = yamlText.split(/\r?\n/);
  const lines = [];

  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed === '---' || trimmed === '...' || trimmed.startsWith('#')) {
      continue;
    }

    let inQuotes = false;
    let quoteChar = '';
    let commentIdx = -1;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if ((ch === '"' || ch === "'") && (c === 0 || line[c - 1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = ch;
        } else if (quoteChar === ch) {
          inQuotes = false;
        }
      } else if (ch === '#' && !inQuotes && c > 0 && /\s/.test(line[c - 1])) {
        commentIdx = c;
        break;
      }
    }
    if (commentIdx !== -1) {
      line = line.slice(0, commentIdx).trimEnd();
    }

    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1].replace(/\t/g, '  ').length : 0;
    const cleanText = line.trim();
    if (!cleanText) continue;

    lines.push({ indent, text: cleanText });
  }

  if (lines.length === 0) return {};

  let index = 0;

  function parseScalar(valStr) {
    if (valStr === undefined || valStr === null) return null;
    valStr = valStr.trim();
    if (valStr === '' || valStr === '~' || valStr === 'null' || valStr === 'Null' || valStr === 'NULL') return null;
    if (['true', 'True', 'TRUE', 'yes', 'Yes', 'YES', 'on', 'On', 'ON'].includes(valStr)) return true;
    if (['false', 'False', 'FALSE', 'no', 'No', 'NO', 'off', 'Off', 'OFF'].includes(valStr)) return false;

    // Quoted string
    if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
      return valStr.slice(1, -1);
    }

    // Inline array: [1, 2, 3]
    if (valStr.startsWith('[') && valStr.endsWith(']')) {
      try {
        return JSON.parse(valStr.replace(/'/g, '"'));
      } catch (_) {
        return valStr.slice(1, -1).split(',').map(s => parseScalar(s.trim()));
      }
    }

    // Inline object: {a: 1, b: 2}
    if (valStr.startsWith('{') && valStr.endsWith('}')) {
      try {
        return JSON.parse(valStr.replace(/([\w-]+)\s*:/g, '"$1":').replace(/'/g, '"'));
      } catch (_) {
        const obj = {};
        valStr.slice(1, -1).split(',').forEach(part => {
          const colonIdx = part.indexOf(':');
          if (colonIdx !== -1) {
            obj[part.slice(0, colonIdx).trim().replace(/^["']|["']$/g, '')] = parseScalar(part.slice(colonIdx + 1));
          }
        });
        return obj;
      }
    }

    // Numbers
    if (/^-?\d+$/.test(valStr)) {
      const num = parseInt(valStr, 10);
      if (!isNaN(num)) return num;
    }
    if (/^-?\d+\.\d+$/.test(valStr)) {
      const num = parseFloat(valStr);
      if (!isNaN(num)) return num;
    }

    return valStr;
  }

  function parseBlock(currentIndent) {
    if (index >= lines.length) return null;
    const firstLine = lines[index];

    if (firstLine.text.startsWith('- ') || firstLine.text === '-') {
      return parseList(currentIndent);
    } else {
      return parseObject(currentIndent);
    }
  }

  function parseList(targetIndent) {
    const arr = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < targetIndent) break;
      if (!line.text.startsWith('- ') && line.text !== '-') break;

      let itemText = line.text.startsWith('- ') ? line.text.slice(2).trim() : '';
      index++;

      if (!itemText) {
        if (index < lines.length && lines[index].indent > line.indent) {
          arr.push(parseBlock(lines[index].indent));
        } else {
          arr.push(null);
        }
      } else {
        const isQuoted = (itemText.startsWith('"') && itemText.endsWith('"')) || (itemText.startsWith("'") && itemText.endsWith("'"));
        const kvMatch = !isQuoted && itemText.match(/^([a-zA-Z0-9_.-]+):\s*(.*)$/);

        if (kvMatch) {
          const k = kvMatch[1];
          const v = kvMatch[2].trim();
          const obj = {};

          if (v) {
            obj[k] = parseScalar(v);
          } else if (index < lines.length && (lines[index].indent > line.indent || (lines[index].indent >= line.indent && (lines[index].text.startsWith('- ') || lines[index].text === '-')))) {
            obj[k] = parseBlock(lines[index].indent);
          } else {
            obj[k] = null;
          }

          const childIndent = line.indent + 1;
          while (index < lines.length && lines[index].indent >= childIndent && !lines[index].text.startsWith('- ') && lines[index].text !== '-') {
            const nextL = lines[index];
            const nextKv = nextL.text.match(/^([a-zA-Z0-9_.-]+):\s*(.*)$/);
            if (nextKv) {
              const nk = nextKv[1];
              const nv = nextKv[2].trim();
              index++;
              if (nv) {
                obj[nk] = parseScalar(nv);
              } else if (index < lines.length && (lines[index].indent > nextL.indent || (lines[index].indent >= nextL.indent && (lines[index].text.startsWith('- ') || lines[index].text === '-')))) {
                obj[nk] = parseBlock(lines[index].indent);
              } else {
                obj[nk] = null;
              }
            } else {
              index++;
            }
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(itemText));
        }
      }
    }
    return arr;
  }

  function parseObject(targetIndent) {
    const obj = {};
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < targetIndent) break;
      if (line.text.startsWith('- ') || line.text === '-') break;

      const kvMatch = line.text.match(/^([^:]+):\s*(.*)$/);
      if (!kvMatch) {
        index++;
        continue;
      }

      const key = kvMatch[1].trim().replace(/^["']|["']$/g, '');
      const valStr = kvMatch[2].trim();
      index++;

      if (valStr) {
        obj[key] = parseScalar(valStr);
      } else {
        if (index < lines.length && (lines[index].indent > line.indent || (lines[index].indent >= line.indent && (lines[index].text.startsWith('- ') || lines[index].text === '-')))) {
          obj[key] = parseBlock(lines[index].indent);
        } else {
          obj[key] = null;
        }
      }
    }
    return obj;
  }

  return parseBlock(lines[0].indent) || {};
}

function parseToml(text) {
  if (!text || !text.trim()) return {};
  const lines = text.split(/\r?\n/);
  const root = {};
  let currentSection = root;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const parts = sectionMatch[1].split('.');
      let target = root;
      for (const part of parts) {
        const p = part.trim();
        if (!target[p] || typeof target[p] !== 'object') {
          target[p] = {};
        }
        target = target[p];
      }
      currentSection = target;
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx !== -1) {
      const k = line.slice(0, eqIdx).trim().replace(/^["']|["']$/g, '');
      let v = line.slice(eqIdx + 1).trim();
      if (v.includes(' #')) {
        v = v.slice(0, v.indexOf(' #')).trim();
      }
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
      else if (v === 'true') v = true;
      else if (v === 'false') v = false;
      else if (/^-?\d+$/.test(v)) v = parseInt(v, 10);
      else if (/^-?\d+\.\d+$/.test(v)) v = parseFloat(v);
      else if (v.startsWith('[') && v.endsWith(']')) {
        try { v = JSON.parse(v.replace(/'/g, '"')); } catch (_) {}
      }
      currentSection[k] = v;
    }
  }

  return root;
}

function renderStructuredTree(container, text, lang) {
  let data = null;
  const upperLang = (lang || '').toUpperCase();

  try {
    if (upperLang === 'JSON') {
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        data = parseYaml(text);
      }
    } else if (upperLang === 'TOML') {
      data = parseToml(text);
    } else if (upperLang === 'YAML' || upperLang === 'YML') {
      data = parseYaml(text);
    } else {
      try {
        data = JSON.parse(text);
      } catch (_) {
        try {
          data = parseYaml(text);
        } catch (_2) {
          data = parseToml(text);
        }
      }
    }
  } catch (err) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--red);">
        <i class="fa" style="font-size: 20px; margin-bottom: 8px;">&#xf071;</i>
        <div style="font-weight: 600; margin-bottom: 4px;">Unable to parse structured ${escapeHtml(lang || 'document')}</div>
        <div style="font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono);">${escapeHtml(err.message || String(err))}</div>
      </div>
    `;
    return;
  }

  if (data === null || data === undefined || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0 && !(data instanceof Date))) {
    container.innerHTML = `
      <div style="padding: 30px; text-align: center; color: var(--text-muted);">
        <i class="fa" style="font-size: 24px; margin-bottom: 10px; color: var(--text-subtle); display: block;">&#xf1e0;</i>
        <div style="font-size: 13px; font-weight: 500;">No structured data found in ${escapeHtml(lang || 'file')}</div>
      </div>
    `;
    return;
  }

  const countBadge = Array.isArray(data) ? `${data.length} items` : `${Object.keys(data).length} keys`;

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 8px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 11.5px; color: var(--text-muted);"><i class="fa">&#xf1e0;</i> AST Object Tree (${escapeHtml(lang)})</span>
        <span style="font-size: 10px; padding: 1px 6px; border-radius: 3px; background: var(--bg-dock); border: 1px solid var(--border); color: var(--accent);">${countBadge}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px;">
        <input type="text" id="tree-search-filter" class="search-input" placeholder="Filter keys or values..." style="height: 22px; font-size: 11px; max-width: 180px; padding: 0 6px;">
        <button id="tree-expand-all" class="btn-secondary" style="font-size: 10.5px; height: 22px; padding: 0 8px;">Expand All</button>
        <button id="tree-collapse-all" class="btn-secondary" style="font-size: 10.5px; height: 22px; padding: 0 8px;">Collapse All</button>
      </div>
    </div>
    <div id="tree-root-nodes" style="font-family: var(--font-mono); font-size: 12.5px;"></div>
  `;

  const rootDiv = container.querySelector('#tree-root-nodes');
  if (rootDiv) {
    if (Array.isArray(data)) {
      data.forEach((item, idx) => {
        rootDiv.appendChild(buildTreeNode(idx, item, idx === data.length - 1));
      });
    } else if (typeof data === 'object' && data !== null && !(data instanceof Date)) {
      const keys = Object.keys(data);
      keys.forEach((k, idx) => {
        rootDiv.appendChild(buildTreeNode(k, data[k], idx === keys.length - 1));
      });
    } else {
      rootDiv.appendChild(buildTreeNode(null, data, true));
    }
  }

  container.querySelector('#tree-expand-all')?.addEventListener('click', () => {
    container.querySelectorAll('.tree-children').forEach(c => c.style.display = 'block');
    container.querySelectorAll('.tree-toggle-arrow').forEach(a => a.innerHTML = '&#xf0d7;');
  });

  container.querySelector('#tree-collapse-all')?.addEventListener('click', () => {
    container.querySelectorAll('.tree-children').forEach(c => c.style.display = 'none');
    container.querySelectorAll('.tree-toggle-arrow').forEach(a => a.innerHTML = '&#xf0da;');
  });

  const filterInput = container.querySelector('#tree-search-filter');
  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const allRows = container.querySelectorAll('.tree-node-row');
      if (!q) {
        allRows.forEach(r => r.style.background = '');
        return;
      }
      allRows.forEach(r => {
        const text = r.textContent.toLowerCase();
        if (text.includes(q)) {
          r.style.background = 'rgba(97, 175, 239, 0.18)';
          let parent = r.closest('.tree-children');
          while (parent) {
            parent.style.display = 'block';
            const arrow = parent.previousElementSibling?.querySelector('.tree-toggle-arrow');
            if (arrow) arrow.innerHTML = '&#xf0d7;';
            parent = parent.parentElement?.closest('.tree-children');
          }
        } else {
          r.style.background = '';
        }
      });
    });
  }
}

function buildTreeNode(key, val, isLast = false) {
  const node = document.createElement('div');
  node.className = 'tree-node';

  const isDate = val instanceof Date;
  const isArr = Array.isArray(val);
  const isObj = !isDate && !isArr && val !== null && typeof val === 'object';

  if (isObj || isArr) {
    const count = isArr ? val.length : Object.keys(val).length;
    const bracketOpen = isArr ? '[' : '{';
    const bracketClose = isArr ? ']' : '}';

    const keyHtml = key !== null
      ? (typeof key === 'number'
          ? `<span class="tree-key-idx" style="color: var(--text-muted); font-weight: normal;">[${key}]</span>: `
          : `<span class="tree-key">${escapeHtml(key)}</span>: `)
      : '';

    const header = document.createElement('div');
    header.className = 'tree-node-row';
    header.style.cursor = 'pointer';
    header.innerHTML = `
      <span class="tree-toggle-arrow fa">&#xf0d7;</span>
      ${keyHtml}
      <span style="color: var(--text-subtle);">${bracketOpen}</span>
      <span style="font-size: 10.5px; color: var(--text-muted); margin: 0 4px;">(${count} ${isArr ? 'items' : 'keys'})</span>
    `;

    const children = document.createElement('div');
    children.className = 'tree-children';
    children.style.paddingLeft = '18px';
    children.style.borderLeft = '1px solid rgba(255, 255, 255, 0.06)';
    children.style.marginLeft = '6px';

    if (isArr) {
      val.forEach((item, idx) => {
        children.appendChild(buildTreeNode(idx, item, idx === val.length - 1));
      });
    } else {
      const keys = Object.keys(val);
      keys.forEach((k, idx) => {
        children.appendChild(buildTreeNode(k, val[k], idx === keys.length - 1));
      });
    }

    const arrow = header.querySelector('.tree-toggle-arrow');
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = children.style.display !== 'none';
      children.style.display = open ? 'none' : 'block';
      arrow.innerHTML = open ? '&#xf0da;' : '&#xf0d7;';
    });

    node.appendChild(header);
    node.appendChild(children);
  } else {
    const row = document.createElement('div');
    row.className = 'tree-node-row';
    let valHtml = '';
    if (isDate) {
      valHtml = `<span class="tree-val-str">"${escapeHtml(val.toISOString())}"</span>`;
    } else if (typeof val === 'string') {
      valHtml = `<span class="tree-val-str">"${escapeHtml(val)}"</span>`;
    } else if (typeof val === 'number') {
      valHtml = `<span class="tree-val-num">${val}</span>`;
    } else if (typeof val === 'boolean') {
      valHtml = `<span class="tree-val-bool">${val}</span>`;
    } else if (val === null || val === undefined) {
      valHtml = `<span class="tree-val-null">null</span>`;
    } else {
      valHtml = `<span>${escapeHtml(String(val))}</span>`;
    }

    const keyHtml = key !== null
      ? (typeof key === 'number'
          ? `<span class="tree-key-idx" style="color: var(--text-muted); font-weight: normal;">[${key}]</span>: `
          : `<span class="tree-key">${escapeHtml(key)}</span>: `)
      : '';

    row.innerHTML = `
      <span style="width: 14px; display: inline-block;"></span>
      ${keyHtml}
      ${valHtml}${!isLast ? '<span style="color: var(--text-subtle);">,</span>' : ''}
    `;
    node.appendChild(row);
  }

  return node;
}

// ── Virtualized CSV / TSV Data Grid ──
function renderStructuredGrid(container, text) {
  if (!text) {
    container.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-subtle);">Empty CSV file</div>';
    return;
  }

  const firstLine = text.split('\n')[0] || '';
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;

  let delim = ',';
  if (tabCount > commaCount && tabCount > semiCount) delim = '\t';
  else if (semiCount > commaCount && semiCount > tabCount) delim = ';';

  function parseCsvRow(rowStr, d) {
    const row = [];
    let insideQuotes = false;
    let entry = '';
    for (let i = 0; i < rowStr.length; i++) {
      const char = rowStr[i];
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === d && !insideQuotes) {
        row.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    row.push(entry.trim());
    return row;
  }

  const allLines = text.split('\n').filter(l => l.trim().length > 0);
  if (allLines.length === 0) {
    container.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-subtle);">No data rows found</div>';
    return;
  }

  const headers = parseCsvRow(allLines[0], delim);
  const rawRows = allLines.slice(1).map(l => parseCsvRow(l, delim));

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border);">
      <div style="display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--text-muted);">
        <span><i class="fa">&#xf0ce;</i> ${rawRows.length} rows × ${headers.length} cols</span>
        <span style="font-size: 10px; padding: 1px 5px; border-radius: 2px; background: var(--bg-dock); border: 1px solid var(--border);">Delimiter: ${delim === '\t' ? 'TAB' : delim === ';' ? 'SEMICOLON' : 'COMMA'}</span>
      </div>
      <input type="text" id="csv-grid-filter" class="search-input" style="max-width: 220px; height: 24px; font-size: 11px;" placeholder="Search all columns...">
    </div>
    <div style="max-height: calc(100% - 45px); overflow: auto; border: 1px solid var(--border); border-radius: 4px;">
      <table class="grid-table" id="active-grid-table">
        <thead>
          <tr>
            <th style="width: 40px; text-align: center; color: var(--text-subtle);">#</th>
            ${headers.map((h, i) => `<th data-col="${i}"><span style="display: flex; align-items: center; justify-content: space-between; gap: 4px;"><span>${escapeHtml(h)}</span><i class="fa" style="font-size: 9px; opacity: 0.6;">&#xf0dc;</i></span></th>`).join('')}
          </tr>
        </thead>
        <tbody id="csv-grid-tbody">
        </tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector('#csv-grid-tbody');
  const filterInput = container.querySelector('#csv-grid-filter');
  let currentRows = rawRows;

  function renderTableRows(rows) {
    if (!tbody) return;
    const maxRender = 1000;
    const slice = rows.slice(0, maxRender);
    let html = '';
    slice.forEach((r, idx) => {
      html += `<tr><td style="text-align: center; color: var(--text-subtle); background: var(--bg-dock);">${idx + 1}</td>${r.map(c => `<td title="${escapeHtml(c)}">${escapeHtml(c)}</td>`).join('')}</tr>`;
    });
    if (rows.length > maxRender) {
      html += `<tr><td colspan="${headers.length + 1}" style="text-align: center; padding: 10px; color: var(--text-subtle);">... showing first ${maxRender} of ${rows.length} rows ...</td></tr>`;
    }
    tbody.innerHTML = html;
  }

  renderTableRows(currentRows);

  if (filterInput) {
    filterInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        renderTableRows(currentRows);
      } else {
        const filtered = currentRows.filter(r => r.some(cell => cell.toLowerCase().includes(q)));
        renderTableRows(filtered);
      }
    });
  }

  let sortCol = -1;
  let sortAsc = true;
  container.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const colIdx = parseInt(th.getAttribute('data-col'));
      if (sortCol === colIdx) {
        sortAsc = !sortAsc;
      } else {
        sortCol = colIdx;
        sortAsc = true;
      }
      currentRows.sort((a, b) => {
        const vA = a[colIdx] || '';
        const vB = b[colIdx] || '';
        const nA = parseFloat(vA);
        const nB = parseFloat(vB);
        if (!isNaN(nA) && !isNaN(nB)) {
          return sortAsc ? nA - nB : nB - nA;
        }
        return sortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
      });
      renderTableRows(currentRows);
    });
  });
}
