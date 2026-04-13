// ── Overview View ──────────────────────────────────────

async function renderOverview(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    var data = await api('/api/status');
    var dampServices = (data.containers || []).filter(function(c) { return c.is_damp; });
    var projects = (data.containers || []).filter(function(c) { return !c.is_damp; });
    var running = (data.containers || []).filter(function(c) { return c.state === 'running'; }).length;
    var dbs = data.databases || [];

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

      '<div class="grid-2">' +
        '<div>' +
          '<div class="card fade-in">' +
            '<div class="card-header">' +
              '<span class="card-title">' + t('dampEngine') + '</span>' +
              '<div class="container-actions">' +
                '<button class="btn btn-sm btn-primary" id="btn-engine-up" onclick="engineAction(\'up\')">&#9654; ' + t('start') + '</button>' +
                '<button class="btn btn-sm btn-danger" id="btn-engine-down" onclick="engineAction(\'down\')">&#9632; ' + t('stop') + '</button>' +
              '</div>' +
            '</div>' +
            '<div id="damp-services">' + renderContainerRows(dampServices) + '</div>' +
          '</div>' +

          '<div class="card fade-in">' +
            '<div class="card-header">' +
              '<span class="card-title">' + t('projects') + '</span>' +
            '</div>' +
            '<div id="container-list">' + renderContainerRows(projects) + '</div>' +
          '</div>' +
        '</div>' +

        '<div>' +
          '<div class="card fade-in">' +
            '<div class="card-header">' +
              '<span class="card-title">' + t('quickAccess') + '</span>' +
            '</div>' +
            '<a href="https://pma.local" target="_blank" class="container-row" style="text-decoration: none; color: var(--text);">' +
              '<div class="container-info">' +
                '<span style="font-size: 18px;">&#128451;</span>' +
                '<span class="container-name">PHPMyAdmin</span>' +
              '</div>' +
              '<span style="color: var(--text-muted);">&#8594;</span>' +
            '</a>' +
            '<a href="https://mail.local" target="_blank" class="container-row" style="text-decoration: none; color: var(--text);">' +
              '<div class="container-info">' +
                '<span style="font-size: 18px;">&#128236;</span>' +
                '<span class="container-name">Mailpit</span>' +
              '</div>' +
              '<span style="color: var(--text-muted);">&#8594;</span>' +
            '</a>' +
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
