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
  currentView = path;
  const view = views[path] || views['/'];

  // Update nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('href') === '#' + path);
  });

  // Update title
  document.getElementById('page-title').textContent = view.title;

  // Render
  const container = document.getElementById('view');
  container.innerHTML = '';
  view.render(container);
}

// ── SSE: Real-time container updates ───────────────────
function connectSSE() {
  if (sseConnection) sseConnection.close();

  sseConnection = new EventSource('/api/events');
  sseConnection.onmessage = (event) => {
    try {
      containers = JSON.parse(event.data) || [];
      updateStatusBar();
      // If on overview, update containers
      if (currentView === '/') {
        const el = document.getElementById('container-list');
        if (el) el.innerHTML = renderContainerRows(containers);
      }
    } catch (e) {}
  };
  sseConnection.onerror = () => {
    setTimeout(connectSSE, 5000);
  };
}

function updateStatusBar() {
  const running = containers.filter(c => c.state === 'running').length;
  const indicator = document.getElementById('status-indicator');
  const dot = indicator.querySelector('.dot');
  dot.className = 'dot ' + (running > 0 ? 'running' : 'stopped');
  document.getElementById('container-count').textContent = `${running} containers`;
}

// ── Shared render helpers ──────────────────────────────
function renderContainerRows(list) {
  if (!list || list.length === 0) {
    return '<div class="empty"><div class="empty-icon">&#9898;</div>No containers</div>';
  }
  return list.map(c => `
    <div class="container-row fade-in">
      <div class="container-info">
        <span class="dot ${c.state}"></span>
        <span class="container-name">${c.name}</span>
        ${c.is_damp ? '<span class="badge badge-damp">DAMP</span>' : ''}
        <span class="badge badge-${c.state}">${c.state}</span>
      </div>
      <div class="container-actions">
        ${c.state === 'running'
          ? `<button class="btn-icon danger" onclick="containerAction('${c.name}','stop')" title="Stop">&#9632;</button>
             <button class="btn-icon" onclick="containerAction('${c.name}','restart')" title="Restart">&#8635;</button>`
          : `<button class="btn-icon" onclick="containerAction('${c.name}','start')" title="Start">&#9654;</button>`
        }
      </div>
    </div>
  `).join('');
}

async function containerAction(name, action) {
  try {
    await fetch(`/api/containers/${name}/${action}`, { method: 'POST' });
  } catch (e) {
    console.error(e);
  }
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  return res.json();
}

// ── Init ───────────────────────────────────────────────
window.addEventListener('hashchange', () => {
  const path = location.hash.slice(1) || '/';
  navigate(path);
});

document.addEventListener('DOMContentLoaded', () => {
  connectSSE();
  const path = location.hash.slice(1) || '/';
  navigate(path);
});
