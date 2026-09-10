// ── Cloud Providers Drawer & Management (In-Memory Only) ──
function setupCloudDrawer() {
  const providerSelect = document.getElementById('cloud-provider-select');
  const settingsBtn = document.getElementById('cloud-settings-btn');
  const refreshBtn = document.getElementById('cloud-refresh-btn');
  const searchInput = document.getElementById('cloud-search-input');

  const modalSettings = document.getElementById('modal-cloud-settings');
  const modalClose = document.getElementById('modal-cloud-settings-close');
  const modalCancel = document.getElementById('modal-cloud-settings-cancel');
  const modalSubmit = document.getElementById('modal-cloud-settings-submit');

  const tabGcp = document.getElementById('cloud-tab-btn-gcp');
  const tabAws = document.getElementById('cloud-tab-btn-aws');
  const tabAzure = document.getElementById('cloud-tab-btn-azure');

  const panelGcp = document.getElementById('cloud-panel-gcp');
  const panelAws = document.getElementById('cloud-panel-aws');
  const panelAzure = document.getElementById('cloud-panel-azure');

  function switchCloudTab(provider) {
    [tabGcp, tabAws, tabAzure].forEach((btn) => {
      if (!btn) return;
      const isTarget = btn.dataset.cloud === provider;
      btn.classList.toggle('active', isTarget);
    });

    if (panelGcp) panelGcp.classList.toggle('active', provider === 'gcp');
    if (panelAws) panelAws.classList.toggle('active', provider === 'aws');
    if (panelAzure) panelAzure.classList.toggle('active', provider === 'azure');
  }

  if (tabGcp) tabGcp.addEventListener('click', () => switchCloudTab('gcp'));
  if (tabAws) tabAws.addEventListener('click', () => switchCloudTab('aws'));
  if (tabAzure) tabAzure.addEventListener('click', () => switchCloudTab('azure'));

  const browseGcpBtn = document.getElementById('btn-browse-gcp-sa-path');
  if (browseGcpBtn) {
    browseGcpBtn.addEventListener('click', async () => {
      try {
        const picked = await invoke('pick_cloud_key_file');
        if (picked && typeof picked === 'string') {
          const saInput = document.getElementById('cloud-gcp-sa-path');
          if (saInput) saInput.value = picked;
          showToast('✓ Service account key file selected', 'success');
        }
      } catch (err) {
        showToast(`Failed to pick key file: ${err}`, 'error');
      }
    });
  }

  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      clearCloudCache(providerSelect.value || 'gcp');
      renderCloudDrawer(true);
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', async () => {
      switchCloudTab(currentCloudProvider);
      try {
        const creds = await invoke('get_cloud_credentials');
        if (creds) {
          const saInput = document.getElementById('cloud-gcp-sa-path');
          const gcpTokInput = document.getElementById('cloud-gcp-access-token');
          const projInput = document.getElementById('cloud-gcp-project');

          const awsTokInput = document.getElementById('cloud-aws-session-token');
          const awsKeyInput = document.getElementById('cloud-aws-access-key');
          const awsSecInput = document.getElementById('cloud-aws-secret-key');
          const awsRegInput = document.getElementById('cloud-aws-region');
          const awsProfInput = document.getElementById('cloud-aws-profile');

          const azTokInput = document.getElementById('cloud-azure-access-token');
          const azSubInput = document.getElementById('cloud-azure-sub-id');
          const azTenInput = document.getElementById('cloud-azure-tenant-id');
          const azClientInput = document.getElementById('cloud-azure-client-id');
          const azSecInput = document.getElementById('cloud-azure-client-secret');
          const azRgInput = document.getElementById('cloud-azure-rg');

          if (saInput) saInput.value = creds.gcp_service_account_path || creds.gcp_service_account_json || '';
          if (gcpTokInput) gcpTokInput.value = creds.gcp_access_token || '';
          if (projInput) projInput.value = creds.gcp_default_project || '';

          if (awsTokInput) awsTokInput.value = creds.aws_session_token || '';
          if (awsKeyInput) awsKeyInput.value = creds.aws_access_key_id || '';
          if (awsSecInput) awsSecInput.value = creds.aws_secret_access_key || '';
          if (awsRegInput) awsRegInput.value = creds.aws_default_region || 'us-east-1';
          if (awsProfInput) awsProfInput.value = creds.aws_profile || 'default';

          if (azTokInput) azTokInput.value = creds.azure_access_token || '';
          if (azSubInput) azSubInput.value = creds.azure_subscription_id || '';
          if (azTenInput) azTenInput.value = creds.azure_tenant_id || '';
          if (azClientInput) azClientInput.value = creds.azure_client_id || '';
          if (azSecInput) azSecInput.value = creds.azure_client_secret || '';
          if (azRgInput) azRgInput.value = creds.azure_default_resource_group || '';
        }
      } catch (err) {
        console.warn('Could not load cloud credentials:', err);
      }
      if (modalSettings) modalSettings.classList.remove('hidden');
    });
  }

  if (modalClose) modalClose.addEventListener('click', () => modalSettings?.classList.add('hidden'));
  if (modalCancel) modalCancel.addEventListener('click', () => modalSettings?.classList.add('hidden'));

  if (modalSubmit) {
    modalSubmit.addEventListener('click', async () => {
      const saInput = document.getElementById('cloud-gcp-sa-path');
      const gcpTokInput = document.getElementById('cloud-gcp-access-token');
      const projInput = document.getElementById('cloud-gcp-project');

      const awsTokInput = document.getElementById('cloud-aws-session-token');
      const awsKeyInput = document.getElementById('cloud-aws-access-key');
      const awsSecInput = document.getElementById('cloud-aws-secret-key');
      const awsRegInput = document.getElementById('cloud-aws-region');
      const awsProfInput = document.getElementById('cloud-aws-profile');

      const azTokInput = document.getElementById('cloud-azure-access-token');
      const azSubInput = document.getElementById('cloud-azure-sub-id');
      const azTenInput = document.getElementById('cloud-azure-tenant-id');
      const azClientInput = document.getElementById('cloud-azure-client-id');
      const azSecInput = document.getElementById('cloud-azure-client-secret');
      const azRgInput = document.getElementById('cloud-azure-rg');

      const config = {
        gcp_service_account_path: saInput?.value.trim() || null,
        gcp_service_account_json: null, // do NOT store raw key in config
        gcp_access_token: gcpTokInput?.value.trim() || null,
        gcp_default_project: projInput?.value.trim() || null,

        aws_session_token: awsTokInput?.value.trim() || null,
        aws_access_key_id: awsKeyInput?.value.trim() || null,
        aws_secret_access_key: awsSecInput?.value.trim() || null,
        aws_default_region: awsRegInput?.value.trim() || 'us-east-1',
        aws_profile: awsProfInput?.value.trim() || 'default',

        azure_access_token: azTokInput?.value.trim() || null,
        azure_subscription_id: azSubInput?.value.trim() || null,
        azure_tenant_id: azTenInput?.value.trim() || null,
        azure_client_id: azClientInput?.value.trim() || null,
        azure_client_secret: azSecInput?.value.trim() || null,
        azure_default_resource_group: azRgInput?.value.trim() || null,
      };

      try {
        await invoke('save_cloud_credentials', { config });
        showToast('✓ Cloud provider credentials saved', 'success');
        if (modalSettings) modalSettings.classList.add('hidden');
        clearCloudCache(currentCloudProvider);
        renderCloudDrawer(true);
      } catch (err) {
        showToast(`Failed to save cloud credentials: ${err}`, 'error');
      }
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      clearCloudCache(currentCloudProvider);
      renderCloudDrawer(true);
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => renderCloudTree());
  }

  // Setup low-rate (5 min) background instance polling
  setupCloudPollingTimer();
}

