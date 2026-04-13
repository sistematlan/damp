// ── Databases View ────────────────────────────────────

async function renderDatabases(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    var results = await Promise.all([
      api('/api/databases'),
      api('/api/databases?engine=postgres').catch(function() { return []; }),
      api('/api/redis').catch(function() { return { connected: false }; }),
    ]);
    var mysqlDbs = results[0] || [];
    var pgDbs = results[1] || [];
    var redis = results[2];

    var redisStatus = redis.connected
      ? '<div class="stat-value" style="color: var(--green); font-size: 16px;">' + t('connected') + '</div>'
      : '<div class="stat-value" style="color: var(--red); font-size: 16px;">' + t('offline') + '</div>';

    var redisExtra = redis.connected
      ? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">' + (redis.memory || '') + ' &middot; ' + (redis.keys || '') + '</div>'
      : '';

    el.innerHTML =
      '<div class="fade-in">' +
        '<div class="grid-3" style="margin-bottom: 16px;">' +
          '<div class="card stat">' +
            '<div class="stat-value">' + mysqlDbs.length + '</div>' +
            '<div class="stat-label">' + t('mysqlDatabases') + '</div>' +
          '</div>' +
          '<div class="card stat">' +
            '<div class="stat-value">' + pgDbs.length + '</div>' +
            '<div class="stat-label">' + t('postgresDatabases') + '</div>' +
          '</div>' +
          '<div class="card stat">' +
            redisStatus +
            '<div class="stat-label">Redis ' + (redis.version ? 'v' + redis.version : '') + '</div>' +
            redisExtra +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('createDatabase') + '</span>' +
          '</div>' +
          '<div class="input-group">' +
            '<input type="text" class="input" id="new-db-name" placeholder="new_database_name">' +
            '<select class="input" id="db-engine" style="max-width: 160px;">' +
              '<option value="mysql">MySQL</option>' +
              '<option value="postgres">PostgreSQL</option>' +
            '</select>' +
            '<button class="btn btn-primary" onclick="createDatabase()">' + t('create') + '</button>' +
          '</div>' +
        '</div>' +

        '<div class="grid-2">' +
          '<div class="card">' +
            '<div class="card-header">' +
              '<span class="card-title">MySQL</span>' +
              '<span class="badge" style="background:var(--surface-alt);color:var(--text-muted);">' + mysqlDbs.length + '</span>' +
            '</div>' +
            '<div class="db-grid" id="mysql-db-list">' + renderDbCards(mysqlDbs, 'mysql') + '</div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-header">' +
              '<span class="card-title">PostgreSQL</span>' +
              '<span class="badge" style="background:var(--surface-alt);color:var(--text-muted);">' + pgDbs.length + '</span>' +
            '</div>' +
            '<div class="db-grid" id="pg-db-list">' + renderDbCards(pgDbs, 'postgres') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('new-db-name').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') createDatabase();
    });
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#9888;</div>' + t('cannotLoad') + '</div>';
  }
}

function renderDbCards(dbs, engine) {
  if (!dbs || dbs.length === 0) {
    return '<div class="empty" style="padding:20px;"><div class="empty-icon">&#9707;</div>' + t('noDatabases') + '</div>';
  }
  return dbs.map(function(db) {
    return '<div class="db-card">' +
      '<span>' + db + '</span>' +
      '<button class="db-delete" onclick="dropDatabase(\'' + db + '\',\'' + engine + '\')" title="Drop ' + db + '">&times;</button>' +
    '</div>';
  }).join('');
}

async function createDatabase() {
  var input = document.getElementById('new-db-name');
  var engine = document.getElementById('db-engine').value;
  var name = input.value.trim();
  if (!name) return;

  try {
    await api('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, engine: engine }),
    });
    input.value = '';
    refreshAllDatabases();
  } catch (e) {
    console.error(e);
  }
}

async function dropDatabase(name, engine) {
  if (!confirm('Drop database "' + name + '"?')) return;

  try {
    await fetch('/api/databases/' + name + '?engine=' + engine, { method: 'DELETE' });
    refreshAllDatabases();
  } catch (e) {
    console.error(e);
  }
}

async function refreshAllDatabases() {
  var results = await Promise.all([
    api('/api/databases'),
    api('/api/databases?engine=postgres').catch(function() { return []; }),
  ]);
  var mysqlEl = document.getElementById('mysql-db-list');
  var pgEl = document.getElementById('pg-db-list');
  if (mysqlEl) mysqlEl.innerHTML = renderDbCards(results[0], 'mysql');
  if (pgEl) pgEl.innerHTML = renderDbCards(results[1], 'postgres');
}
