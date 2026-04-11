// ── Overview View ──────────────────────────────────────

async function renderOverview(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const data = await api('/api/status');
    const dampServices = (data.containers || []).filter(c => c.is_damp);
    const projects = (data.containers || []).filter(c => !c.is_damp);
    const running = (data.containers || []).filter(c => c.state === 'running').length;
    const dbs = data.databases || [];

    el.innerHTML = `
      <div class="grid-3 fade-in" style="margin-bottom: 24px;">
        <div class="card stat">
          <div class="stat-value">${running}</div>
          <div class="stat-label">Containers Running</div>
        </div>
        <div class="card stat">
          <div class="stat-value">${projects.length}</div>
          <div class="stat-label">Projects</div>
        </div>
        <div class="card stat">
          <div class="stat-value">${dbs.length}</div>
          <div class="stat-label">Databases</div>
        </div>
      </div>

      <div class="grid-2">
        <div>
          <div class="card fade-in">
            <div class="card-header">
              <span class="card-title">DAMP Services</span>
            </div>
            <div id="damp-services">
              ${renderContainerRows(dampServices)}
            </div>
          </div>

          <div class="card fade-in">
            <div class="card-header">
              <span class="card-title">Projects</span>
            </div>
            <div id="container-list">
              ${renderContainerRows(projects)}
            </div>
          </div>
        </div>

        <div>
          <div class="card fade-in">
            <div class="card-header">
              <span class="card-title">Quick Access</span>
            </div>
            <a href="http://localhost:8080" target="_blank" class="container-row" style="text-decoration: none; color: var(--text);">
              <div class="container-info">
                <span style="font-size: 18px;">&#128451;</span>
                <span class="container-name">PHPMyAdmin</span>
              </div>
              <span style="color: var(--text-muted);">&#8594;</span>
            </a>
            <a href="http://localhost:8025" target="_blank" class="container-row" style="text-decoration: none; color: var(--text);">
              <div class="container-info">
                <span style="font-size: 18px;">&#128236;</span>
                <span class="container-name">Mailpit</span>
              </div>
              <span style="color: var(--text-muted);">&#8594;</span>
            </a>
          </div>

          <div class="card fade-in">
            <div class="card-header">
              <span class="card-title">Databases</span>
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0;">
              ${dbs.map(db => `<span class="badge" style="background: var(--surface-alt); color: var(--text); font-family: 'SF Mono', monospace; padding: 4px 10px;">${db}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#9888;</div>Cannot connect to DAMP API</div>';
  }
}
