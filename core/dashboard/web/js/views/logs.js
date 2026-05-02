// ── Logs View ─────────────────────────────────────────

var logSource = null;

async function renderLogs(el) {
  // Explicitly close any existing source when rendering the view (F9)
  if (logSource) {
    logSource.close();
    logSource = null;
  }

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
  if (!name) {
    if (logSource) {
      logSource.close();
      logSource = null;
    }
    return;
  }

  // Ensure previous source is closed before starting a new one (F9)
  if (logSource) {
    logSource.close();
    logSource = null;
  }

  var output = document.getElementById('log-output');
  output.textContent = t('connecting') + ' ' + name + '...\n';

  function connect() {
    if (logSource) logSource.close();
    
    logSource = new EventSource('/api/containers/' + name + '/logs');
    
    logSource.addEventListener('log-line', function(event) {
      var checkbox = document.getElementById('log-autoscroll');
      var isAtBottom = output.scrollHeight - output.clientHeight <= output.scrollTop + 50;

      output.textContent += event.data + '\n';
      
      if (checkbox && checkbox.checked && isAtBottom) {
        output.scrollTop = output.scrollHeight;
      }
    });

    logSource.addEventListener('error', function(event) {
      output.innerHTML += '<div style="color:var(--red);margin-top:10px;">' + t('error') + ': ' + event.data + '</div>';
    });

    logSource.onerror = function() {
      if (logSource.readyState === EventSource.CLOSED) {
        output.innerHTML += '<div style="color:var(--yellow);margin-top:10px;">' + t('connectionLost') + '. ' + t('reconnecting') + '...</div>';
        setTimeout(connect, 3000);
      }
    };
  }

  connect();
}

function clearLogs() {
  var output = document.getElementById('log-output');
  if (output) output.textContent = '';
}

window.addEventListener('hashchange', function() {
  if (logSource) { logSource.close(); logSource = null; }
});
