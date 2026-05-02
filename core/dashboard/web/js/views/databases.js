// ── Databases View ────────────────────────────────────

async function renderDatabases(el) {
  // If we already have the structure, just refresh
  if (el.querySelector('#mysql-db-list')) {
    refreshAllDatabases();
    return;
  }

  el.innerHTML = '<div class="loading-box">Loading...</div>';

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
      ? '<div class="stat-value text-green font-16">' + t('connected') + '</div>'
      : '<div class="stat-value text-red font-16">' + t('offline') + '</div>';

    var redisExtra = redis.connected
      ? '<div class="font-11 text-muted mt-4">' + (redis.memory || '') + ' &middot; ' + (redis.keys || '') + '</div>'
      : '';

    el.innerHTML =
      '<div class="fade-in">' +
        '<div class="grid-3 mb-16" id="db-stats">' +
          renderStatCard(mysqlDbs.length, t('mysqlDatabases'), 'mysql-stat') +
          renderStatCard(pgDbs.length, t('postgresDatabases'), 'pg-stat') +
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
            '<select class="input w-160" id="db-engine">' +
              '<option value="mysql">MySQL</option>' +
              '<option value="postgres">PostgreSQL</option>' +
            '</select>' +
            '<button class="btn btn-primary" id="btn-create-db" onclick="createDatabase()">' + t('create') + '</button>' +
          '</div>' +
        '</div>' +

        '<div class="grid-2">' +
          '<div class="card">' +
            '<div class="card-header">' +
              '<span class="card-title">MySQL</span>' +
              '<span class="badge badge-muted mysql-count">' + mysqlDbs.length + '</span>' +
            '</div>' +
            '<div class="db-grid" id="mysql-db-list">' + renderDbCards(mysqlDbs, 'mysql') + '</div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-header">' +
              '<span class="card-title">PostgreSQL</span>' +
              '<span class="badge badge-muted pg-count">' + pgDbs.length + '</span>' +
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

function renderStatCard(value, label, className) {
  return '<div class="card stat ' + className + '">' +
    '<div class="stat-value">' + value + '</div>' +
    '<div class="stat-label">' + label + '</div>' +
  '</div>';
}

function renderDbCards(dbs, engine) {
  if (!dbs || dbs.length === 0) {
    return '<div class="empty p-20"><div class="empty-icon">&#9707;</div>' + t('noDatabases') + '</div>';
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
  var btn = document.getElementById('btn-create-db');
  var name = input.value.trim();
  if (!name) return;

  var origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('creating');

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
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
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
  try {
    var results = await Promise.all([
      api('/api/databases'),
      api('/api/databases?engine=postgres').catch(function() { return []; }),
    ]);
    
    var mysqlDbs = results[0] || [];
    var pgDbs = results[1] || [];

    // Update lists
    var mysqlEl = document.getElementById('mysql-db-list');
    var pgEl = document.getElementById('pg-db-list');
    if (mysqlEl) mysqlEl.innerHTML = renderDbCards(mysqlDbs, 'mysql');
    if (pgEl) pgEl.innerHTML = renderDbCards(pgDbs, 'postgres');

    // Update stats (F18)
    var mysqlStat = document.querySelector('.mysql-stat .stat-value');
    var pgStat = document.querySelector('.pg-stat .stat-value');
    if (mysqlStat) mysqlStat.textContent = mysqlDbs.length;
    if (pgStat) pgStat.textContent = pgDbs.length;

    var mysqlCount = document.querySelector('.mysql-count');
    var pgCount = document.querySelector('.pg-count');
    if (mysqlCount) mysqlCount.textContent = mysqlDbs.length;
    if (pgCount) pgCount.textContent = pgDbs.length;
  } catch (e) {
    console.error('Refresh failed:', e);
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
