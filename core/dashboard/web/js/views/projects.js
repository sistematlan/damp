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
              t('scaffoldHint') + ' <code style="color: var(--green);">damp new &lt;name&gt;</code> · ' + t('existingHint') + ' <code style="color: var(--green);">damp init [name]</code>' +
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
            '<div style="display:flex;gap:4px;flex:1;align-items:center;">' +
              '<input type="text" class="input" id="adopt-path" placeholder="/home/you/projects/my-project" style="flex:1;" readonly>' +
              '<button class="btn btn-sm" onclick="openFolderBrowser()" style="flex-shrink:0;">&#128193; Browse</button>' +
            '</div>' +
            '<select class="input" id="adopt-template" style="max-width: 220px;">' +
              (templates || []).map(function(tp) {
                return '<option value="' + tp.name + '">' + tp.name + '</option>';
              }).join('') +
            '</select>' +
            '<button class="btn btn-primary" id="btn-adopt-project" onclick="adoptProject()">' + t('create') + '</button>' +
          '</div>' +
          '<div id="adopt-preview" style="display:none; margin-bottom: 12px; padding: 12px; background: var(--bg); border-radius: var(--radius); border: 1px solid var(--border);">' +
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
      '<br><span style="font-size:12px; color:var(--text-muted)">' + t('noProjectsHint') + '</span></div>';
  }
  return projects.map(function(p) {
    var actions = '';
    var statusClass = p.status === 'running' ? 'running' : 'stopped';
    var statusLabel = p.status;

    if (p.status === 'running') {
      actions =
        '<button class="btn-icon danger" onclick="projectAction(\'' + p.name + '\',\'stop\')" title="' + t('stop') + '">&#9632;</button>' +
        '<button class="btn-icon" onclick="projectAction(\'' + p.name + '\',\'restart\')" title="Restart">&#8635;</button>' +
        '<a href="https://' + p.domain + '" target="_blank" class="btn btn-sm" style="text-decoration:none;margin-left:4px;">' + p.domain + ' &#8594;</a>' +
        '<button class="btn-icon danger" onclick="deleteProject(\'' + p.name + '\')" title="Delete" style="margin-left:4px;">&#128465;</button>';
    } else if (p.status === 'stopped') {
      // Containers exist but are stopped — can start
      actions =
        '<button class="btn-icon" onclick="projectAction(\'' + p.name + '\',\'start\')" title="' + t('start') + '">&#9654;</button>' +
        '<span class="btn btn-sm" style="opacity:0.4;">' + p.domain + '</span>' +
        '<button class="btn-icon danger" onclick="deleteProject(\'' + p.name + '\')" title="Delete" style="margin-left:4px;">&#128465;</button>';
    } else {
      // "created" — config exists but no containers yet
      statusLabel = 'pending';
      actions =
        '<button class="btn-icon" onclick="projectAction(\'' + p.name + '\',\'start\')" title="' + t('start') + '">&#9654;</button>' +
        '<code style="font-size:11px;color:var(--text-muted);background:var(--surface-alt);padding:2px 8px;border-radius:4px;">damp new ' + p.name + '</code>' +
        '<button class="btn-icon danger" onclick="deleteProject(\'' + p.name + '\')" title="Delete" style="margin-left:4px;">&#128465;</button>';
    }
    return '<div class="container-row fade-in">' +
      '<div class="container-info">' +
        '<span class="dot ' + statusClass + '"></span>' +
        '<span class="container-name">' + p.name + '</span>' +
        '<span class="badge badge-' + statusClass + '">' + statusLabel + '</span>' +
      '</div>' +
      '<div class="container-actions">' + actions + '</div>' +
    '</div>';
  }).join('');
}

