import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./styles.css";

interface Container {
  name: string;
  status: string;
  is_damp: boolean;
}

interface Database {
  name: string;
  engine: string;
}

interface Project {
  name: string;
  path: string;
  template: string;
}

interface ProjectSuggestion {
  path: string;
  suggested_template: string;
  detected_files: string[];
}

interface DampStatus {
  docker_running: boolean;
  docker_installed: boolean;
  orbstack_installed: boolean;
  damp_path: string;
  containers: Container[];
  databases: Database[];
  projects: Project[];
}

function App() {
  const [status, setStatus] = useState<DampStatus | null>(null);
  const [templates, setTemplates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  
  const [activeTab, setActiveTab] = useState("overview");
  const [_showDbInput, setShowDbInput] = useState(false);
  const [newDbName, setNewDbName] = useState("");
  const [dbEngine, setDbEngine] = useState("mysql");

  const [suggestion, setSuggestion] = useState<ProjectSuggestion | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, t, p] = await Promise.all([
        invoke<DampStatus>("get_status"),
        invoke<string[]>("get_templates"),
        invoke<Project[]>("get_projects"),
      ]);
      setStatus({ ...s, projects: p });
      setTemplates(t);
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

  const handleOpenFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select project folder to adopt"
    });

    if (selected && typeof selected === 'string') {
      try {
        const sug = await invoke<ProjectSuggestion>("detect_project_type", { path: selected });
        setSuggestion(sug);
        setSelectedTemplate(sug.suggested_template);
        setActiveTab("projects");
      } catch (e) {
        alert(e);
      }
    }
  };

  const handleAdopt = async () => {
    if (!suggestion || !selectedTemplate) return;
    setActionLoading(true);
    try {
      await invoke("adopt_project", { path: suggestion.path, template: selectedTemplate });
      setSuggestion(null);
      refresh();
    } catch (e) {
      alert(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePowerToggle = async (allRunning: boolean) => {
    setActionLoading(true);
    await invoke(allRunning ? "damp_down" : "damp_up");
    setTimeout(refresh, 2000);
    setActionLoading(false);
  };

  const handleStartProject = async (project: Project) => {
    setActionLoading(true);
    try {
      await invoke("start_project", { path: project.path });
      refresh();
    } catch (e) {
      alert(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopProject = async (project: Project) => {
    setActionLoading(true);
    try {
      await invoke("stop_project", { path: project.path });
      refresh();
    } catch (e) {
      alert(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemoveProject = async (project: Project) => {
    if (!confirm(`Remove "${project.name}" from DAMP?`)) return;
    await invoke("remove_project", { path: project.path });
    refresh();
  };

  const handleCreateDb = async () => {
    if (!newDbName.trim()) return;
    try {
      await invoke("create_database", { name: newDbName, engine: dbEngine });
      setNewDbName("");
      setShowDbInput(false);
      refresh();
    } catch (e) {
      alert(e);
    }
  };

  if (loading) return <div className="loading">DAMP LOADING...</div>;

  const dampServices = status?.containers.filter((c) => c.is_damp) || [];
  const allRunning = dampServices.length > 0 && dampServices.every((c) => c.status === "running");

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>DAMP</h1>
        </div>
        
        <nav className="nav-group">
          <div className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            <span className="nav-icon">📊</span> Overview
          </div>
          <div className={`nav-item ${activeTab === 'projects' ? 'active' : ''}`} onClick={() => setActiveTab('projects')}>
            <span className="nav-icon">📁</span> Projects
          </div>
          <div className={`nav-item ${activeTab === 'databases' ? 'active' : ''}`} onClick={() => setActiveTab('databases')}>
            <span className="nav-icon">🗄️</span> Databases
          </div>
          <div className="nav-item" onClick={() => invoke("open_url", { url: "http://localhost:9000" })}>
            <span className="nav-icon">🌐</span> Web Dashboard
          </div>
        </nav>

        <div className="sidebar-footer">
          <button className={`power-btn ${allRunning ? 'on' : 'off'}`} onClick={() => handlePowerToggle(allRunning)} disabled={actionLoading}>
            {allRunning ? "Stop Engine" : "Start Engine"}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-layout">
        <header className="topbar">
          <div className="topbar-title">
            {activeTab.toUpperCase()}
          </div>
          <div className="services-row">
            {dampServices.map(s => (
              <div key={s.name} className="service-tag">
                <span className={`status-dot ${s.status === 'running' ? 'on' : 'off'}`} />
                {s.name.replace("damp-", "")}
              </div>
            ))}
          </div>
        </header>

        <div className="content-scroll">
          {activeTab === 'overview' && (
            <div className="fade-in">
              <div className="grid-bento">
                <div className="card stat-card">
                  <div className="stat-val">{status?.projects.length || 0}</div>
                  <div className="stat-lab">Projects Registered</div>
                </div>
                <div className="card stat-card">
                  <div className="stat-val">{status?.databases.length || 0}</div>
                  <div className="stat-lab">Databases Created</div>
                </div>
              </div>

              <div className="card">
                <h3>Global Access</h3>
                <div className="access-box" style={{ marginTop: '16px' }}>
                  <div className="access-item" onClick={() => invoke("open_url", { url: "http://pma.local" })}>
                    <span className="access-icon">🗄️</span>
                    <span className="access-label">PHPMyAdmin</span>
                  </div>
                  <div className="access-item" onClick={() => invoke("open_url", { url: "http://mail.local" })}>
                    <span className="access-icon">📬</span>
                    <span className="access-label">Mailpit</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'projects' && (
            <div className="fade-in">
              <button className="btn-adopt" onClick={handleOpenFolder}>
                + ADOPT EXISTING PROJECT
              </button>

              {suggestion && (
                <div className="panel-adopt">
                  <h4>Adopt: {suggestion.path.split('/').pop()}</h4>
                  <div className="template-grid" style={{ margin: '12px 0' }}>
                    {templates.map(t => (
                      <button key={t} className={`tpl-btn ${selectedTemplate === t ? 'active' : ''}`} onClick={() => setSelectedTemplate(t)}>{t}</button>
                    ))}
                  </div>
                  <button className="btn-primary btn-full" onClick={handleAdopt}>CONFIRM ADOPTION</button>
                </div>
              )}

              <div className="project-list">
                {status?.projects.map(p => {
                  const container = status.containers.find(c => c.name.startsWith(p.name));
                  const isRunning = container?.status === "running";
                  return (
                    <div key={p.path} className="project-card">
                      <div className="p-info">
                        <span className={`status-dot ${isRunning ? 'on' : ''}`} />
                        <div className="p-details">
                          <span className="name">{p.name}</span>
                          <span className="path">{p.path}</span>
                        </div>
                      </div>
                      <div className="actions-row">
                        {isRunning ? (
                          <button className="btn-action" onClick={() => handleStopProject(p)}>Stop</button>
                        ) : (
                          <button className="btn-action primary" onClick={() => handleStartProject(p)}>Start</button>
                        )}
                        <button className="btn-action primary" onClick={() => invoke("open_url", { url: `https://${p.name}.local` })}>Open</button>
                        <button className="btn-action danger" onClick={() => handleRemoveProject(p)}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'databases' && (
            <div className="fade-in">
              <div className="card">
                <div className="input-group">
                  <input type="text" className="input" placeholder="New DB Name" value={newDbName} onChange={(e) => setNewDbName(e.target.value)} />
                  <select className="input" style={{ width: '120px' }} value={dbEngine} onChange={e => setDbEngine(e.target.value)}>
                    <option value="mysql">MySQL</option>
                    <option value="postgres">Postgres</option>
                  </select>
                  <button className="btn-action primary" style={{ padding: '0 20px' }} onClick={handleCreateDb}>Create</button>
                </div>
              </div>

              <div className="db-chips" style={{ marginTop: '24px' }}>
                {status?.databases.map(db => (
                  <div key={db.name} className="db-chip">
                    <span style={{ opacity: 0.5 }}>{db.engine === 'mysql' ? '🐬' : '🐘'}</span>
                    {db.name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="footer-bar">
          <span>Engine: {status?.docker_running ? "Running" : "Offline"}</span>
          <span>DAMP v1.0.0</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
