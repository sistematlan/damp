// ── Overview View ──────────────────────────────────────

function getServiceInfo(containers) {
  var serviceMap = {
    'damp-caddy':      { id: 'caddy', label: 'Caddy', desc: 'reverseProxy', url: '' },
    'damp-db':         { id: 'mysql', label: 'MySQL 8.4', desc: 'databases', url: '', port: '3306' },
    'damp-postgres':   { id: 'postgres', label: 'PostgreSQL 16', desc: 'databases', url: '', port: '5432' },
    'damp-redis':      { id: 'redis', label: 'Redis 7', desc: 'cache', url: '', port: '6379' },
    'damp-phpmyadmin': { id: 'phpmyadmin', label: 'PHPMyAdmin', desc: 'dbManagement', url: 'https://pma.test' },
    'damp-mailpit':    { id: 'mailpit', label: 'Mailpit', desc: 'emailTesting', url: 'https://mail.test' },
    'damp-dashboard':  { id: 'dashboard', label: 'Dashboard', desc: 'DAMP', url: 'https://damp.test', controllable: false },
    'damp-dns':        { label: 'DNS',          icon: '🌐', desc: 'dns',           url: '' },
  };

  var result = [];
  for (var key in serviceMap) {
    var info = serviceMap[key];
    var container = null;
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].name === key) { container = containers[i]; break; }
    }
    var state = container ? container.state : 'stopped';
    result.push({
      name: key,
      id: info.id,
      label: info.label,
      icon: info.icon,
      desc: t(info.desc),
      url: info.url,
      port: info.port || '',
      state: state,
      controllable: info.controllable !== false
    });
  }
  return result;
}

function renderServiceGrid(services) {
  return services.map(function(s, i) {
    var running = s.state === 'running';
    var action = running ? 'stop' : 'start';
    var control = s.controllable
      ? '<button class="btn btn-sm ' + (running ? 'btn-danger' : 'btn-primary') + ' service-control" data-service-action="' + s.id + '" onclick="serviceAction(event,\'' + s.id + '\',\'' + action + '\')">' + t(action) + '</button>'
      : '<span class="service-control-plane">' + t('controlPlane') + '</span>';
    return '<div class="service-card fade-in stagger-' + (i + 1) + '" data-service="' + s.name + '">' +
        '<div class="service-header">' +
          '<span class="dot ' + s.state + '"></span>' +
        '</div>' +
        '<div class="service-name">' + s.label + '</div>' +
        '<div class="service-desc">' + s.desc +
          (s.port ? ' · :' + s.port : '') +
        '</div>' +
        '<div class="service-actions">' + control +
          (s.url && running ? '<a href="' + s.url + '" target="_blank" class="btn btn-sm">' + t('open') + '</a>' : '') +
        '</div>' +
      '</div>';
  }).join('');
}

async function serviceAction(event, service, action) {
  event.stopPropagation();
  var btn = event.currentTarget;
  var original = btn.textContent;
  btn.disabled = true;
  btn.textContent = action === 'start' ? t('starting') : t('stopping');
  setActionNotice('', '');
  try {
    await api('/api/services/' + service + '/' + action, { method: 'POST' });
    setActionNotice(t('serviceActionComplete'), 'success');
    setTimeout(function() { renderOverview(document.getElementById('view')); }, 500);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = original;
    setActionNotice(e.message, 'error');
  }
}

function setActionNotice(message, kind) {
  var notice = document.getElementById('action-notice');
  if (!notice) return;
  notice.textContent = message;
  notice.className = message ? 'action-notice ' + kind : 'action-notice hidden';
}

function formatRuntimeBytes(bytes) {
  if (!bytes) return '0 MiB';
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GiB';
  return (bytes / 1048576).toFixed(1) + ' MiB';
}

function renderRuntimeObservability(data, containers) {
  var runtime = data.runtime || {};
  var measured = containers.filter(function(c) { return c.resources; }).sort(function(a, b) {
    return b.resources.memory_usage - a.resources.memory_usage;
  });
  var rows = measured.map(function(c) {
    var r = c.resources;
    var budget = r.memory_limited ? formatRuntimeBytes(r.memory_limit) : t('unbounded');
    var percent = r.memory_limited ? r.memory_percent.toFixed(0) + '%' : '—';
    return '<div class="runtime-row pressure-' + r.pressure + '">' +
      '<span class="runtime-name">' + c.name + '</span>' +
      '<span>' + formatRuntimeBytes(r.memory_usage) + ' / ' + budget + '</span>' +
      '<span>' + percent + '</span>' +
      '<span>' + r.cpu_percent.toFixed(1) + '% CPU</span>' +
      '<span>' + r.pids + ' PIDs</span>' +
    '</div>';
  }).join('');
  if (!rows) rows = '<div class="empty-text">' + t('noRuntimeSamples') + '</div>';
  return '<div class="card fade-in runtime-observability">' +
    '<div class="card-header"><span class="card-title">' + t('runtimeHealth') + '</span>' +
      '<span class="runtime-latency">API ' + (data.response_time_ms || 0) + ' ms</span></div>' +
    '<div class="runtime-summary">' +
      '<strong>' + formatRuntimeBytes(runtime.memory_usage || 0) + '</strong> ' + t('containerMemory') +
      '<span>' + (runtime.limited_containers || 0) + '/' + (runtime.running_containers || 0) + ' ' + t('bounded') + '</span>' +
      '<span class="' + ((runtime.warnings || 0) ? 'runtime-alert' : '') + '">' + (runtime.warnings || 0) + ' ' + t('warnings') + '</span>' +
    '</div><div class="runtime-list">' + rows + '</div></div>';
}