async function projectAction(name, action) {
  try {
    await api('/api/projects/' + name + '/' + action, { method: 'POST' });
    setTimeout(refreshProjectList, 1500);
  } catch (e) {
    console.error(e);
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
    previewEl.style.display = 'none';
    return;
  }
  
  var dbName = name.replace(/-/g, '_') + '_db';
  var domain = name + '.test';
  var webContainer = name + '-web';
  var appContainer = name + '-app';
  
  var isPhpFpm = template === 'php-fpm' || template === 'php-legacy' || template === 'php-ancient';
  var webServer = isPhpFpm ? webContainer + ':80 (Nginx)' : appContainer + ':80';
  
  previewEl.innerHTML = 
    '<div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 8px;">Project Preview</div>' +
    '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">' +
      '<div><span style="color: var(--text-muted);">Domain:</span> <code style="color: var(--accent);">' + domain + '</code></div>' +
      '<div><span style="color: var(--text-muted);">Database:</span> <code style="color: var(--accent);">' + dbName + '</code></div>' +
      '<div><span style="color: var(--text-muted);">App:</span> <code>' + appContainer + '</code></div>' +
      (isPhpFpm ? '<div><span style="color: var(--text-muted);">Web:</span> <code>' + webContainer + '</code></div>' : '') +
      '<div style="grid-column: 1 / -1;"><span style="color: var(--text-muted);">Proxy Target:</span> <code style="color: var(--green);">' + webServer + '</code></div>' +
    '</div>';
  previewEl.style.display = 'block';
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
  if (!path) { 
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<div style="color:var(--red);padding:8px 0;">Please select a folder first</div>';
    return; 
  }

  btn.disabled = true;
  btn.textContent = t('adding');
  statusEl.style.display = 'block';
  statusEl.innerHTML = 
    '<div style="color:var(--text-muted);padding:8px 0;">' +
      '<div class="loading" style="display:inline-block;margin-right:8px;"></div>' +
      'Creating project configuration...' +
    '</div>';

  try {
    // Set a longer timeout for the fetch (5 minutes)
    var controller = new AbortController();
    var timeoutId = setTimeout(function() {
      controller.abort();
    }, 300000); // 5 minutes

    var result = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, template: templateSelect.value, path: path }),
      signal: controller.signal
    }).then(function(res) { clearTimeout(timeoutId); return res.json(); });

    if (result.error) {
      statusEl.innerHTML = '<div style="color:var(--red);padding:8px 0;">' + t('error') + ': ' + result.error + '</div>';
    } else {
      var color = result.status === 'running' ? 'var(--green)' : result.status === 'error' ? 'var(--red)' : 'var(--yellow)';
      var nextSteps = '';
      if (result.status === 'starting') {
        nextSteps = '<div style="margin-top:8px;padding:8px;background:var(--surface);border-radius:var(--radius-sm);border:1px solid var(--border);">' +
          '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px;">Next Steps</div>' +
          '<ol style="margin:0;padding-left:16px;font-size:12px;color:var(--text-secondary);line-height:1.8;">' +
            '<li>Wait 30 seconds for containers to start</li>' +
            '<li>Click <strong>' + result.domain + '</strong> to open your project</li>' +
            '<li>If it shows 502, wait a bit more and refresh</li>' +
          '</ol>' +
        '</div>';
      }
      statusEl.innerHTML =
        '<div style="color:' + color + ';padding:8px 0;">' +
          '✓ <strong>' + result.name + '</strong> — ' +
          '<a href="https://' + result.domain + '" target="_blank" style="color:var(--green);">' + result.domain + '</a>' +
          ' · DB: <code>' + result.database + '</code>' +
          '<br><span style="color:var(--text-muted);font-size:12px;">' + result.output + '</span>' +
        '</div>' + nextSteps;
      nameInput.value = '';
      pathInput.value = '';
      document.getElementById('adopt-preview').style.display = 'none';
      refreshProjectList();
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      statusEl.innerHTML = '<div style="color:var(--yellow);padding:8px 0;">Request timed out. The project may still be processing in the background.</div>';
    } else {
      statusEl.innerHTML = '<div style="color:var(--red);padding:8px 0;">' + t('failedAdopt') + ': ' + e.message + '</div>';
    }
  }

  btn.disabled = false;
  btn.textContent = t('create');
}

