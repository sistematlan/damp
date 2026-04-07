// ── Projects View ─────────────────────────────────────

async function renderProjects(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const [status, templates] = await Promise.all([
      api('/api/status'),
      api('/api/templates'),
    ]);

    const projects = (status.containers || []).filter(c => !c.is_damp);

    el.innerHTML = `
      <div class="fade-in">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Running Projects</span>
          </div>
          <div>
            ${projects.length === 0
              ? '<div class="empty"><div class="empty-icon">&#9881;</div>No projects running<br><span style="font-size:12px; color:var(--text-muted)">Start a project with docker compose up -d</span></div>'
              : renderContainerRows(projects)
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title">Available Templates</span>
          </div>
          <div class="grid-3">
            ${(templates || []).map(t => `
              <div class="template-card">
                <div class="template-name">${t.name}</div>
                <div class="template-desc">${t.description}</div>
              </div>
            `).join('')}
          </div>
          <div style="margin-top: 12px; font-size: 12px; color: var(--text-muted);">
            Create a project: <code style="color: var(--green);">./damp new ${(templates && templates[0]) ? templates[0].name : 'template'} my-project</code>
          </div>
        </div>
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#9888;</div>Cannot load projects</div>';
  }
}