function isCloudAuthError(err) {
  if (!err) return false;
  const msg = (typeof err === 'string' ? err : (err.message || JSON.stringify(err))).toLowerCase();
  return msg.includes('token') ||
    msg.includes('expired') ||
    msg.includes('unauthorized') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('forbidden') ||
    msg.includes('reauth') ||
    msg.includes('credential') ||
    msg.includes('access denied') ||
    msg.includes('login') ||
    msg.includes('sign in') ||
    msg.includes('invalid grant') ||
    msg.includes('not authenticated') ||
    msg.includes('no azure credentials') ||
    msg.includes('no gcp credentials') ||
    msg.includes('no aws credentials');
}

function handleCloudAuthError(err) {
  const msg = typeof err === 'string' ? err : (err?.message || 'Authentication session or credentials expired.');
  cloudDataCache.authError = msg;
  if (cloudDataCache.auth) {
    cloudDataCache.auth.is_authenticated = false;
  }
  const authPill = document.getElementById('cloud-auth-pill');
  if (authPill) {
    authPill.textContent = 'Not connected';
    authPill.className = 'status-pill offline';
    authPill.style.color = 'var(--red)';
  }
  renderCloudTree();
}

const CLOUD_POLL_INTERVAL_MS = 300000; // 5 minutes