async function renderOverview(el) {
  // Only show loading if the view is empty
  if (!el.innerHTML || el.innerHTML.includes('loading') || el.innerHTML.includes('empty')) {
    el.innerHTML = '<div class="loading-box">Initializing DAMP...</div>';
  }

  try {
    var data = await api('/api/status');
    var allContainers = data.containers || [];
    var dampServices = allContainers.filter(function(c) { return c.is_damp; });
    var projects = allContainers.filter(function(c) { return !c.is_damp; });
    var running = allContainers.filter(function(c) { return c.state === 'running'; }).length;
    var mysqlDbs = data.databases || [];
    var pgDbs = data.postgres_databases || [];
    var allDbs = mysqlDbs.concat(pgDbs);
    var services = getServiceInfo(allContainers);

    // If we already have the structure, update only what's needed
    if (el.querySelector('.service-grid')) {
      updateOverviewStats(el, running, projects.length, allDbs.length);
      el.querySelector('.service-grid').innerHTML = renderServiceGrid(services);
      el.querySelector('#container-list').innerHTML = renderContainerRows(projects);
      el.querySelector('.db-grid').innerHTML = allDbs.map(function(db) {
        return '<div class="db-card"><span>' + db + '</span></div>';
      }).join('');
      var runtimeEl = el.querySelector('.runtime-observability');
      if (runtimeEl) runtimeEl.outerHTML = renderRuntimeObservability(data, allContainers);
      return;
    }

    // Full render for the first time
    el.innerHTML =
      '<div id="action-notice" class="action-notice hidden" role="status" aria-live="polite"></div>' +
      '<div class="grid-3 fade-in mb-20">' +
        renderStatMini(running, t('containersRunning'), 'running-stat') +
        renderStatMini(projects.length, t('projects'), 'projects-stat') +
        renderStatMini(allDbs.length, t('databases'), 'dbs-stat') +
      '</div>' +

      renderRuntimeObservability(data, allContainers) +

      '<div class="card fade-in p-16 rounded-16 bg-subtle">' +
        '<div class="card-header mb-12">' +
          '<span class="card-title font-10 opacity-50">' + t('services') + '</span>' +
          '<div class="container-actions">' +
            '<button class="btn btn-sm btn-primary" id="btn-engine-up" onclick="engineAction(\'up\')">' + t('startMinimal') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="service-grid">' +
          renderServiceGrid(services) +
        '</div>' +
      '</div>' +

      '<div class="grid-2">' +
        '<div class="card fade-in">' +
          '<div class="card-header">' +
            '<span class="card-title font-10 opacity-50">' + t('projects') + '</span>' +
            '<span class="card-count projects-count">' + projects.length + '</span>' +
          '</div>' +
          '<div id="container-list">' + renderContainerRows(projects) + '</div>' +
        '</div>' +

        '<div class="card fade-in">' +
          '<div class="card-header">' +
            '<span class="card-title font-10 opacity-50">' + t('databases') + '</span>' +
            '<span class="card-count dbs-count">' + allDbs.length + '</span>' +
          '</div>' +
          '<div class="db-grid">' +
            allDbs.map(function(db) {
              return '<div class="db-card"><span>' + db + '</span></div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">' + t('cannotConnect') + '</div></div>';
  }
}

function renderStatMini(value, label, className) {
  return '<div class="stat-mini ' + className + '">' +
    '<div class="stat-mini-value">' + value + '</div>' +
    '<div class="stat-mini-label">' + label + '</div>' +
  '</div>';
}

function updateOverviewStats(el, running, projects, dbs) {
  var runningEl = el.querySelector('.running-stat .stat-mini-value');
  var projectsEl = el.querySelector('.projects-stat .stat-mini-value');
  var dbsEl = el.querySelector('.dbs-stat .stat-mini-value');
  
  if (runningEl) runningEl.textContent = running;
  if (projectsEl) projectsEl.textContent = projects;
  if (dbsEl) dbsEl.textContent = dbs;
  
  var projectsCount = el.querySelector('.projects-count');
  var dbsCount = el.querySelector('.dbs-count');
  if (projectsCount) projectsCount.textContent = projects;
  if (dbsCount) dbsCount.textContent = dbs;
}

async function engineAction(action) {
  var btn = document.getElementById('btn-engine-' + action);
  var origText = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = action === 'up' ? t('starting') : t('stopping');

  try {
    await api('/api/engine/' + action, { method: 'POST' });
    setActionNotice(t('minimalStarted'), 'success');
    setTimeout(function() { renderOverview(document.getElementById('view')); }, 500);
  } catch (e) {
    btn.innerHTML = origText;
    btn.disabled = false;
    setActionNotice(e.message, 'error');
  }
}