async function openFolderBrowser() {
  // Get home directory from backend (works on any OS)
  var homeData = await api('/api/home');
  var startPath = homeData.parent || '/';

  var modal = document.createElement('div');
  modal.id = 'folder-modal';
  modal.innerHTML =
    '<div class="modal-overlay" onclick="closeFolderBrowser()">' +
      '<div class="modal-content" onclick="event.stopPropagation()">' +
        '<div class="modal-header">' +
          '<span class="card-title">Select Folder</span>' +
          '<button class="btn-icon" onclick="closeFolderBrowser()">&times;</button>' +
        '</div>' +
        '<div class="modal-path" id="browser-path">' + startPath + '</div>' +
        '<div class="modal-list" id="browser-list"><div class="loading">Loading...</div></div>' +
        '<div class="modal-footer">' +
          '<button class="btn" onclick="closeFolderBrowser()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="selectCurrentFolder()">Select this folder</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);
  browseTo(startPath);
}

function closeFolderBrowser() {
  var modal = document.getElementById('folder-modal');
  if (modal) modal.remove();
}

async function browseTo(path) {
  var listEl = document.getElementById('browser-list');
  var pathEl = document.getElementById('browser-path');
  if (!listEl) return;

  listEl.innerHTML = '<div class="loading">Loading...</div>';
  pathEl.textContent = path;

  try {
    var data = await api('/api/browse?path=' + encodeURIComponent(path));
    var entries = data.entries || [];

    var html = '';
    // Parent directory link
    var pathParts = path.split('/').filter(Boolean);
    if (pathParts.length > 1) {
      var parent = '/' + pathParts.slice(0, -1).join('/');
      html += '<div class="browser-item" onclick="browseTo(\'' + parent + '\')">' +
        '<span style="margin-right:8px;">&#128194;</span> ..' +
      '</div>';
    }

    if (entries.length === 0) {
      html += '<div style="padding:12px;color:var(--text-muted);font-size:12px;">Empty directory</div>';
    }

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var fullPath = path + '/' + e.name;
      html += '<div class="browser-item" onclick="browseTo(\'' + fullPath + '\')">' +
        '<span style="margin-right:8px;">&#128193;</span> ' + e.name +
      '</div>';
    }

    listEl.innerHTML = html;
  } catch (err) {
    listEl.innerHTML = '<div style="padding:12px;color:var(--red);">Cannot read directory</div>';
  }
}

async function selectCurrentFolder() {
  var pathEl = document.getElementById('browser-path');
  if (!pathEl) return;

  var selectedPath = pathEl.textContent;
  var folderName = selectedPath.split('/').pop();

  var pathInput = document.getElementById('adopt-path');
  var nameInput = document.getElementById('adopt-name');
  var templateSelect = document.getElementById('adopt-template');

  if (pathInput) pathInput.value = selectedPath;
  if (nameInput && !nameInput.value) {
    nameInput.value = folderName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  // Auto-detect template from project files
  if (templateSelect) {
    try {
      var result = await api('/api/detect-template?path=' + encodeURIComponent(selectedPath));
      if (result.template) {
        templateSelect.value = result.template;
      }
    } catch (e) { /* ignore, user can pick manually */ }
  }

  closeFolderBrowser();
}

async function deleteProject(name) {
  var message = 'Delete project "' + name + '"?\n\n' +
    'This will:\n' +
    '• Stop containers\n' +
    '• Remove domain configuration\n' +
    '• Create database backup (dump)\n' +
    '• Drop the database\n\n' +
    'Your project files will NOT be deleted.';
  
  if (!confirm(message)) return;

  try {
    var response = await fetch('/api/projects/' + name, { method: 'DELETE' });
    var result = await response.json();
    
    if (result.dump) {
      alert('Project "' + name + '" deleted.\n\nDatabase backup saved to:\n' + result.dump);
    } else {
      alert('Project "' + name + '" deleted.\n\nNote: Database backup could not be created.');
    }
    
    setTimeout(refreshProjectList, 500);
  } catch (e) {
    console.error(e);
    alert('Error deleting project: ' + e.message);
  }
}

async function refreshProjectList() {
  var projects = await api('/api/projects');
  var listEl = document.getElementById('project-list');
  if (listEl) listEl.innerHTML = renderProjectRows(projects);
}
