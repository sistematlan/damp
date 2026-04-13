// ── Projects View ─────────────────────────────────────

async function renderProjects(el) {
  el.innerHTML = '<div class="loading">Loading...</div>';

  try {
    var results = await Promise.all([api('/api/projects'), api('/api/templates')]);
    var projects = results[0];
    var templates = results[1];

    el.innerHTML =
      '<div class="fade-in">' +
        // ── New Project ──────────────────────────────────
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

        // ── Adopt Existing Folder ────────────────────────
        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('adoptProject') + '</span>' +
          '</div>' +
          '<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">' +
            t('adoptHint') +
          '</div>' +
          '<div class="input-group">' +
            '<input type="text" class="input" id="adopt-name" placeholder="my-project" style="max-width: 200px;">' +
            '<div style="position:relative;flex:1;display:flex;">' +
              '<input type="text" class="input" id="adopt-path" placeholder="/Users/you/projects/my-project" style="padding-right:36px;">' +
              '<button class="btn-icon" onclick="document.getElementById(\'folder-picker\').click()" title="Browse" style="position:absolute;right:4px;top:4px;border:none;">&#128193;</button>' +
              '<input type="file" id="folder-picker" webkitdirectory style="display:none;" onchange="onFolderPicked(this)">' +
            '</div>' +
            '<select class="input" id="adopt-template" style="max-width: 220px;">' +
              (templates || []).map(function(tp) {
                return '<option value="' + tp.name + '">' + tp.name + '</option>';
              }).join('') +
            '</select>' +
            '<button class="btn btn-primary" id="btn-adopt-project" onclick="adoptProject()">' + t('create') + '</button>' +
          '</div>' +
          '<div id="adopt-project-status" style="display:none;"></div>' +
        '</div>' +

        // ── Project List ─────────────────────────────────
        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('projects') + '</span>' +
            '<button class="btn btn-sm" onclick="renderProjects(document.getElementById(\'view\'))">' + t('refresh') + '</button>' +
          '</div>' +
          '<div id="project-list">' + renderProjectRows(projects) + '</div>' +
        '</div>' +

        // ── Templates ────────────────────────────────────
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
    document.getElementById('adopt-name').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') adoptProject();
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
      refreshProjectList();
    }
  } catch (e) {
    statusEl.innerHTML = '<div style="color:var(--red);padding:8px 0;">' + t('failedCreate') + '</div>';
  }

  btn.disabled = false;
  btn.textContent = t('create');
}

async function adoptProject() {
  var nameInput = document.getElementById('adopt-name');
  var pathInput = document.getElementById('adopt-path');
  var templateSelect = document.getElementById('adopt-template');
  var btn = document.getElementById('btn-adopt-project');
  var statusEl = document.getElementById('adopt-project-status');
  var name = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  var path = pathInput.value.trim();

  if (!name) { nameInput.focus(); return; }

  btn.disabled = true;
  btn.textContent = t('adding');
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
      var pathNote = path ? '<br><span style="color:var(--text-muted);font-size:12px;">' +
        t('scaffoldFiles') + ': <code style="color:var(--green);">cd ' + path + ' && docker compose up -d</code></span>' : '';
      statusEl.innerHTML =
        '<div style="color:var(--green);padding:8px 0;">' +
          '&#10003; <strong>' + result.name + '</strong> &mdash; ' +
          '<a href="https://' + result.domain + '" target="_blank" style="color:var(--green);">' + result.domain + '</a>' +
          ' &middot; DB: <code>' + result.database + '</code>' +
          pathNote +
        '</div>';
      nameInput.value = '';
      pathInput.value = '';
      refreshProjectList();
    }
  } catch (e) {
    statusEl.innerHTML = '<div style="color:var(--red);padding:8px 0;">' + t('failedAdopt') + '</div>';
  }

  btn.disabled = false;
  btn.textContent = t('create');
}

function onFolderPicked(input) {
  if (!input.files || !input.files.length) return;
  // webkitRelativePath gives "foldername/file.ext" — extract the folder name
  var relativePath = input.files[0].webkitRelativePath || '';
  var folderName = relativePath.split('/')[0] || '';
  if (folderName) {
    var nameInput = document.getElementById('adopt-name');
    var pathInput = document.getElementById('adopt-path');
    if (nameInput && !nameInput.value) {
      nameInput.value = folderName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    }
    if (pathInput) {
      pathInput.value = folderName;
      pathInput.placeholder = folderName + ' (selected)';
    }
  }
  // Reset so same folder can be re-selected
  input.value = '';
}

async function refreshProjectList() {
  var projects = await api('/api/projects');
  var listEl = document.getElementById('project-list');
  if (listEl) listEl.innerHTML = renderProjectRows(projects);
}
