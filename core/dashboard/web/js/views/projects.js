// ── Projects View ─────────────────────────────────────

async function renderProjects(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    var results = await Promise.all([api('/api/projects'), api('/api/templates')]);
    var projects = results[0];
    var templates = results[1];

    el.innerHTML =
      '<div class="fade-in">' +
        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('newProject') + '</span>' +
          '</div>' +
          '<div id="create-project-form">' +
            '<div class="input-group">' +
              '<input type="text" class="input" id="project-name" placeholder="my-project" style="max-width: 200px;">' +
              '<select class="input" id="project-template" style="max-width: 280px;">' +
                (templates || []).map(function(tp) {
                  return '<option value="' + tp.name + '">' + tp.name + ' — ' + tp.description + '</option>';
                }).join('') +
              '</select>' +
              '<button class="btn btn-primary" id="btn-create-project" onclick="createProject()">' + t('create') + '</button>' +
            '</div>' +
            '<div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">' +
              t('scaffoldHint') + ' <code style="color: var(--green);">damp new &lt;template&gt; &lt;name&gt;</code>' +
            '</div>' +
          '</div>' +
          '<div id="create-project-status" style="display:none;"></div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('projects') + '</span>' +
            '<button class="btn btn-sm" onclick="renderProjects(document.getElementById(\'view\'))">' + t('refresh') + '</button>' +
          '</div>' +
          '<div id="project-list">' + renderProjectRows(projects) + '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('templates') + '</span>' +
          '</div>' +
          '<div class="grid-3">' +
            (templates || []).map(function(tp) {
              return '<div class="template-card" onclick="selectTemplate(\'' + tp.name + '\')">' +
                '<div class="template-name">' + tp.name + '</div>' +
                '<div class="template-desc">' + tp.description + '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('project-name').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') createProject();
    });
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#9888;</div>' + t('cannotLoad') + '</div>';
  }
}

function renderProjectRows(projects) {
  if (!projects || projects.length === 0) {
    return '<div class="empty"><div class="empty-icon">&#9881;</div>' + t('noProjects') +
      '<br><span style="font-size:12px; color:var(--text-muted)">' + t('noProjectsHint') + '</span></div>';
  }
  return projects.map(function(p) {
    return '<div class="container-row fade-in">' +
      '<div class="container-info">' +
        '<span class="dot ' + p.status + '"></span>' +
        '<span class="container-name">' + p.name + '</span>' +
        '<span class="badge badge-' + p.status + '">' + p.status + '</span>' +
      '</div>' +
      '<div class="container-actions">' +
        '<a href="https://' + p.domain + '" target="_blank" class="btn btn-sm" style="text-decoration:none;">' + p.domain + ' &#8594;</a>' +
      '</div>' +
    '</div>';
  }).join('');
}

function selectTemplate(name) {
  var select = document.getElementById('project-template');
  if (select) select.value = name;
  document.getElementById('project-name').focus();
}

async function createProject() {
  var nameInput = document.getElementById('project-name');
  var templateSelect = document.getElementById('project-template');
  var btn = document.getElementById('btn-create-project');
  var statusEl = document.getElementById('create-project-status');
  var name = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (!name) { nameInput.focus(); return; }

  btn.disabled = true;
  btn.textContent = t('creating');
  statusEl.style.display = 'block';
  statusEl.innerHTML = '<div class="loading" style="color:var(--text-muted);padding:8px 0;">' + t('creatingDbCaddy') + '</div>';

  try {
    var result = await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, template: templateSelect.value }),
    });

    if (result.error) {
      statusEl.innerHTML = '<div style="color:var(--red);padding:8px 0;">' + t('error') + ': ' + result.error + '</div>';
    } else {
      statusEl.innerHTML =
        '<div style="color:var(--green);padding:8px 0;">' +
          '&#10003; <strong>' + result.name + '</strong> &mdash; ' +
          '<a href="https://' + result.domain + '" target="_blank" style="color:var(--green);">' + result.domain + '</a>' +
          ' &middot; DB: <code>' + result.database + '</code>' +
          '<br><span style="color:var(--text-muted);font-size:12px;">' + t('scaffoldFiles') + ': <code style="color:var(--green);">damp new ' + templateSelect.value + ' ' + name + '</code></span>' +
        '</div>';
      nameInput.value = '';
      var projects = await api('/api/projects');
      var listEl = document.getElementById('project-list');
      if (listEl) listEl.innerHTML = renderProjectRows(projects);
    }
  } catch (e) {
    statusEl.innerHTML = '<div style="color:var(--red);padding:8px 0;">' + t('failedCreate') + '</div>';
  }

  btn.disabled = false;
  btn.textContent = t('create');
}
