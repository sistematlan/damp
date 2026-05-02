// ── Projects View ─────────────────────────────────────

async function renderProjects(el) {
  if (el.querySelector('#project-list')) {
    refreshProjectList();
    return;
  }

  el.innerHTML = '<div class="loading-box">Loading...</div>';

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
              '<input type="text" class="input w-200" id="project-name" placeholder="my-project">' +
              '<select class="input w-280" id="project-template">' +
                (templates || []).map(function(tp) {
                  return '<option value="' + tp.name + '">' + tp.name + ' — ' + tp.description + '</option>';
                }).join('') +
              '</select>' +
              '<button class="btn btn-primary" id="btn-create-project" onclick="createProject()">' + t('create') + '</button>' +
            '</div>' +
            '<div class="font-12 opacity-50 mt-4">' +
              t('scaffoldHint') + ' <code class="text-green">damp new &lt;name&gt;</code> · ' + t('existingHint') + ' <code class="text-green">damp init [name]</code>' +
            '</div>' +
          '</div>' +
          '<div id="create-project-status" class="hidden"></div>' +
        '</div>' +

        // ── Adopt Existing Folder ────────────────────────
        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('adoptProject') + '</span>' +
          '</div>' +
          '<div class="font-12 opacity-50 mb-8">' +
            t('adoptHint') +
          '</div>' +
          '<div class="input-group">' +
            '<input type="text" class="input w-200" id="adopt-name" placeholder="my-project">' +
            '<div class="flex-grow-1 flex-gap-4">' +
              '<input type="text" class="input flex-1" id="adopt-path" placeholder="/home/you/projects/my-project" readonly>' +
              '<button class="btn btn-sm flex-shrink-0" onclick="openFolderBrowser()">&#128193; Browse</button>' +
            '</div>' +
            '<select class="input w-220" id="adopt-template">' +
              (templates || []).map(function(tp) {
                return '<option value="' + tp.name + '">' + tp.name + '</option>';
              }).join('') +
            '</select>' +
            '<button class="btn btn-primary" id="btn-adopt-project" onclick="adoptProject()">' + t('create') + '</button>' +
          '</div>' +
          '<div id="adopt-preview" class="hidden project-preview-box"></div>' +
          '<div id="adopt-project-status" class="hidden"></div>' +
        '</div>' +

        // ── Project List ─────────────────────────────────
        '<div class="card">' +
          '<div class="card-header">' +
            '<span class="card-title">' + t('projects') + '</span>' +
            '<button class="btn btn-sm" onclick="refreshProjectList()">' + t('refresh') + '</button>' +
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
    document.getElementById('adopt-name').addEventListener('input', updateAdoptPreview);
    document.getElementById('adopt-template').addEventListener('change', updateAdoptPreview);
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
      '<br><span class="font-12 opacity-50">' + t('noProjectsHint') + '</span></div>';
  }
  
  return projects.map(function(p) {
    var actions = '';
    var statusClass = p.status === 'running' ? 'running' : p.status === 'starting' ? 'starting' : 'stopped';
    var statusLabel = p.status === 'starting' ? t('starting') : p.status;
    if (p.status === 'created') statusLabel = 'pending';
    
    var healthTag = '';
    if (p.health && p.health !== 'ok') {
      var healthColor = p.health === 'broken_path' || p.health === 'unlinked' ? '#ef4444' : '#f59e0b';
      var healthLabel = t(p.health === 'broken_path' ? 'folderNotFound' : p.health === 'missing_compose' ? 'missingCompose' : 'unlinked');
      healthTag = '<span class="badge" style="background:rgba(239,68,68,0.1);color:' + healthColor + ';border:1px solid ' + healthColor + '40;margin-left:8px;">⚠️ ' + healthLabel + '</span>';
      
      // Add fix button
      actions += '<button class="btn-icon" onclick="repairProject(\'' + p.name + '\')" title="' + t('fixProject') + '">🛠️</button>';
    }

    if (p.status === 'running') {
      actions +=
        '<button class="btn-icon danger" onclick="projectAction(\'' + p.name + '\',\'stop\')" title="' + t('stop') + '">&#9632;</button>' +
        '<button class="btn-icon" onclick="projectAction(\'' + p.name + '\',\'restart\')" title="Restart">&#8635;</button>' +
        '<a href="https://' + p.domain + '" target="_blank" class="btn btn-sm ml-4 no-underline">' + p.domain + ' &#8594;</a>';
    } else if (p.status === 'stopped' || p.status === 'created') {
      actions += '<button class="btn-icon" onclick="projectAction(\'' + p.name + '\',\'start\')" title="' + t('start') + '">&#9654;</button>';
      if (p.status === 'stopped') {
        actions += '<span class="btn btn-sm opacity-40">' + p.domain + '</span>';
      } else {
        // Interative Button instead of plain text
        actions += '<button class="btn btn-sm btn-outline ml-4" onclick="repairProject(\'' + p.name + '\')" title="Initialize Files">' +
          '<span class="opacity-50">damp new</span> ' + p.name + '</button>';
      }
    } else if (p.status === 'starting') {
      actions += '<span class="font-11 opacity-50">' + t('starting') + '</span>';
    }

    actions += '<button class="btn-icon danger ml-4" onclick="deleteProject(\'' + p.name + '\')" title="Delete">&#128465;</button>';

    return '<div class="container-row fade-in">' +
      '<div class="container-info">' +
        '<span class="dot ' + statusClass + '"></span>' +
        '<span class="container-name">' + p.name + '</span>' +
        '<span class="badge badge-' + statusClass + '">' + statusLabel + '</span>' +
        healthTag +
      '</div>' +
      '<div class="container-actions">' + actions + '</div>' +
    '</div>';
  }).join('');
}

