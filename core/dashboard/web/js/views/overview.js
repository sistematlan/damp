// ── Overview View ──────────────────────────────────────

function getServiceInfo(containers) {
  var serviceMap = {
    'damp-caddy':      { label: 'Caddy',       icon: '🔗',  desc: 'reverseProxy',   url: '' },
    'damp-db':         { label: 'MySQL 8.4',    icon: '🗄️',  desc: 'databases',      url: '', port: '3306' },
    'damp-postgres':   { label: 'PostgreSQL 16', icon: '🗄️', desc: 'databases',      url: '', port: '5432' },
    'damp-redis':      { label: 'Redis 7',      icon: '⚡',  desc: 'cache',          url: '', port: '6379' },
    'damp-phpmyadmin': { label: 'PHPMyAdmin',   icon: '📊', desc: 'dbManagement',  url: 'https://pma.test' },
    'damp-mailpit':    { label: 'Mailpit',      icon: '📧', desc: 'emailTesting',  url: 'https://mail.test' },
    'damp-dashboard':  { label: 'Dashboard',    icon: '◉',  desc: 'DAMP',           url: 'https://damp.test' },
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
      label: info.label,
      icon: info.icon,
      desc: t(info.desc),
      url: info.url,
      port: info.port || '',
      state: state
    });
  }
  return result;
}

function renderServiceGrid(services) {
  return services.map(function(s, i) {
    return '<a href="' + (s.url || 'javascript:void(0)') + '" ' + (s.url ? 'target="_blank"' : '') + ' class="service-card fade-in stagger-' + (i + 1) + '" data-service="' + s.name + '">' +
        '<div class="service-header">' +
          '<span class="service-icon">' + s.icon + '</span>' +
          '<span class="dot ' + s.state + '"></span>' +
        '</div>' +
        '<div class="service-name">' + s.label + '</div>' +
        '<div class="service-desc">' + s.desc +
          (s.port ? ' · :' + s.port : '') +
          (s.url ? ' →' : '') +
        '</div>' +
      '</a>';
  }).join('');
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
      return;
    }

    // Full render for the first time
    el.innerHTML =
      '<div class="grid-3 fade-in mb-20">' +
        renderStatMini(running, t('containersRunning'), 'running-stat') +
        renderStatMini(projects.length, t('projects'), 'projects-stat') +
        renderStatMini(allDbs.length, t('databases'), 'dbs-stat') +
      '</div>' +

      '<div class="card fade-in p-16 rounded-16 bg-subtle">' +
        '<div class="card-header mb-12">' +
          '<span class="card-title font-10 opacity-50">' + t('services') + '</span>' +
          '<div class="container-actions">' +
            '<button class="btn btn-sm btn-primary" id="btn-engine-up" onclick="engineAction(\'up\')">▶ ' + t('start') + '</button>' +
            '<button class="btn btn-sm btn-danger" id="btn-engine-down" onclick="engineAction(\'down\')">■ ' + t('stop') + '</button>' +
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
    setTimeout(function() { renderOverview(document.getElementById('view')); }, 2000);
  } catch (e) {
    btn.innerHTML = origText;
    btn.disabled = false;
  }
}