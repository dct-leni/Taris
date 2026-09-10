// ── Unified Mesh VPN & Cloud Providers ──

// ── State for Mesh VPN ──
let editingMeshId = null;
let editingMeshType = 'wireguard';
let activeMeshSessionCache = null;
let wgStatusesCache = [];
let tsStatusCache = null;
let nbStatusCache = null;

// ── State for Cloud Providers (Held strictly in JS memory for current connected provider) ──
let currentCloudProvider = 'gcp';
let cloudDataCache = {
  provider: 'gcp',
  auth: null,
  projects: null, // null = not loaded yet; [] = loaded empty
  instances: {}, // { [projectId]: Array<CloudInstance> }
  expandedProjects: new Set(),
  selectedProjectId: null,
  loadingProjects: false,
  loadingInstances: {},
  authError: null,
  lastPollTimestamp: 0,
};
let cloudPollInterval = null;

function clearCloudCache(newProvider) {
  currentCloudProvider = newProvider;
  cloudDataCache = {
    provider: newProvider,
    auth: null,
    projects: null,
    instances: {},
    expandedProjects: new Set(),
    selectedProjectId: null,
    loadingProjects: false,
    loadingInstances: {},
    authError: null,
    lastPollTimestamp: 0,
  };
}

async function saveConfig() {
  await invoke('save_config', { config: appConfig });
}

function updateMeshTypeFields(selectedType) {
  const meshFormType = document.getElementById('mesh-form-type');
  const type = selectedType || (meshFormType ? meshFormType.value : 'wireguard');
  const fieldsWg = document.getElementById('mesh-fields-wireguard');
  const fieldsTs = document.getElementById('mesh-fields-tailscale');
  const fieldsNb = document.getElementById('mesh-fields-netbird');

  if (fieldsWg) {
    fieldsWg.classList.toggle('hidden', type !== 'wireguard');
    fieldsWg.style.display = type === 'wireguard' ? 'block' : 'none';
  }
  if (fieldsTs) {
    fieldsTs.classList.toggle('hidden', type !== 'tailscale');
    fieldsTs.style.display = type === 'tailscale' ? 'block' : 'none';
  }
  if (fieldsNb) {
    fieldsNb.classList.toggle('hidden', type !== 'netbird');
    fieldsNb.style.display = type === 'netbird' ? 'block' : 'none';
  }
}

function resetMeshKeyToggles() {
  const tsAuthKey = document.getElementById('ts-form-auth-key');
  const tsApiToken = document.getElementById('ts-form-api-token');
  const nbToken = document.getElementById('nb-form-token') || document.getElementById('nb-form-setup-key');
  const btnToggleTs = document.getElementById('btn-toggle-ts-key');
  const btnToggleTsApi = document.getElementById('btn-toggle-ts-api-token');
  const btnToggleNb = document.getElementById('btn-toggle-nb-key');

  if (tsAuthKey) tsAuthKey.type = 'password';
  if (tsApiToken) tsApiToken.type = 'password';
  if (nbToken) nbToken.type = 'password';
  if (btnToggleTs) {
    btnToggleTs.innerHTML = '<i class="fa">&#xf06e;</i>';
    btnToggleTs.title = 'Show Key';
  }
  if (btnToggleTsApi) {
    btnToggleTsApi.innerHTML = '<i class="fa">&#xf06e;</i>';
    btnToggleTsApi.title = 'Show Token';
  }
  if (btnToggleNb) {
    btnToggleNb.innerHTML = '<i class="fa">&#xf06e;</i>';
    btnToggleNb.title = 'Show Token';
  }
}