async function projectAction(name, action) {
  try {
    const res = await fetch('/api/projects/' + name + '/' + action, { method: 'POST' });
    
    if (res.status === 428) { // path_required
      const message = 'Project "' + name + '" is not linked to a folder. \n\nWould you like to select the project folder now to start it?';
      if (confirm(message)) {
        window._linkingProject = name;
        openFolderBrowser();
      }
      return;
    }

    if (!res.ok) {
      const err = await res.json();
      alert('Error: ' + err.error);
      return;
    }

    setTimeout(refreshProjectList, 1500);
  } catch (e) {
    console.error(e);
  }
}

async function repairProject(name) {
  const message = 'Project "' + name + '" requires attention.\n\nWould you like to link/re-link its folder to fix the connection?';
  if (confirm(message)) {
    window._linkingProject = name;
    openFolderBrowser();
  }
}

function selectTemplate(name) {
  var select = document.getElementById('project-template');
  if (select) select.value = name;
  document.getElementById('project-name').focus();
}

function updateAdoptPreview() {
  var nameInput = document.getElementById('adopt-name');
  var templateSelect = document.getElementById('adopt-template');
  var previewEl = document.getElementById('adopt-preview');
  
  var name = nameInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  var template = templateSelect ? templateSelect.value : 'php-fpm';
  
  if (!name) {
    previewEl.classList.add('hidden');
    return;
  }
  
  var dbName = name.replace(/-/g, '_') + '_db';
  var domain = name + '.test';
  var webContainer = name + '-web';
  var appContainer = name + '-app';
  
  var isPhpFpm = template === 'php-fpm' || template === 'php-legacy' || template === 'php-ancient';
  var webServer = isPhpFpm ? webContainer + ':80 (Nginx)' : appContainer + ':80';
  
  previewEl.innerHTML = 
    '<div class="preview-title">Project Preview</div>' +
    '<div class="preview-grid">' +
      '<div><span class="opacity-50">Domain:</span> <code class="text-accent">' + domain + '</code></div>' +
      '<div><span class="opacity-50">Database:</span> <code class="text-accent">' + dbName + '</code></div>' +
      '<div><span class="opacity-50">App:</span> <code>' + appContainer + '</code></div>' +
      (isPhpFpm ? '<div><span class="opacity-50">Web:</span> <code>' + webContainer + '</code></div>' : '') +
      '<div class="grid-col-all"><span class="opacity-50">Proxy Target:</span> <code class="text-green">' + webServer + '</code></div>' +
    '</div>';
  previewEl.classList.remove('remove');
  previewEl.classList.remove('hidden');
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
  statusEl.classList.remove('hidden');
  statusEl.innerHTML = '<div class="loading-inline text-muted py-8">' + t('creatingDbCaddy') + '</div>';

  try {
    var result = await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, template: templateSelect.value }),
    });

    if (result.error) {
      statusEl.innerHTML = '<div class="text-red py-8">' + t('error') + ': ' + result.error + '</div>';
    } else {
      statusEl.innerHTML =
        '<div class="text-green py-8">' +
          '&#10003; <strong>' + result.name + '</strong> &mdash; ' +
          '<a href="https://' + result.domain + '" target="_blank" class="text-green">' + result.domain + '</a>' +
          ' &middot; DB: <code>' + result.database + '</code>' +
          '<br><span class="text-muted font-12">' + t('scaffoldFiles') + ': <code class="text-green">damp new ' + templateSelect.value + ' ' + name + '</code></span>' +
        '</div>';
      nameInput.value = '';
      refreshProjectList();
    }
  } catch (e) {
    statusEl.innerHTML = '<div class="text-red py-8">' + t('failedCreate') + '</div>';
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
  if (!path) { alert(t('please_select_folder')); return; }

  btn.disabled = true;
  btn.textContent = t('adding');
  statusEl.classList.remove('hidden');
  statusEl.innerHTML = '<div class="text-muted py-8"><div class="loading-spinner"></div>Creating project configuration...</div>';

  try {
    var result = await api('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, template: templateSelect.value, path: path }),
    });

    if (result.error) {
      statusEl.innerHTML = '<div class="text-red py-8">' + t('error') + ': ' + result.error + '</div>';
    } else {
      statusEl.innerHTML = '<div class="text-green py-8">✓ <strong>' + result.name + '</strong> linked successfully.</div>';
      nameInput.value = '';
      pathInput.value = '';
      refreshProjectList();
    }
  } catch (e) {
    statusEl.innerHTML = '<div class="text-red py-8">' + t('failedAdopt') + '</div>';
  }

  btn.disabled = false;
  btn.textContent = t('create');
}

