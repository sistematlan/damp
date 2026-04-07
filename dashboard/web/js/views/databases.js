// ── Databases View ────────────────────────────────────

async function renderDatabases(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const dbs = await api('/api/databases');

    el.innerHTML = `
      <div class="fade-in">
        <div class="input-group">
          <input type="text" class="input" id="new-db-name" placeholder="new_database_name">
          <button class="btn btn-primary" onclick="createDatabase()">Create Database</button>
        </div>

        <div class="db-grid" id="db-list">
          ${renderDbCards(dbs)}
        </div>
      </div>
    `;

    document.getElementById('new-db-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') createDatabase();
    });
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#9888;</div>Cannot load databases</div>';
  }
}

function renderDbCards(dbs) {
  if (!dbs || dbs.length === 0) {
    return '<div class="empty"><div class="empty-icon">&#9707;</div>No databases yet</div>';
  }
  return dbs.map(db => `
    <div class="db-card">
      <span>${db}</span>
      <button class="db-delete" onclick="dropDatabase('${db}')" title="Drop ${db}">&times;</button>
    </div>
  `).join('');
}

async function createDatabase() {
  const input = document.getElementById('new-db-name');
  const name = input.value.trim();
  if (!name) return;

  try {
    await api('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    input.value = '';
    refreshDatabases();
  } catch (e) {
    console.error(e);
  }
}

async function dropDatabase(name) {
  if (!confirm(`Drop database "${name}"? This cannot be undone.`)) return;

  try {
    await fetch(`/api/databases/${name}`, { method: 'DELETE' });
    refreshDatabases();
  } catch (e) {
    console.error(e);
  }
}

async function refreshDatabases() {
  const dbs = await api('/api/databases');
  const el = document.getElementById('db-list');
  if (el) el.innerHTML = renderDbCards(dbs);
}
