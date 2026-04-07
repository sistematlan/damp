import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

interface Container {
  name: string;
  status: string;
  is_damp: boolean;
}

interface DampStatus {
  docker_running: boolean;
  damp_path: string;
  containers: Container[];
  databases: string[];
}

const QUICK_LINKS = [
  { icon: "🗄️", label: "PHPMyAdmin", url: "http://localhost:8080" },
  { icon: "📬", label: "Mailpit", url: "http://localhost:8025" },
];

function App() {
  const [status, setStatus] = useState<DampStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const [showDbInput, setShowDbInput] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await invoke<DampStatus>("get_status");
      setStatus(s);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleUp = async () => {
    setActionLoading(true);
    await invoke("damp_up");
    setTimeout(refresh, 2000);
    setActionLoading(false);
  };

  const handleDown = async () => {
    setActionLoading(true);
    await invoke("damp_down");
    setTimeout(refresh, 2000);
    setActionLoading(false);
  };

  const handleOpenUrl = async (url: string) => {
    await invoke("open_url", { url });
  };

  const handleCreateDb = async () => {
    const name = newDbName.trim();
    if (!name) return;
    await invoke("create_database", { name });
    setNewDbName("");
    setShowDbInput(false);
    refresh();
  };

  const handleDropDb = async (name: string) => {
    if (!confirm(`Drop database "${name}"? This cannot be undone.`)) return;
    await invoke("drop_database", { name });
    refresh();
  };

  if (loading) {
    return (
      <div className="loading">
        <span className="loading-text">Connecting to Docker...</span>
      </div>
    );
  }

  if (!status?.docker_running) {
    return (
      <div className="app">
        <div className="titlebar">
          <h1>DAMP</h1>
        </div>
        <div className="content" style={{ display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          <span style={{ fontSize: 40 }}>🐳</span>
          <p>Docker is not running</p>
          <p style={{ color: "var(--text-muted)", fontSize: 12 }}>Start Docker Desktop or OrbStack</p>
        </div>
      </div>
    );
  }

  const dampServices = status.containers.filter((c) => c.is_damp);
  const projects = status.containers.filter((c) => !c.is_damp);
  const allRunning = dampServices.length > 0 && dampServices.every((c) => c.status === "running");

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar">
        <h1>DAMP</h1>
        <div className="titlebar-actions">
          {allRunning ? (
            <button className="btn btn-danger" onClick={handleDown} disabled={actionLoading}>
              {actionLoading ? "..." : "Stop"}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleUp} disabled={actionLoading}>
              {actionLoading ? "..." : "Start"}
            </button>
          )}
        </div>
      </div>

      {/* DAMP Services chips */}
      <div className="services-bar">
        {dampServices.map((c) => (
          <div className="service-chip" key={c.name}>
            <span className={`dot ${c.status === "running" ? "running" : "stopped"}`} />
            {c.name.replace("damp-", "")}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="content">
        {/* Quick links */}
        <div className="section-title">Quick access</div>
        <div className="quick-links">
          {QUICK_LINKS.map((link) => (
            <div className="quick-link" key={link.url} onClick={() => handleOpenUrl(link.url)}>
              <span className="quick-link-icon">{link.icon}</span>
              <span className="quick-link-label">{link.label}</span>
            </div>
          ))}
        </div>

        {/* Projects */}
        <div className="section-title">Projects</div>
        <div className="container-list">
          {projects.length === 0 && (
            <p style={{ color: "var(--text-muted)", padding: 12 }}>
              No projects running
            </p>
          )}
          {projects.map((c) => (
            <div className="container-row" key={c.name}>
              <div className="container-info">
                <span className={`dot ${c.status === "running" ? "running" : "stopped"}`} />
                <span className="container-name">{c.name}</span>
                <span className={`container-badge ${c.status === "running" ? "badge-running" : "badge-stopped"}`}>
                  {c.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Databases */}
        <div className="section-title">
          Databases
          <button className="btn-icon" onClick={() => setShowDbInput(!showDbInput)} title="Create database">+</button>
        </div>
        {showDbInput && (
          <div className="db-create">
            <input
              type="text"
              className="db-input"
              placeholder="database_name"
              value={newDbName}
              onChange={(e) => setNewDbName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateDb()}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" onClick={handleCreateDb}>Create</button>
          </div>
        )}
        <div className="db-list">
          {status.databases.map((db) => (
            <span className="db-chip" key={db}>
              {db}
              <button className="db-delete" onClick={() => handleDropDb(db)} title={`Drop ${db}`}>&times;</button>
            </span>
          ))}
        </div>
      </div>

      {/* Status bar */}
      <div className="statusbar">
        <span>
          {status.containers.filter((c) => c.status === "running").length} containers active
        </span>
        <span>DAMP v1.0.0</span>
      </div>
    </div>
  );
}

export default App;