async function openFolderBrowser() {
  var homeData = await api('/api/home');
  var startPath = homeData.parent || '/';

  var modal = document.createElement('div');
  modal.id = 'folder-modal';
  modal.innerHTML =
    '<div class="modal-overlay" onclick="closeFolderBrowser()">' +
      '<div class="modal-content" onclick="event.stopPropagation()">' +
        '<div class="modal-header">' +
          '<span class="card-title">' + t('select_folder') + '</span>' +
          '<button class="btn-icon" onclick="closeFolderBrowser()">&times;</button>' +
        '</div>' +
        '<div class="modal-path" id="browser-path">' + startPath + '</div>' +
        '<div class="modal-list" id="browser-list"><div class="loading-box">Loading...</div></div>' +
        '<div class="modal-footer">' +
          '<button class="btn" onclick="closeFolderBrowser()">' + t('cancel') + '</button>' +
          '<button class="btn btn-primary" onclick="selectCurrentFolder()">' + t('select_this_folder') + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  browseTo(startPath);
}

function closeFolderBrowser() {
  var modal = document.getElementById('folder-modal');
  if (modal) modal.remove();
  window._linkingProject = null;
}

async function browseTo(path) {
  var listEl = document.getElementById('browser-list');
  var pathEl = document.getElementById('browser-path');
  if (!listEl) return;

  listEl.innerHTML = '<div class="loading-box">Loading...</div>';
  pathEl.textContent = path;

  try {
    var data = await api('/api/browse?path=' + encodeURIComponent(path));
    var entries = data.entries || [];
    var html = '';
    var pathParts = path.split('/').filter(Boolean);
    if (pathParts.length > 1) {
      var parent = '/' + pathParts.slice(0, -1).join('/');
      html += '<div class="browser-item" onclick="browseTo(\'' + parent + '\')"><span>&#128194;</span> ..</div>';
    }
    if (entries.length === 0) html += '<div class="p-12 text-muted font-12">' + t('empty_directory') + '</div>';

    entries.forEach(function(e) {
      var fullPath = path + '/' + e.name;
      html += '<div class="browser-item" onclick="browseTo(\'' + fullPath + '\')"><span>&#128193;</span> ' + e.name + '</div>';
    });
    listEl.innerHTML = html;
  } catch (err) {
    listEl.innerHTML = '<div class="p-12 text-red">Cannot read directory</div>';
  }
}

async function selectCurrentFolder() {
  var selectedPath = document.getElementById('browser-path').textContent;
  var name = window._linkingProject;

  if (name) {
    // We are linking an existing listed project
    try {
      var templateRes = await api('/api/detect-template?path=' + encodeURIComponent(selectedPath));
      var template = templateRes.template || 'php-fpm';
      
      await api('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, template: template, path: selectedPath }),
      });
      
      closeFolderBrowser();
      refreshProjectList();
    } catch (e) {
      alert('Failed to link: ' + e.message);
    }
  } else {
    // We are filling the "Adopt" form
    document.getElementById('adopt-path').value = selectedPath;
    var folderName = selectedPath.split('/').pop().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!document.getElementById('adopt-name').value) {
      document.getElementById('adopt-name').value = folderName;
    }
    closeFolderBrowser();
    updateAdoptPreview();
  }
}

async function deleteProject(name) {
  if (!confirm('Delete project "' + name + '"?\n\nFiles will NOT be deleted.')) return;
  try {
    await fetch('/api/projects/' + name, { method: 'DELETE' });
    refreshProjectList();
  } catch (e) { console.error(e); }
}

async function refreshProjectList() {
  try {
    var projects = await api('/api/projects');
    var listEl = document.getElementById('project-list');
    if (listEl) listEl.innerHTML = renderProjectRows(projects);
  } catch (e) { console.error(e); }
}
