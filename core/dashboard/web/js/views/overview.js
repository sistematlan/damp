// ── Overview View ──────────────────────────────────────

function getServiceInfo(containers) {
  var serviceMap = {
    'damp-caddy':      { label: 'Caddy',       icon: '&#9741;',  desc: 'reverseProxy',   url: '' },
    'damp-db':         { label: 'MySQL 8.4',    icon: '&#9707;',  desc: 'databases',      url: '', port: '3306' },
    'damp-postgres':   { label: 'PostgreSQL 16', icon: '&#9707;', desc: 'databases',      url: '', port: '5432' },
    'damp-redis':      { label: 'Redis 7',      icon: '&#9672;',  desc: 'cache',          url: '', port: '6379' },
    'damp-phpmyadmin': { label: 'PHPMyAdmin',   icon: '&#128451;', desc: 'dbManagement',  url: 'https://pma.local' },
    'damp-mailpit':    { label: 'Mailpit',      icon: '&#128236;', desc: 'emailTesting',  url: 'https://mail.local' },
    'damp-dashboard':  { label: 'Dashboard',    icon: '&#9673;',  desc: 'DAMP',           url: 'https://damp.local' },
    'damp-dns':        { label: 'DNS',          icon: '&#127760;', desc: 'dns',           url: '' },
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
  return services.map(function(s) {
    var linkStart = s.url ? '<a href="' + s.url + '" target="_blank" style="text-decoration:none;color:inherit;">' : '';
    var linkEnd = s.url ? '</a>' : '';
    return linkStart +
      '<div class="service-card">' +
        '<div class="service-header">' +
          '<span class="service-icon">' + s.icon + '</span>' +
          '<span class="dot ' + s.state + '" style="margin-left:auto;"></span>' +
        '</div>' +
        '<div class="service-name">' + s.label + '</div>' +
        '<div class="service-desc">' + s.desc +
          (s.port ? ' &middot; :' + s.port : '') +
          (s.url ? ' &#8594;' : '') +
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
        '<div class="card stat">' +
          '<div class="stat-value">' + running + '</div>' +
          '<div class="stat-label">' + t('containersRunning') + '</div>' +
        '</div>' +
        '<div class="card stat">' +
          '<div class="stat-value">' + projects.length + '</div>' +
          '<div class="stat-label">' + t('projects') + '</div>' +
        '</div>' +
        '<div class="card stat">' +
          '<div class="stat-value">' + dbs.length + '</div>' +
          '<div class="stat-label">' + t('databases') + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card fade-in">' +
        '<div class="card-header">' +
          '<span class="card-title">' + t('services') + '</span>' +
          '<div class="container-actions">' +
            '<button class="btn btn-sm btn-primary" id="btn-engine-up" onclick="engineAction(\'up\')">&#9654; ' + t('start') + '</button>' +
            '<button class="btn btn-sm btn-danger" id="btn-engine-down" onclick="engineAction(\'down\')">&#9632; ' + t('stop') + '</button>' +
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
          '</div>' +
          '<div id="container-list">' + renderContainerRows(projects) + '</div>' +
        '</div>' +

        '<div class="card fade-in">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('databases') + '</span>' +
          '</div>' +
          '<div style="display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0;">' +
            dbs.map(function(db) {
              return '<span class="badge" style="background: var(--surface-alt); color: var(--text); font-family: SF Mono, monospace; padding: 4px 10px;">' + db + '</span>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#9888;</div>' + t('cannotConnect') + '</div>';
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
