// ── DAMP Dashboard — SPA Router + SSE ──────────────────

const views = {
  '/': { title: 'Overview', render: renderOverview },
  '/projects': { title: 'Projects', render: renderProjects },
  '/databases': { title: 'Databases', render: renderDatabases },
  '/logs': { title: 'Logs', render: renderLogs },
};

let currentView = '/';
let sseConnection = null;
let containers = [];

// ── Router ─────────────────────────────────────────────
function navigate(path) {
  const isInitialLoad = !currentView;
  currentView = path;
  const view = views[path] || views['/'];

  // Update nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('href') === '#' + path);
  });

  // Update title
  document.getElementById('page-title').textContent = view.title;

  // Render without clearing if not initial to prevent flicker
  const container = document.getElementById('view');
  view.render(container);
}

// ── SSE: Real-time container updates ───────────────────
function connectSSE() {
  if (sseConnection) sseConnection.close();

  sseConnection = new EventSource('/api/events');
  
  sseConnection.addEventListener('container-status', (event) => {
    try {
      containers = JSON.parse(event.data) || [];
      updateStatusBar();
      // If on overview, update containers
      if (currentView === '/') {
        const el = document.getElementById('container-list');
        if (el) el.innerHTML = renderContainerRows(containers);
      }
    } catch (e) {
      console.error('SSE JSON parse error:', e);
    }
  });

  sseConnection.addEventListener('error', (event) => {
    console.error('SSE Error event:', event.data);
  });

  sseConnection.onerror = () => {
    sseConnection.close();
    // Reconnect with fixed 5s delay (P2 fix: F20 exponential backoff could be added later)
    setTimeout(connectSSE, 5000);
  };
}

function updateStatusBar() {
  var running = containers.filter(function(c) { return c.state === 'running'; }).length;
  var indicator = document.getElementById('status-indicator');
  if (!indicator) return;
  var dot = indicator.querySelector('.dot');
  dot.className = 'dot ' + (running > 0 ? 'running' : 'stopped');
  document.getElementById('container-count').textContent = running + ' ' + t('containers');
}

// ── Shared render helpers ──────────────────────────────
function renderContainerRows(list) {
  if (!list || list.length === 0) {
    return '<div class="empty"><div class="empty-icon">📦</div><div class="empty-text">' + t('no_containers') + '</div></div>';
  }
  return list.map(function(c, i) {
    return '<div class="container-row fade-in stagger-' + (i + 1) + '" data-container="' + c.name + '" onclick="containerAction(\'' + c.name + '\', \'' + (c.state === 'running' ? 'stop' : 'start') + '\')">' +
      '<div class="container-info">' +
        '<span class="dot ' + c.state + '" data-status="' + c.state + '"></span>' +
        '<div>' +
          '<div class="container-name">' + c.name + '</div>' +
          '<div class="container-meta">' + (c.state === 'running' ? '● ' + t('active') : '○ ' + t('stopped')) + '</div>' +
        '</div>' +
        (c.is_damp ? '<span class="badge badge-damp">DAMP</span>' : '') +
      '</div>' +
      '<span class="badge badge-' + c.state + '">' + t(c.state) + '</span>' +
    '</div>';
  }).join('');
}

async function containerAction(name, action) {
  try {
    const res = await fetch('/api/containers/' + name + '/' + action, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      console.error('Container action failed:', err.error);
    }
  } catch (e) {
    console.error(e);
  }
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    let msg = 'API error';
    try {
      const err = await res.json();
      msg = err.error || msg;
    } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

// ── Init ───────────────────────────────────────────────
window.addEventListener('hashchange', () => {
  const path = location.hash.slice(1) || '/';
  navigate(path);
});

document.addEventListener('DOMContentLoaded', function() {
  connectSSE();
  // Apply saved language
  var savedLang = localStorage.getItem('damp-lang') || 'en';
  if (savedLang !== 'en') setLang(savedLang);
  var path = location.hash.slice(1) || '/';
  navigate(path);
});