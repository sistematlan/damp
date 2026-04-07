// ── Logs View ─────────────────────────────────────────

let logSource = null;

async function renderLogs(el) {
  // Close previous log stream
  if (logSource) { logSource.close(); logSource = null; }

  const data = await api('/api/status');
  const allContainers = data.containers || [];

  el.innerHTML = `
    <div class="fade-in">
      <div class="log-controls">
        <select id="log-container" onchange="switchLogContainer()">
          <option value="">Select container...</option>
          ${allContainers.map(c => `<option value="${c.name}">${c.name}</option>`).join('')}
        </select>
        <button class="btn btn-sm" onclick="clearLogs()">Clear</button>
        <label style="display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px;">
          <input type="checkbox" id="log-autoscroll" checked> Auto-scroll
        </label>
      </div>
      <div class="log-viewer" id="log-output">Select a container to view logs...</div>
    </div>
  `;
}

function switchLogContainer() {
  const name = document.getElementById('log-container').value;
  if (!name) return;

  if (logSource) { logSource.close(); logSource = null; }

  const output = document.getElementById('log-output');
  output.textContent = `Connecting to ${name}...\n`;

  logSource = new EventSource(`/api/containers/${name}/logs`);
  logSource.onmessage = (event) => {
    output.textContent += event.data + '\n';
    if (document.getElementById('log-autoscroll')?.checked) {
      output.scrollTop = output.scrollHeight;
    }
  };
  logSource.onerror = () => {
    output.textContent += '\n[Connection lost. Reconnecting...]\n';
  };
}

function clearLogs() {
  const output = document.getElementById('log-output');
  if (output) output.textContent = '';
}

// Clean up on navigation
window.addEventListener('hashchange', () => {
  if (logSource) { logSource.close(); logSource = null; }
});