function setupMeshDrawer() {
  const meshAddBtn = document.getElementById('mesh-add-btn') || document.getElementById('wg-add-btn');
  const meshRefreshBtn = document.getElementById('mesh-refresh-btn') || document.getElementById('wg-refresh-btn');
  const meshSearchInput = document.getElementById('mesh-search-input') || document.getElementById('wg-search-input');

  const modalMesh = document.getElementById('modal-add-mesh') || document.getElementById('modal-add-wireguard');
  const modalMeshClose = document.getElementById('modal-mesh-close') || document.getElementById('modal-wg-close');
  const modalMeshCancel = document.getElementById('modal-mesh-cancel') || document.getElementById('modal-wg-cancel');
  const modalMeshSubmit = document.getElementById('modal-mesh-submit') || document.getElementById('modal-wg-submit');

  const meshFormType = document.getElementById('mesh-form-type');
  const meshFormName = document.getElementById('mesh-form-name') || document.getElementById('wg-form-name');
  const meshFormAutoconnect = document.getElementById('mesh-form-autoconnect') || document.getElementById('wg-form-autoconnect');

  const fieldsWg = document.getElementById('mesh-fields-wireguard');
  const fieldsTs = document.getElementById('mesh-fields-tailscale');
  const fieldsNb = document.getElementById('mesh-fields-netbird');

  const wgBrowseBtn = document.getElementById('wg-form-browse-btn');
  const wgCopyBtn = document.getElementById('wg-form-copy-btn');
  const wgConfText = document.getElementById('wg-form-conf');

  const tsApiToken = document.getElementById('ts-form-api-token');
  const btnToggleTsApi = document.getElementById('btn-toggle-ts-api-token');
  const tsAuthKey = document.getElementById('ts-form-auth-key');
  const tsControlUrl = document.getElementById('ts-form-control-url');
  const tsHostname = document.getElementById('ts-form-hostname');
  const tsExitNode = document.getElementById('ts-form-exit-node');
  const tsSocks5Port = document.getElementById('ts-form-socks5-port');
  const tsInstallLink = document.getElementById('ts-install-link');
  const btnToggleTs = document.getElementById('btn-toggle-ts-key');

  const nbToken = document.getElementById('nb-form-token') || document.getElementById('nb-form-setup-key');
  const nbMgmtUrl = document.getElementById('nb-form-mgmt-url');
  const nbSocks5Port = document.getElementById('nb-form-socks5-port');
  const nbExitNode = document.getElementById('nb-form-exit-node');
  const nbInstallLink = document.getElementById('nb-install-link');
  const btnToggleNb = document.getElementById('btn-toggle-nb-key');

  if (tsInstallLink) {
    tsInstallLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await invoke('open_mesh_auth_portal', { provider: 'tailscale', pageType: 'install' });
      } catch (err) {
        showToast(`Failed to open link: ${err}`, 'error');
      }
    });
  }

  if (nbInstallLink) {
    nbInstallLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await invoke('open_mesh_auth_portal', { provider: 'netbird', pageType: 'install' });
      } catch (err) {
        showToast(`Failed to open link: ${err}`, 'error');
      }
    });
  }

  if (meshFormType) {
    meshFormType.addEventListener('change', () => updateMeshTypeFields());
  }

  // Key Visibility Toggle Handlers
  if (btnToggleTsApi && tsApiToken) {
    btnToggleTsApi.addEventListener('click', () => {
      const isPwd = tsApiToken.type === 'password';
      tsApiToken.type = isPwd ? 'text' : 'password';
      btnToggleTsApi.innerHTML = `<i class="fa">${isPwd ? '&#xf070;' : '&#xf06e;'}</i>`;
      btnToggleTsApi.title = isPwd ? 'Hide Token' : 'Show Token';
    });
  }

  if (btnToggleTs && tsAuthKey) {
    btnToggleTs.addEventListener('click', () => {
      const isPwd = tsAuthKey.type === 'password';
      tsAuthKey.type = isPwd ? 'text' : 'password';
      btnToggleTs.innerHTML = `<i class="fa">${isPwd ? '&#xf070;' : '&#xf06e;'}</i>`;
      btnToggleTs.title = isPwd ? 'Hide Key' : 'Show Key';
    });
  }

  if (btnToggleNb && nbToken) {
    btnToggleNb.addEventListener('click', () => {
      const isPwd = nbToken.type === 'password';
      nbToken.type = isPwd ? 'text' : 'password';
      btnToggleNb.innerHTML = `<i class="fa">${isPwd ? '&#xf070;' : '&#xf06e;'}</i>`;
      btnToggleNb.title = isPwd ? 'Hide Token' : 'Show Token';
    });
  }

  if (wgCopyBtn && wgConfText) {
    wgCopyBtn.addEventListener('click', async () => {
      const val = wgConfText.value.trim();
      if (!val) {
        showToast('No WireGuard configuration to copy', 'warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(val);
        showToast('✓ WireGuard configuration copied to clipboard', 'success');
      } catch (err) {
        showToast(`Copy failed: ${err}`, 'error');
      }
    });
  }

  // ── Browser Authentication Portal Handlers ──
  const btnTsBrowserAuth = document.getElementById('btn-ts-browser-auth');
  const btnNbBrowserToken = document.getElementById('btn-nb-browser-token') || document.getElementById('btn-nb-browser-setup');

  if (btnTsBrowserAuth) {
    btnTsBrowserAuth.addEventListener('click', async () => {
      try {
        const controlUrl = (tsControlUrl ? tsControlUrl.value : '').trim() || null;
        await invoke('open_mesh_auth_portal', {
          provider: 'tailscale',
          baseUrl: controlUrl,
          pageType: 'keys'
        });
        showToast('✓ Opened Tailscale Admin Console in browser', 'info');
        tsApiToken ? tsApiToken.focus() : tsAuthKey?.focus();
      } catch (err) {
        showToast(`Failed to open browser: ${err}`, 'error');
      }
    });
  }

  if (btnNbBrowserToken) {
    btnNbBrowserToken.addEventListener('click', async () => {
      try {
        const mgmtUrl = (nbMgmtUrl ? nbMgmtUrl.value : '').trim() || 'https://api.netbird.io';
        await invoke('open_mesh_auth_portal', {
          provider: 'netbird',
          baseUrl: mgmtUrl,
          pageType: 'team-users'
        });
        showToast('✓ Opened NetBird (Team > Users). Click your profile > Access Tokens', 'info');
        nbToken?.focus();
      } catch (err) {
        showToast(`Failed to open browser: ${err}`, 'error');
      }
    });
  }

  if (meshAddBtn) {
    meshAddBtn.addEventListener('click', () => {
      editingMeshId = null;
      editingMeshType = 'wireguard';
      const titleEl = document.getElementById('modal-mesh-title') || document.getElementById('modal-wg-title');
      if (titleEl) {
        titleEl.innerHTML = '<i class="fa" style="color: #98c379; margin-right: 6px;">&#xf3ed;</i> Add Mesh VPN Network';
      }
      if (meshFormType) {
        meshFormType.value = 'wireguard';
        meshFormType.disabled = false;
      }
      if (meshFormName) meshFormName.value = '';
      if (wgConfText) wgConfText.value = '';
      if (tsApiToken) {
        tsApiToken.value = '';
        tsApiToken.placeholder = 'tskey-api-... (Personal Access Token)';
      }
      if (tsAuthKey) {
        tsAuthKey.value = '';
        tsAuthKey.placeholder = 'tskey-auth-... (Auth Key)';
      }
      if (tsControlUrl) tsControlUrl.value = '';
      if (tsHostname) tsHostname.value = '';
      if (tsExitNode) tsExitNode.value = '';
      if (tsSocks5Port) tsSocks5Port.value = '';
      if (nbToken) {
        nbToken.value = '';
        nbToken.placeholder = 'nbp_xxxxxxxxxxxxxxxxxxxx';
      }
      if (nbMgmtUrl) nbMgmtUrl.value = 'https://api.netbird.io';
      if (nbSocks5Port) nbSocks5Port.value = '';
      if (nbExitNode) nbExitNode.value = '';
      if (meshFormAutoconnect) meshFormAutoconnect.checked = false;
      resetMeshKeyToggles();
      updateMeshTypeFields('wireguard');
      if (modalMesh) modalMesh.classList.remove('hidden');
    });
  }

  if (modalMeshClose) modalMeshClose.addEventListener('click', () => modalMesh?.classList.add('hidden'));
  if (modalMeshCancel) modalMeshCancel.addEventListener('click', () => modalMesh?.classList.add('hidden'));

  if (wgBrowseBtn) {
    wgBrowseBtn.addEventListener('click', async () => {
      try {
        const content = await invoke('pick_wireguard_conf_file');
        if (content && typeof content === 'string') {
          if (wgConfText) wgConfText.value = content;
          try {
            const parsed = await invoke('parse_wireguard_config_text', { text: content });
            if (parsed && parsed.name && (!meshFormName.value || meshFormName.value.trim() === '')) {
              meshFormName.value = parsed.name;
            }
          } catch (_) {}
          showToast('✓ WireGuard configuration imported', 'success');
        }
      } catch (err) {
        showToast(`Failed to pick file: ${err}`, 'error');
      }
    });
  }

  if (modalMeshSubmit) {
    modalMeshSubmit.addEventListener('click', async () => {
      const type = meshFormType ? meshFormType.value : 'wireguard';
      const name = (meshFormName ? meshFormName.value : '').trim();

      if (!name) {
        showToast('Please enter a network or profile name', 'error');
        return;
      }

      if (type === 'wireguard') {
        const conf = (wgConfText ? wgConfText.value : '').trim();
        if (!conf) {
          showToast('Please enter or import a WireGuard configuration', 'error');
          return;
        }
        try {
          const parsed = await invoke('parse_wireguard_config_text', { text: conf });
          parsed.id = editingMeshId || ('wg-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4));
          parsed.name = name;
          parsed.auto_connect = meshFormAutoconnect ? meshFormAutoconnect.checked : false;

          if (!appConfig.wireguard_profiles) appConfig.wireguard_profiles = [];
          const existingIdx = appConfig.wireguard_profiles.findIndex((p) => p.id === parsed.id);
          if (existingIdx >= 0) {
            appConfig.wireguard_profiles[existingIdx] = parsed;
          } else {
            appConfig.wireguard_profiles.push(parsed);
          }

          await saveConfig();
          if (modalMesh) modalMesh.classList.add('hidden');
          showToast(`✓ WireGuard profile '${name}' saved`, 'success');

          if (parsed.auto_connect) {
            try {
              await invoke('toggle_wireguard_profile_session', { profile: parsed, active: true });
            } catch (connErr) {
              console.warn('Auto-connect error:', connErr);
            }
          }
          renderUnifiedMeshDrawer();
        } catch (err) {
          showToast(`Invalid WireGuard configuration: ${err}`, 'error');
        }
      } else if (type === 'tailscale') {
        const wasActive = !!activeMeshSessionCache?.tailscale;
        const apiTokenInput = (tsApiToken?.value.trim()) || '';
        const authKeyInput = (tsAuthKey?.value.trim()) || '';
        const hasExisting = appConfig.tailscale?.auth_key || appConfig.tailscale?.api_token;
        if (!apiTokenInput && !authKeyInput && !editingMeshId && !hasExisting) {
          showToast('Please enter an API Token (for exit nodes) or Auth Key', 'error');
          tsApiToken ? tsApiToken.focus() : tsAuthKey?.focus();
          return;
        }
        if (!appConfig.tailscale) {
          appConfig.tailscale = { enabled: true, auth_key: null, api_token: null, control_url: null, hostname: null, socks5_port: 1055 };
        }
        appConfig.tailscale.name = name;
        appConfig.tailscale.enabled = true;

        if (apiTokenInput.startsWith('tskey-auth-') && !authKeyInput) {
          appConfig.tailscale.auth_key = apiTokenInput;
        } else if (apiTokenInput) {
          appConfig.tailscale.api_token = apiTokenInput;
        }

        if (authKeyInput.startsWith('tskey-api-') && !apiTokenInput) {
          appConfig.tailscale.api_token = authKeyInput;
        } else if (authKeyInput) {
          appConfig.tailscale.auth_key = authKeyInput;
        }

        appConfig.tailscale.control_url = (tsControlUrl?.value.trim()) || null;
        appConfig.tailscale.hostname = (tsHostname?.value.trim()) || null;
        appConfig.tailscale.exit_node = (tsExitNode?.value.trim()) || null;
        const tsSocks5Val = parseInt(tsSocks5Port?.value, 10);
        appConfig.tailscale.socks5_port = !isNaN(tsSocks5Val) && tsSocks5Val > 0 ? tsSocks5Val : null;
        await saveConfig();
        if (modalMesh) modalMesh.classList.add('hidden');
        if (wasActive) {
          try {
            await invoke('toggle_tailscale_session', { config: appConfig.tailscale, active: true, enabled: true });
            showToast(`✓ Tailscale settings updated and reconnected`, 'success');
          } catch (err) {
            showToast(`Tailscale settings saved (reconnect warning: ${err})`, 'warning');
          }
        } else {
          showToast(`✓ Tailscale settings '${name}' saved`, 'success');
        }
        renderUnifiedMeshDrawer();
      } else if (type === 'netbird') {
        const wasActive = !!activeMeshSessionCache?.netbird;
        const tokenInput = (nbToken?.value.trim()) || '';
        if (!tokenInput && !editingMeshId) {
          showToast('Please enter a NetBird Personal Access Token', 'error');
          nbToken?.focus();
          return;
        }
        if (!appConfig.netbird) {
          appConfig.netbird = { enabled: true, management_url: 'https://api.netbird.io', personal_access_token: null, forward_port: 1056 };
        }
        appConfig.netbird.name = name;
        appConfig.netbird.enabled = true;
        appConfig.netbird.management_url = (nbMgmtUrl?.value.trim()) || 'https://api.netbird.io';
        if (tokenInput) {
          appConfig.netbird.personal_access_token = tokenInput;
        }
        appConfig.netbird.exit_node = (nbExitNode?.value.trim()) || null;
        const nbSocks5Val = parseInt(nbSocks5Port?.value, 10);
        appConfig.netbird.socks5_port = !isNaN(nbSocks5Val) && nbSocks5Val > 0 ? nbSocks5Val : null;
        delete appConfig.netbird.setup_key;
        await saveConfig();
        if (modalMesh) modalMesh.classList.add('hidden');
        if (wasActive) {
          try {
            await invoke('toggle_netbird_session', { config: appConfig.netbird, active: true, enabled: true });
            showToast(`✓ NetBird settings updated and reconnected`, 'success');
          } catch (err) {
            showToast(`NetBird settings saved (reconnect warning: ${err})`, 'warning');
          }
        } else {
          showToast(`✓ NetBird settings '${name}' saved`, 'success');
        }
        renderUnifiedMeshDrawer();
      }
    });
  }

  if (meshRefreshBtn) {
    meshRefreshBtn.addEventListener('click', () => renderUnifiedMeshDrawer());
  }

  if (meshSearchInput) {
    meshSearchInput.addEventListener('input', () => renderUnifiedMeshCards());
  }
}

async function renderUnifiedMeshDrawer() {
  const profiles = appConfig.wireguard_profiles || [];

  try {
    const [activeSessionsRes, wgStatuses, tsStatus, nbStatus] = await Promise.allSettled([
      invoke('get_active_mesh_sessions'),
      invoke('get_wireguard_runtime_statuses', { profiles }),
      appConfig.tailscale && appConfig.tailscale.enabled
        ? invoke('get_tailscale_runtime_status', { config: appConfig.tailscale })
        : Promise.resolve(null),
      appConfig.netbird && appConfig.netbird.enabled
        ? invoke('get_netbird_runtime_status', { config: appConfig.netbird })
        : Promise.resolve(null),
    ]);

    activeMeshSessionCache = activeSessionsRes.status === 'fulfilled' ? activeSessionsRes.value : null;
    wgStatusesCache = wgStatuses.status === 'fulfilled' ? wgStatuses.value : [];
    tsStatusCache = tsStatus.status === 'fulfilled' ? tsStatus.value : null;
    nbStatusCache = nbStatus.status === 'fulfilled' ? nbStatus.value : null;
  } catch (err) {
    console.warn('Failed to query some mesh statuses:', err);
  }

  renderUnifiedMeshCards();
}

function renderUnifiedMeshCards() {
  const listEl = document.getElementById('mesh-cards-list') || document.getElementById('wg-profiles-list');
  const activePill = document.getElementById('mesh-active-pill') || document.getElementById('wg-profiles-count');
  const searchInput = document.getElementById('mesh-search-input') || document.getElementById('wg-search-input');
  if (!listEl) return;

  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();

  const activeNames = [];
  if (activeMeshSessionCache?.tailscale) {
    activeNames.push(appConfig.tailscale?.name || 'Tailscale');
  }
  if (activeMeshSessionCache?.netbird) {
    activeNames.push(appConfig.netbird?.name || 'NetBird');
  }
  if (Array.isArray(activeMeshSessionCache?.wireguard)) {
    for (const wid of activeMeshSessionCache.wireguard) {
      const p = (appConfig.wireguard_profiles || []).find((x) => x.id === wid);
      activeNames.push(p ? p.name : 'WireGuard');
    }
  }

  let activeTitle = 'Disconnected';
  let activeState = 'offline';
  if (activeNames.length > 0) {
    activeTitle = `Active: ${activeNames.join(' + ')}`;
    activeState = 'online';
  }

  if (activePill) {
    activePill.textContent = activeTitle;
    activePill.className = `status-pill ${activeState}`;
    if (activeState === 'online') {
      activePill.style.color = 'var(--green)';
    } else if (activeState === 'error') {
      activePill.style.color = '#e06c75';
    } else {
      activePill.style.color = 'var(--text-subtle)';
    }
  }

  const unifiedItems = [];

  // 1. WireGuard profiles
  (appConfig.wireguard_profiles || []).forEach((p) => {
    const status = wgStatusesCache.find((s) => s.profile_id === p.id);
    const isThisActive = Array.isArray(activeMeshSessionCache?.wireguard) && activeMeshSessionCache.wireguard.includes(p.id);
    const hasError = status?.error || null;
    const isWorking = isThisActive && !hasError;

    let subline = 'Pure user-space BoringTun tunnel';
    if (status?.active) {
      if (status.last_handshake_secs !== null && status.last_handshake_secs !== undefined) {
        subline = `Traffic: ↓ ${formatTunnelBytes(status.bytes_rx)} · ↑ ${formatTunnelBytes(status.bytes_tx)} · Handshake: ${status.last_handshake_secs}s ago`;
      } else if (!hasError) {
        subline = 'Connecting... (waiting for peer handshake)';
      }
    }

    unifiedItems.push({
      id: p.id,
      type: 'wireguard',
      name: p.name,
      isActive: isThisActive,
      isWorking: isWorking,
      error: hasError,
      raw: p,
      status: status || { active: false, bytes_rx: 0, bytes_tx: 0 },
      detailsLine1: `Address: ${p.interface_address || '10.0.0.x'} · Peer: ${p.peer_endpoint || 'P2P'}`,
      detailsLine2: subline,
    });
  });

  // 2. Tailscale (DO NOT add any demo/examples - only if explicitly configured and enabled)
  if (appConfig.tailscale && appConfig.tailscale.enabled) {
    const isThisActive = !!activeMeshSessionCache?.tailscale;
    const isRunning = tsStatusCache && (tsStatusCache.backend_state === 'Running' || tsStatusCache.backend_state === 'Connected (Native)');
    const hasError = tsStatusCache?.error || (isThisActive && tsStatusCache && !isRunning ? `Tailscale state: ${tsStatusCache.backend_state}` : null);
    const isWorking = isThisActive && isRunning && !hasError;
    const selfIp = tsStatusCache?.self_ip || (appConfig.tailscale.hostname ? `${appConfig.tailscale.hostname}.ts.net` : 'MagicDNS');
    const peersCount = tsStatusCache?.peers?.length || 0;
    const keyPreview = appConfig.tailscale.api_token
      ? `API Token: ${appConfig.tailscale.api_token.slice(0, 10)}••••••••`
      : (appConfig.tailscale.auth_key ? `Key: ${appConfig.tailscale.auth_key.slice(0, 10)}••••••••` : (appConfig.tailscale.control_url || 'https://controlplane.tailscale.com'));

    unifiedItems.push({
      id: 'tailscale-singleton',
      type: 'tailscale',
      name: appConfig.tailscale.name || 'Tailscale',
      isActive: isThisActive,
      isWorking: isWorking,
      error: hasError,
      raw: appConfig.tailscale,
      status: isThisActive ? tsStatusCache : null,
      detailsLine1: isThisActive ? `Connected · Self: ${selfIp} · Peers: ${peersCount} online` : `Status: Disconnected · ${selfIp}`,
      detailsLine2: keyPreview,
    });
  }

  // 3. NetBird (DO NOT add any demo/examples - only if explicitly configured and enabled)
  if (appConfig.netbird && appConfig.netbird.enabled) {
    const isThisActive = !!activeMeshSessionCache?.netbird;
    const hasError = nbStatusCache?.error || (nbStatusCache && !nbStatusCache.connected && isThisActive ? 'NetBird management server disconnected' : null);
    const isWorking = isThisActive && nbStatusCache?.connected && !hasError;
    const mgmt = appConfig.netbird.management_url || 'https://api.netbird.io';
    const nbPeersCount = nbStatusCache?.peers?.length || 0;
    const token = appConfig.netbird.personal_access_token || appConfig.netbird.setup_key;
    const keyPreview = token
      ? `Token: ${token.slice(0, 8)}•••••••• · Management API`
      : 'Management API (Cloud/Self-Hosted)';

    const nbStatusObj = isThisActive && nbStatusCache ? {
      ...nbStatusCache,
      hint: nbStatusCache.hint || (appConfig.netbird.socks5_port ? `Routing via local SOCKS5 proxy (port ${appConfig.netbird.socks5_port})` : 'Peers synced via Management API. Overlay traffic routes via official NetBird client.')
    } : null;

    unifiedItems.push({
      id: 'netbird-singleton',
      type: 'netbird',
      name: appConfig.netbird.name || 'NetBird',
      isActive: isThisActive,
      isWorking: isWorking,
      error: hasError,
      raw: appConfig.netbird,
      status: nbStatusObj,
      detailsLine1: isThisActive ? `Connected · Server: ${mgmt.replace('https://', '')} · Peers: ${nbPeersCount} online` : `Status: Disconnected · ${mgmt.replace('https://', '')}`,
      detailsLine2: keyPreview,
    });
  }

  let filtered = unifiedItems;
  if (query) {
    filtered = unifiedItems.filter((it) => {
      return it.name.toLowerCase().includes(query) ||
        it.type.toLowerCase().includes(query) ||
        it.detailsLine1.toLowerCase().includes(query) ||
        it.detailsLine2.toLowerCase().includes(query) ||
        (it.error && it.error.toLowerCase().includes(query));
    });
  }

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
        <i class="fa" style="font-size: 28px; color: var(--border-color); margin-bottom: 8px; display: block;">&#xf3ed;</i>
        ${query ? 'No matching networks found.' : 'No Mesh VPN networks added yet.<br>Click <b>+</b> above to add a WireGuard, Tailscale, or NetBird network.'}
      </div>
    `;
    return;
  }

  listEl.innerHTML = '';
  filtered.forEach((it) => {
    const card = document.createElement('div');
    const dotClass = it.error ? 'error' : (it.isWorking ? 'online' : (it.isActive ? 'online' : 'offline'));
    const cardClass = it.error ? 'mesh-network-card error' : (it.isActive ? 'mesh-network-card active' : 'mesh-network-card');

    card.className = cardClass;

    const typeBadgeClass = it.type === 'wireguard' ? 'wireguard' : (it.type === 'tailscale' ? 'tailscale' : 'netbird');
    const typeLabel = it.type === 'wireguard' ? 'WireGuard' : (it.type === 'tailscale' ? 'Tailscale' : 'NetBird');

    card.innerHTML = `
      <div class="mesh-card-header">
        <div class="mesh-card-title-box">
          <span class="status-dot ${dotClass}" style="width: 7px; height: 7px;"></span>
          <span class="mesh-type-badge ${typeBadgeClass}">${typeLabel}</span>
          <span class="mesh-card-name" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</span>
        </div>
        <div class="mesh-card-actions">
          ${it.type === 'wireguard' ? `
            <button class="mesh-action-icon-btn btn-mesh-export" title="Export .conf">
              <i class="fa">&#xf019;</i>
            </button>
          ` : ''}
          <button class="mesh-action-icon-btn btn-mesh-edit" title="Edit ${typeLabel} Network">
            <i class="fa">&#xf044;</i>
          </button>
          <button class="mesh-action-icon-btn btn-mesh-delete" title="Remove ${typeLabel} Network">
            <i class="fa">&#xf1f8;</i>
          </button>
        </div>
      </div>

      <div class="mesh-card-body">
        <div class="mesh-endpoint-line">${escapeHtml(it.detailsLine1)}</div>
        <div class="mesh-sub-line">${escapeHtml(it.detailsLine2)}</div>
        ${it.status?.setup_key_info ? `
          <div style="font-size: 10px; color: var(--accent); margin-top: 2px;">
            <i class="fa" style="margin-right: 3px;">&#xf084;</i> Setup Key: <b>${escapeHtml(it.status.setup_key_info.name)}</b> (Group: ${escapeHtml(it.status.setup_key_info.auto_groups.join(', ') || 'Client')})
          </div>
        ` : ''}
        ${it.error ? `
          <div class="mesh-card-error-banner">
            <i class="fa" style="margin-top: 1px; flex-shrink: 0;">&#xf071;</i>
            <span>${escapeHtml(it.error)}</span>
          </div>
        ` : ''}

        ${(it.type === 'tailscale' || it.type === 'netbird') ? `
          <div class="mesh-exit-node-banner" style="margin: 8px 0; padding: 6px 8px; background: rgba(0,0,0,0.22); border-radius: 4px; border: 1px solid var(--border-color); width: 100%; box-sizing: border-box; min-width: 0; overflow: hidden;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; width: 100%; min-width: 0;">
              <span style="font-size: 10px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1;">
                <i class="fa" style="color: var(--accent); margin-right: 4px;">&#xf126;</i> Default Exit Node / Gateway Peer
              </span>
              ${it.isActive 
                ? '<span style="font-size: 9px; color: var(--green); flex-shrink: 0; margin-left: 6px;">● Active</span>' 
                : '<span style="font-size: 9px; color: var(--text-subtle); flex-shrink: 0; margin-left: 6px;">○ Not Connected</span>'}
            </div>
            <select class="mesh-exit-node-select modal-input" data-mesh-type="${it.type}" style="width: 100%; max-width: 100%; min-width: 0; height: 24px; font-size: 10.5px; padding: 0 6px; box-sizing: border-box; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; display: block;">
              <option value="">Default (Direct Mesh Routing)</option>
              ${(() => {
                const currentExitNode = (it.type === 'netbird' ? appConfig.netbird?.exit_node : appConfig.tailscale?.exit_node) || '';
                const options = [];
                const addedValues = new Set(['']);

                if (currentExitNode) {
                  options.push({ value: currentExitNode, label: `Configured: ${currentExitNode}`, selected: true });
                  addedValues.add(currentExitNode);
                }

                // Show peers discovered on this specific mesh
                if (Array.isArray(it.status?.peers)) {
                  it.status.peers.forEach((peer) => {
                    const peerIp = peer.ip || (peer.tailscale_ips && peer.tailscale_ips[0]) || '';
                    if (!peerIp || addedValues.has(peerIp)) return;
                    const peerName = peer.name || peer.hostname || 'Peer';
                    const isExit = peer.is_exit_node || false;
                    options.push({
                      value: peerIp,
                      label: `${peerName} (${peerIp})${isExit ? ' ★ Exit Node' : ''}`,
                      selected: currentExitNode === peerIp,
                    });
                    addedValues.add(peerIp);
                  });
                }

                let html = options.map((o) => `<option value="${escapeHtml(o.value)}" ${o.selected ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
                html += `<option value="__custom__">+ Enter Custom Exit Node...</option>`;
                return html;
              })()}
            </select>
            ${it.status?.hint ? `
              <div style="font-size: 9.5px; color: var(--text-subtle); margin-top: 5px; line-height: 1.35; padding: 4px 7px; background: rgba(229, 192, 123, 0.08); border-radius: 3px; border-left: 2px solid var(--accent);">
                <i class="fa" style="color: var(--accent); margin-right: 3px;">&#xf05a;</i>
                ${escapeHtml(it.status.hint)}
              </div>
            ` : ''}
          </div>
        ` : ''}

        ${(it.isActive && it.status?.peers && it.status.peers.length > 0) ? `
          <div class="mesh-peers-wrapper">
            <div class="mesh-peers-header">
              <span>Peers (${it.status.peers.filter(p => p.status === 'connected' || p.online).length}/${it.status.peers.length} Online)</span>
            </div>
            <div class="mesh-peers-list">
              ${it.status.peers.map((peer) => {
                const isOnline = peer.status === 'connected' || peer.online;
                const peerIp = peer.ip || (peer.tailscale_ips && peer.tailscale_ips[0]) || '';
                const peerName = peer.name || peer.hostname || 'Peer';
                const osIcon = getOsIconClass(peer.os);
                return `
                  <div class="mesh-peer-row">
                    <div class="mesh-peer-info">
                      <span class="status-dot ${isOnline ? 'online' : 'offline'}" style="width: 6px; height: 6px; flex-shrink: 0;"></span>
                      <i class="fa ${osIcon}" style="font-size: 11px; color: var(--text-subtle); width: 14px; text-align: center; flex-shrink: 0;"></i>
                      <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <span style="font-weight: 500; color: var(--text-main);">${escapeHtml(peerName)}</span>
                        <span class="mono" style="font-size: 10px; color: var(--text-subtle); margin-left: 4px;">${escapeHtml(peerIp)}</span>
                      </div>
                    </div>
                    <div class="mesh-peer-actions">
                      <button type="button" class="mesh-peer-btn btn-peer-ssh" data-ip="${escapeHtml(peerIp)}" data-name="${escapeHtml(peerName)}" data-route="${it.type}" title="Open SSH terminal to ${escapeHtml(peerName)} (${escapeHtml(peerIp)})">
                        <i class="fa">&#xf120;</i> SSH
                      </button>
                      <button type="button" class="mesh-peer-btn btn-peer-copy" data-ip="${escapeHtml(peerIp)}" title="Copy IP ${escapeHtml(peerIp)}" style="padding: 0 6px;">
                        <i class="fa">&#xf0c5;</i>
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="mesh-card-footer">
        <button class="mesh-connect-btn ${it.isActive ? 'connected' : ''}">
          <i class="fa ${it.isActive ? 'fa-power-off' : 'fa-play'}" style="margin-right: 5px;"></i>
          ${it.isActive ? 'Disconnect' : 'Connect'}
        </button>
      </div>
    `;

    card.querySelectorAll('.btn-peer-ssh').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ip = btn.getAttribute('data-ip');
        const name = btn.getAttribute('data-name');
        const route = btn.getAttribute('data-route');
        connectToMeshPeer({ name, host: ip, route });
      });
    });

    card.querySelectorAll('.btn-peer-copy').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const ip = btn.getAttribute('data-ip');
        if (ip) {
          setSystemClipboardText(ip);
          showToast(`✓ Copied peer IP ${ip}`, 'info');
        }
      });
    });

    const exitNodeSel = card.querySelector('.mesh-exit-node-select');
    if (exitNodeSel) {
      exitNodeSel.addEventListener('change', async (e) => {
        const val = e.target.value;
        const meshType = exitNodeSel.getAttribute('data-mesh-type');
        if (val === '__custom__') {
          const custom = prompt(`Enter ${meshType === 'tailscale' ? 'Tailscale' : 'NetBird'} Exit Node IP or hostname (e.g. 100.64.0.1):`, '');
          if (custom && custom.trim()) {
            const trimmed = custom.trim();
            if (meshType === 'netbird' && appConfig.netbird) {
              appConfig.netbird.exit_node = trimmed;
            } else if (meshType === 'tailscale' && appConfig.tailscale) {
              appConfig.tailscale.exit_node = trimmed;
            }
            persistConfig(true);
            renderUnifiedMeshCards();
            showToast(`${meshType === 'tailscale' ? 'Tailscale' : 'NetBird'} exit node set to: ${trimmed}`, 'success');
          } else {
            renderUnifiedMeshCards();
          }
          return;
        }

        if (meshType === 'netbird' && appConfig.netbird) {
          appConfig.netbird.exit_node = val || null;
          persistConfig(true);
          if (it.isActive) {
            invoke('toggle_netbird_session', { config: appConfig.netbird, active: true, enabled: true }).catch(() => {});
          }
          showToast(`NetBird exit node set to: ${val || 'Default'}`, 'info');
        } else if (meshType === 'tailscale' && appConfig.tailscale) {
          appConfig.tailscale.exit_node = val || null;
          persistConfig(true);
          if (it.isActive) {
            invoke('toggle_tailscale_session', { config: appConfig.tailscale, active: true, enabled: true }).catch(() => {});
          }
          showToast(`Tailscale exit node set to: ${val || 'Default'}`, 'info');
        }
      });
    }

    const connectBtn = card.querySelector('.mesh-connect-btn');
    if (connectBtn) {
      connectBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        connectBtn.disabled = true;
        const origHtml = connectBtn.innerHTML;
        connectBtn.innerHTML = '<i class="fa fa-spinner fa-spin" style="margin-right: 5px;"></i> Verifying...';

        try {
          if (it.isActive) {
            if (it.type === 'wireguard') {
              await invoke('toggle_wireguard_profile_session', { profile: it.raw, active: false });
            } else if (it.type === 'tailscale') {
              await invoke('toggle_tailscale_session', { config: appConfig.tailscale, active: false, enabled: false });
            } else if (it.type === 'netbird') {
              await invoke('toggle_netbird_session', { config: appConfig.netbird, active: false, enabled: false });
            }
            showToast(`${typeLabel} disconnected`, 'info');
          } else {
            if (it.type === 'wireguard') {
              await invoke('toggle_wireguard_profile_session', { profile: it.raw, active: true });
            } else if (it.type === 'tailscale') {
              await invoke('toggle_tailscale_session', { config: appConfig.tailscale, active: true, enabled: true });
            } else if (it.type === 'netbird') {
              await invoke('toggle_netbird_session', { config: appConfig.netbird, active: true, enabled: true });
            }
            showToast(`✓ Connected to ${it.name} (${typeLabel})`, 'success');
          }
        } catch (err) {
          console.error(`Mesh connection error:`, err);
          showToast(`Connection failed: ${err}`, 'error');
        } finally {
          await renderUnifiedMeshDrawer();
          connectBtn.disabled = false;
        }
      });
    }

    const editBtn = card.querySelector('.btn-mesh-edit');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modalMesh = document.getElementById('modal-add-mesh') || document.getElementById('modal-add-wireguard');
        const meshFormType = document.getElementById('mesh-form-type');
        const meshFormName = document.getElementById('mesh-form-name') || document.getElementById('wg-form-name');
        const meshFormAutoconnect = document.getElementById('mesh-form-autoconnect') || document.getElementById('wg-form-autoconnect');
        const wgConfText = document.getElementById('wg-form-conf');
        const tsApiToken = document.getElementById('ts-form-api-token');
        const tsAuthKey = document.getElementById('ts-form-auth-key');
        const tsControlUrl = document.getElementById('ts-form-control-url');
        const tsHostname = document.getElementById('ts-form-hostname');
        const tsExitNode = document.getElementById('ts-form-exit-node');
        const tsSocks5Port = document.getElementById('ts-form-socks5-port');
        const nbToken = document.getElementById('nb-form-token') || document.getElementById('nb-form-setup-key');
        const nbMgmtUrl = document.getElementById('nb-form-mgmt-url');
        const nbExitNode = document.getElementById('nb-form-exit-node');
        const nbSocks5Port = document.getElementById('nb-form-socks5-port');

        editingMeshId = it.id;
        editingMeshType = it.type;

        if (meshFormType) {
          meshFormType.value = it.type;
          meshFormType.disabled = false;
        }
        if (meshFormName) meshFormName.value = it.name;
        if (meshFormAutoconnect) {
          meshFormAutoconnect.checked = !!it.raw.auto_connect;
        }

        if (it.type === 'wireguard') {
          invoke('export_wireguard_config_text', { profile: it.raw }).then((exported) => {
            if (wgConfText) wgConfText.value = exported;
          });
        } else if (it.type === 'tailscale') {
          if (tsApiToken) {
            tsApiToken.value = '';
            tsApiToken.placeholder = it.raw.api_token ? '•••••••••••• (leave blank to keep current token)' : 'tskey-api-...';
          }
          if (tsAuthKey) {
            tsAuthKey.value = '';
            tsAuthKey.placeholder = it.raw.auth_key ? '•••••••••••• (leave blank to keep current key)' : 'tskey-auth-...';
          }
          if (tsControlUrl) tsControlUrl.value = it.raw.control_url || '';
          if (tsHostname) tsHostname.value = it.raw.hostname || '';
          if (tsExitNode) tsExitNode.value = it.raw.exit_node || '';
          if (tsSocks5Port) tsSocks5Port.value = it.raw.socks5_port || '';
        } else if (it.type === 'netbird') {
          if (nbToken) {
            nbToken.value = '';
            nbToken.placeholder = (it.raw.personal_access_token || it.raw.setup_key) ? '•••••••••••• (leave blank to keep current token)' : 'nbp_xxxxxxxxxxxxxxxxxxxx';
          }
          if (nbMgmtUrl) nbMgmtUrl.value = it.raw.management_url || 'https://api.netbird.io';
          if (nbExitNode) nbExitNode.value = it.raw.exit_node || '';
          if (nbSocks5Port) nbSocks5Port.value = it.raw.socks5_port || '';
        }

        const titleEl = document.getElementById('modal-mesh-title') || document.getElementById('modal-wg-title');
        if (titleEl) {
          titleEl.innerHTML = `<i class="fa" style="color: #98c379; margin-right: 6px;">&#xf3ed;</i> Edit ${typeLabel} Network`;
        }

        resetMeshKeyToggles();
        updateMeshTypeFields(it.type);

        if (modalMesh) modalMesh.classList.remove('hidden');
      });
    }

    const exportBtn = card.querySelector('.btn-mesh-export');
    if (exportBtn && it.type === 'wireguard') {
      exportBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const confText = await invoke('export_wireguard_config_text', { profile: it.raw });
          await navigator.clipboard.writeText(confText);
          showToast(`✓ WireGuard '${it.name}' configuration copied to clipboard`, 'success');
        } catch (err) {
          showToast(`Export failed: ${err}`, 'error');
        }
      });
    }

    const deleteBtn = card.querySelector('.btn-mesh-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to remove the ${typeLabel} network '${it.name}'?`)) return;
        if (it.isActive) {
          try {
            if (it.type === 'wireguard') {
              await invoke('toggle_wireguard_profile_session', { profile: it.raw, active: false });
            } else if (it.type === 'tailscale') {
              await invoke('toggle_tailscale_session', { config: appConfig.tailscale, active: false, enabled: false });
            } else if (it.type === 'netbird') {
              await invoke('toggle_netbird_session', { config: appConfig.netbird, active: false, enabled: false });
            }
          } catch (_) {}
        }
        if (it.type === 'wireguard') {
          appConfig.wireguard_profiles = (appConfig.wireguard_profiles || []).filter((p) => p.id !== it.id);
        } else if (it.type === 'tailscale') {
          delete appConfig.tailscale;
        } else if (it.type === 'netbird') {
          delete appConfig.netbird;
        }
        await saveConfig();
        showToast(`✓ ${typeLabel} network '${it.name}' removed`, 'info');
        renderUnifiedMeshDrawer();
      });
    }

    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('.mesh-card-actions') || e.target.closest('.mesh-connect-btn')) return;
      connectBtn?.click();
    });

    listEl.appendChild(card);
  });
}