function setupCloudPollingTimer() {
  if (cloudPollInterval) {
    clearInterval(cloudPollInterval);
  }
  cloudPollInterval = setInterval(async () => {
    // 1. Only poll if Cloud tab is currently selected and visible
    if (activeCategory !== 'cloud') return;
    const drawer = document.getElementById('left-drawer');
    if (drawer && drawer.classList.contains('collapsed')) return;

    // 2. Only poll if connected and no auth error
    if (cloudDataCache.authError || !cloudDataCache.auth?.is_authenticated) return;

    // 3. Target only selected or expanded projects
    const targetPids = [];
    if (cloudDataCache.selectedProjectId) {
      targetPids.push(cloudDataCache.selectedProjectId);
    } else {
      targetPids.push(...Array.from(cloudDataCache.expandedProjects));
    }

    if (targetPids.length === 0) return;

    // 4. Poll active projects quietly
    for (const pid of targetPids) {
      await fetchProjectInstances(pid, true);
    }
  }, CLOUD_POLL_INTERVAL_MS);
}

async function renderCloudDrawer(forceRefresh = false) {
  const providerSelect = document.getElementById('cloud-provider-select');
  const authPill = document.getElementById('cloud-auth-pill');
  const treeList = document.getElementById('cloud-tree-list');
  if (!treeList) return;

  if (providerSelect && providerSelect.value !== currentCloudProvider) {
    clearCloudCache(providerSelect.value || 'gcp');
  }

  const providerName = currentCloudProvider === 'gcp' ? 'GCP' : (currentCloudProvider === 'aws' ? 'AWS' : 'Azure');

  // If already in memory and not force refresh, render immediately from memory without API calls
  if (!forceRefresh && cloudDataCache.projects !== null) {
    if (authPill) {
      const isOnline = cloudDataCache.auth?.is_authenticated && !cloudDataCache.authError;
      authPill.textContent = isOnline ? 'Connected' : 'Not connected';
      authPill.className = `status-pill ${isOnline ? 'online' : 'offline'}`;
      authPill.style.color = isOnline ? 'var(--green)' : 'var(--red)';
    }
    renderCloudTree();
    return;
  }

  // Check auth first if not cached or force refresh
  if (forceRefresh || !cloudDataCache.auth) {
    try {
      const auth = await invoke('check_cloud_auth', { provider: currentCloudProvider });
      cloudDataCache.auth = auth;
      cloudDataCache.authError = null;

      if (authPill) {
        authPill.textContent = auth.is_authenticated ? 'Connected' : 'Not connected';
        authPill.className = `status-pill ${auth.is_authenticated ? 'online' : 'offline'}`;
        authPill.style.color = auth.is_authenticated ? 'var(--green)' : 'var(--red)';
      }

      if (!auth.is_authenticated) {
        cloudDataCache.projects = [];
        renderCloudTree();
        return;
      }
    } catch (err) {
      console.warn('Cloud auth check failed:', err);
      handleCloudAuthError(err);
      return;
    }
  }

  if (cloudDataCache.loadingProjects) return;
  cloudDataCache.loadingProjects = true;

  treeList.innerHTML = `
    <div style="padding: 32px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
      <i class="fa fa-spinner fa-spin" style="font-size: 24px; color: var(--accent); margin-bottom: 10px; display: block;"></i>
      Loading ${providerName} projects...
    </div>
  `;

  try {
    const projects = await invoke('list_cloud_projects', { provider: currentCloudProvider, defaultProject: null });
    cloudDataCache.projects = projects || [];
    cloudDataCache.authError = null;

    // If only one project exists, auto-expand it and fetch its instances
    if (cloudDataCache.projects.length === 1) {
      const singleProj = cloudDataCache.projects[0];
      cloudDataCache.expandedProjects.add(singleProj.id);
      cloudDataCache.selectedProjectId = singleProj.id;
      fetchProjectInstances(singleProj.id);
    }
  } catch (err) {
    console.error('Failed to list cloud projects:', err);
    if (isCloudAuthError(err)) {
      handleCloudAuthError(err);
    } else {
      cloudDataCache.projects = [];
      showToast(`Error listing ${providerName} projects: ${err}`, 'error');
    }
  } finally {
    cloudDataCache.loadingProjects = false;
    renderCloudTree();
  }
}

