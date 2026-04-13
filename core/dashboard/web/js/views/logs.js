// ── Logs View ─────────────────────────────────────────

var logSource = null;

async function renderLogs(el) {
  if (logSource) { logSource.close(); logSource = null; }

  var data = await api('/api/status');
  var allContainers = data.containers || [];

  el.innerHTML =
    '<div class="fade-in">' +
      '<div class="log-controls">' +
        '<select id="log-container" onchange="switchLogContainer()">' +
          '<option value="">' + t('selectContainer') + '</option>' +
          allContainers.map(function(c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('') +
        '</select>' +
        '<button class="btn btn-sm" onclick="clearLogs()">' + t('clear') + '</button>' +
        '<label style="display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px;">' +
          '<input type="checkbox" id="log-autoscroll" checked> ' + t('autoScroll') +
        '</label>' +
      '</div>' +
      '<div class="log-viewer" id="log-output">' + t('selectContainerHint') + '</div>' +
    '</div>';
}

function switchLogContainer() {
  var name = document.getElementById('log-container').value;
  if (!name) return;

  if (logSource) { logSource.close(); logSource = null; }

  var output = document.getElementById('log-output');
  output.textContent = t('connecting') + ' ' + name + '...\n';

  logSource = new EventSource('/api/containers/' + name + '/logs');
  logSource.onmessage = function(event) {
    output.textContent += event.data + '\n';
    var checkbox = document.getElementById('log-autoscroll');
    if (checkbox && checkbox.checked) {
      output.scrollTop = output.scrollHeight;
    }
  };
  logSource.onerror = function() {
    output.textContent += '\n' + t('connectionLost') + '\n';
  };
}

function clearLogs() {
  var output = document.getElementById('log-output');
  if (output) output.textContent = '';
}

window.addEventListener('hashchange', function() {
  if (logSource) { logSource.close(); logSource = null; }
});
