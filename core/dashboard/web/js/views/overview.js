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
    var linkStart = s.url ? '<a href="' + s.url + '" target="_blank" style="text-decoration:none;color:inherit;">' : '';
    var linkEnd = s.url ? '</a>' : '';
    return linkStart +
      '<div class="service-card fade-in stagger-' + (i + 1) + '" data-service="' + s.name + '">' +
        '<div class="service-header">' +
          '<span class="service-icon">' + s.icon + '</span>' +
          '<span class="dot ' + s.state + '" style="margin-left:auto;"></span>' +
        '</div>' +
        '<div class="service-name">' + s.label + '</div>' +
        '<div class="service-desc">' + s.desc +
          (s.port ? ' · :' + s.port : '') +
          (s.url ? ' →' : '') +
        '</div>' +
      '</div>' + linkEnd;
  }).join('');
}

async function renderOverview(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    var data = await api('/api/status');
    var allContainers = data.containers || [];
    var dampServices = allContainers.filter(function(c) { return c.is_damp; });
    var projects = allContainers.filter(function(c) { return !c.is_damp; });
    var running = allContainers.filter(function(c) { return c.state === 'running'; }).length;
    var dbs = data.databases || [];
    var services = getServiceInfo(allContainers);

    el.innerHTML =
      '<div class="grid-3 fade-in" style="margin-bottom: 24px;">' +
        '<div class="stat">' +
          '<div class="stat-value">' + running + '</div>' +
          '<div class="stat-label">' + t('containersRunning') + '</div>' +
        '</div>' +
        '<div class="stat">' +
          '<div class="stat-value">' + projects.length + '</div>' +
          '<div class="stat-label">' + t('projects') + '</div>' +
        '</div>' +
        '<div class="stat">' +
          '<div class="stat-value">' + dbs.length + '</div>' +
          '<div class="stat-label">' + t('databases') + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card fade-in">' +
        '<div class="card-header">' +
          '<span class="card-title">' + t('services') + '</span>' +
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
            '<span class="card-title">' + t('projects') + '</span>' +
            '<span class="card-count">' + projects.length + '</span>' +
          '</div>' +
          '<div id="container-list">' + renderContainerRows(projects) + '</div>' +
        '</div>' +

        '<div class="card fade-in">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('databases') + '</span>' +
            '<span class="card-count">' + dbs.length + '</span>' +
          '</div>' +
          '<div class="db-grid" style="padding: 4px 0;">' +
            dbs.map(function(db) {
              return '<div class="db-card"><span>' + db + '</span></div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">' + t('cannotConnect') + '</div></div>';
  }
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