async function fetchProjectInstances(projectId, isBackgroundPoll = false) {
  if (!projectId) return;
  if (cloudDataCache.loadingInstances[projectId]) return;
  cloudDataCache.loadingInstances[projectId] = true;

  if (!isBackgroundPoll) {
    renderCloudTree();
  }

  try {
    const instances = await invoke('list_cloud_instances', {
      provider: currentCloudProvider,
      projectId: projectId,
      zone: null,
    });
    cloudDataCache.instances[projectId] = instances || [];
    cloudDataCache.authError = null;
    cloudDataCache.lastPollTimestamp = Date.now();
  } catch (err) {
    console.warn(`Failed to list instances for project ${projectId}:`, err);
    if (isCloudAuthError(err)) {
      handleCloudAuthError(err);
    } else {
      if (!cloudDataCache.instances[projectId]) {
        cloudDataCache.instances[projectId] = [];
      }
      if (!isBackgroundPoll) {
        showToast(`Failed to load instances: ${err}`, 'error');
      }
    }
  } finally {
    cloudDataCache.loadingInstances[projectId] = false;
    renderCloudTree();
  }
}

function renderCloudTree() {
  const treeList = document.getElementById('cloud-tree-list');
  const searchInput = document.getElementById('cloud-search-input');
  if (!treeList) return;

  const query = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const providerName = currentCloudProvider === 'gcp' ? 'GCP' : (currentCloudProvider === 'aws' ? 'AWS' : 'Azure');

  // 1. Auth error or unauthenticated state: show clear re-auth prompt
  if (cloudDataCache.authError || (cloudDataCache.auth && !cloudDataCache.auth.is_authenticated)) {
    const errorDetail = cloudDataCache.authError || cloudDataCache.auth?.message || 'Authentication required.';
    treeList.innerHTML = `
      <div style="padding: 36px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
        <i class="fa" style="font-size: 32px; color: var(--border-color); margin-bottom: 12px; display: block;">&#xf0c2;</i>
        <b style="color: var(--text-main); font-size: 12px;">${providerName} is not connected.</b><br>
        <p style="margin: 8px 0 14px 0; line-height: 1.4; color: var(--text-subtle);">${escapeHtml(errorDetail)}</p>
        <button id="btn-cloud-open-settings-prompt" class="btn-primary" style="padding: 6px 14px; font-size: 11px; margin: 0 auto; display: inline-flex; align-items: center; gap: 6px;">
          <i class="fa">&#xf013;</i> ${cloudDataCache.authError ? 'Re-Authenticate' : 'Configure'} ${providerName} Credentials
        </button>
      </div>
    `;
    document.getElementById('btn-cloud-open-settings-prompt')?.addEventListener('click', () => {
      document.getElementById('cloud-settings-btn')?.click();
    });
    return;
  }

  // 2. Projects loading state
  if (cloudDataCache.projects === null && cloudDataCache.loadingProjects) {
    treeList.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
        <i class="fa fa-spinner fa-spin" style="font-size: 24px; color: var(--accent); margin-bottom: 10px; display: block;"></i>
        Loading ${providerName} projects...
      </div>
    `;
    return;
  }

  // 3. No projects found
  if (!cloudDataCache.projects || cloudDataCache.projects.length === 0) {
    treeList.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--text-subtle); font-size: 11px;">
        <i class="fa" style="font-size: 28px; color: var(--border-color); margin-bottom: 8px; display: block;">&#xf0c2;</i>
        No ${providerName} projects or regions detected.<br>
        Verify your account permissions or click ⚙️ above to check settings.
      </div>
    `;
    return;
  }

  treeList.innerHTML = '';

  cloudDataCache.projects.forEach((proj) => {
    const instances = cloudDataCache.instances[proj.id];
    const isLoadingInst = !!cloudDataCache.loadingInstances[proj.id];
    const isExpanded = cloudDataCache.expandedProjects.has(proj.id) || !!query;

    let filteredInstances = instances || [];
    if (query) {
      filteredInstances = filteredInstances.filter((inst) => {
        return inst.name.toLowerCase().includes(query) ||
          inst.id.toLowerCase().includes(query) ||
          (inst.zone && inst.zone.toLowerCase().includes(query)) ||
          (inst.external_ip && inst.external_ip.includes(query)) ||
          (inst.internal_ip && inst.internal_ip.includes(query)) ||
          proj.name.toLowerCase().includes(query) ||
          proj.id.toLowerCase().includes(query);
      });
      if (filteredInstances.length === 0 && !proj.name.toLowerCase().includes(query) && !proj.id.toLowerCase().includes(query)) {
        return;
      }
    }

    const group = document.createElement('div');
    group.className = 'cloud-project-group';

    let countBadge = '';
    if (isLoadingInst) {
      countBadge = `<i class="fa fa-spinner fa-spin" style="font-size: 10px; color: var(--accent);"></i>`;
    } else if (instances === undefined) {
      countBadge = `<span style="font-size: 9.5px; padding: 1px 5px; border-radius: 8px; background: var(--bg-card-hover); color: var(--text-subtle);">Click to load</span>`;
    } else {
      countBadge = `<span style="font-size: 10px; padding: 1px 6px; border-radius: 10px; background: var(--bg-card-hover); color: var(--text-subtle);">${filteredInstances.length}</span>`;
    }

    const chevronRotation = isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    const folderIcon = isExpanded ? '&#xf07c;' : '&#xf07b;';

    group.innerHTML = `
      <div class="cloud-project-header" style="cursor: pointer; user-select: none;">
        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">
          <i class="fa fa-chevron-down" style="font-size: 10px; color: var(--text-subtle); transition: transform 0.15s; transform: ${chevronRotation};"></i>
          <i class="fa" style="font-size: 11px; color: #61afef;">${folderIcon}</i>
          <span title="${escapeHtml(proj.name)} (${escapeHtml(proj.id)})" style="overflow: hidden; text-overflow: ellipsis;">${escapeHtml(proj.name)}</span>
        </div>
        ${countBadge}
      </div>
      <div class="cloud-instance-list" style="display: ${isExpanded ? 'flex' : 'none'};"></div>
    `;

    const header = group.querySelector('.cloud-project-header');
    const instListEl = group.querySelector('.cloud-instance-list');

    header.addEventListener('click', () => {
      if (cloudDataCache.expandedProjects.has(proj.id)) {
        cloudDataCache.expandedProjects.delete(proj.id);
        if (cloudDataCache.selectedProjectId === proj.id) {
          cloudDataCache.selectedProjectId = null;
        }
        renderCloudTree();
      } else {
        cloudDataCache.expandedProjects.add(proj.id);
        cloudDataCache.selectedProjectId = proj.id;
        if (cloudDataCache.instances[proj.id] === undefined) {
          fetchProjectInstances(proj.id);
        } else {
          renderCloudTree();
        }
      }
    });

    if (isExpanded) {
      if (isLoadingInst) {
        instListEl.innerHTML = `
          <div style="padding: 10px 12px; font-size: 10.5px; color: var(--text-subtle); text-align: center;">
            <i class="fa fa-spinner fa-spin" style="margin-right: 6px; color: var(--accent);"></i> Loading instances...
          </div>
        `;
      } else if (instances === undefined) {
        instListEl.innerHTML = `
          <div style="padding: 10px 12px; font-size: 10.5px; color: var(--text-subtle); text-align: center; cursor: pointer;" class="cloud-load-inst-hint">
            <i class="fa fa-arrow-down" style="margin-right: 4px; color: var(--accent);"></i> Click to fetch compute instances
          </div>
        `;
        instListEl.querySelector('.cloud-load-inst-hint')?.addEventListener('click', (e) => {
          e.stopPropagation();
          fetchProjectInstances(proj.id);
        });
      } else if (filteredInstances.length === 0) {
        instListEl.innerHTML = `
          <div style="padding: 8px 12px; font-size: 10.5px; color: var(--text-subtle); text-align: center;">
            No compute instances found in this project.
          </div>
        `;
      } else {
        filteredInstances.forEach((inst) => {
          const card = document.createElement('div');
          card.className = 'cloud-instance-card';
          card.setAttribute('title', `Double click to SSH connect to ${inst.name}`);

          const isRunning = (inst.status || '').toLowerCase().includes('running');
          const statusClass = isRunning ? 'running' : 'stopped';

          const extIp = inst.external_ip || 'No External IP';
          const zoneText = inst.zone || 'Global';

          card.innerHTML = `
            <div class="cloud-instance-header">
              <div class="cloud-instance-name">
                <span class="status-dot ${isRunning ? 'online' : 'offline'}" style="width: 6px; height: 6px;"></span>
                <span>${escapeHtml(inst.name)}</span>
              </div>
              <span class="cloud-status-indicator ${statusClass}">${escapeHtml(inst.status)}</span>
            </div>
            <div class="cloud-instance-meta">
              <span><i class="fa fa-map-marker" style="margin-right: 3px;"></i>${escapeHtml(zoneText)}</span>
              <span style="color: ${inst.external_ip ? 'var(--text-main)' : 'var(--text-subtle)'};">${escapeHtml(extIp)}</span>
            </div>
          `;

          card.addEventListener('dblclick', () => {
            connectCloudInstance(inst);
          });

          instListEl.appendChild(card);
        });
      }
    }

    treeList.appendChild(group);
  });
}

async function connectCloudInstance(inst) {
  showToast(`Connecting to ${inst.name} (${inst.provider.toUpperCase()})...`, 'info');

  try {
    const ep = await invoke('get_cloud_instance_ssh_endpoint', { instance: inst });

    const cloudHost = {
      id: `cloud-${inst.provider}-${inst.id}`,
      name: `${inst.name} (${inst.provider.toUpperCase()})`,
      host: ep.host || inst.external_ip || inst.internal_ip || '127.0.0.1',
      port: ep.port || 22,
      user: ep.user || 'root',
      auth_type: 'key',
      key_path: '.ssh/id_ed25519',
      has_docker: false,
      enable_port_scan: false,
      icon: '&#xf0c2;',
      cloud_provider: inst.provider,
      cloud_project_id: inst.project_id,
      cloud_zone: inst.zone,
      cloud_instance_id: inst.id,
    };

    await connectToHost(cloudHost);
  } catch (err) {
    showToast(`Failed to establish SSH connection to ${inst.name}: ${err}`, 'error');
  }
}

function getOsIconClass(osName) {
  if (!osName) return 'fa-server';
  const os = osName.toLowerCase();
  if (os.includes('linux') || os.includes('ubuntu') || os.includes('debian')) return 'fa-linux';
  if (os.includes('windows')) return 'fa-windows';
  if (os.includes('darwin') || os.includes('mac') || os.includes('apple') || os.includes('ios')) return 'fa-apple';
  if (os.includes('android')) return 'fa-android';
  return 'fa-server';
}

function connectToMeshPeer(peerInfo) {
  const peerHostObj = {
    id: `peer-${peerInfo.route}-${peerInfo.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    name: `${peerInfo.name} (${peerInfo.route.toUpperCase()})`,
    host: peerInfo.host,
    port: 22,
    user: 'root',
    auth_type: 'password',
    key_path: null,
    password: '',
    network_route: 'mesh',
    has_docker: false,
    enable_port_scan: false,
    icon: '&#xf3ed;',
  };

  connectToHost(peerHostObj);
}

function refreshActiveMeshSilent() {
  const profiles = appConfig.wireguard_profiles || [];
  invoke('get_wireguard_runtime_statuses', { profiles })
    .then((statuses) => {
      if (statuses) {
        wgStatusesCache = statuses;
      }
    })
    .catch(() => {});
}
