import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DampStatus, Project, Template } from "./types";
import { initLang, setLang, t } from "./i18n/translations";
import Overview from "./components/Overview";
import Projects from "./components/Projects";
import Databases from "./components/Databases";
import Logs from "./components/Logs";
import "./styles.css";

const NAV_ITEMS = [
  { id: "overview", icon: "O" },
  { id: "projects", icon: "P" },
  { id: "databases", icon: "D" },
  { id: "logs", icon: "L" },
];

export default function App() {
  const [status, setStatus] = useState<DampStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [lang, setLangState] = useState(initLang());

  const refresh = useCallback(async () => {
    try {
      const [s, tpl, p] = await Promise.all([
        invoke<DampStatus>("get_status"),
        invoke<Template[]>("get_templates"),
        invoke<Project[]>("get_projects"),
      ]);
      setStatus(s);
      setTemplates(tpl);
      setProjects(p);
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

  const handlePowerToggle = async (allRunning: boolean) => {
    setActionLoading(true);
    try {
      await invoke(allRunning ? "damp_down" : "damp_up");
      setTimeout(refresh, 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setActionLoading(false);
    }
  };

  const handleLangChange = (newLang: string) => {
    setLang(newLang);
    setLangState(newLang);
  };

  if (loading || !status) {
    return <div className="loading-screen">DAMP_</div>;
  }

  const dampServices = status.containers.filter((c) => c.is_damp);
  const allRunning = dampServices.length > 0 && dampServices.every((c) => c.status === "running");
  const runningCount = dampServices.filter((c) => c.status === "running").length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>DAMP</h1>
          <span className="brand-ver">v0.3.0</span>
        </div>

        <nav className="nav-group">
          {NAV_ITEMS.map((item) => (
            <div
              key={item.id}
              className={`nav-item ${activeTab === item.id ? "active" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              {t(item.id)}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className={`power-btn ${allRunning ? "on" : "off"}`}
            onClick={() => handlePowerToggle(allRunning)}
            disabled={actionLoading}
          >
            {allRunning ? t("stopEngine") : t("startEngine")}
          </button>
          <div className="lang-toggle">
            <button
              className={`lang-btn ${lang === "en" ? "active" : ""}`}
              onClick={() => handleLangChange("en")}
            >
              EN
            </button>
            <button
              className={`lang-btn ${lang === "es" ? "active" : ""}`}
              onClick={() => handleLangChange("es")}
            >
              ES
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <span className="topbar-title">{t(activeTab)}</span>
            <div className="topbar-status">
              <div className={`dot ${allRunning ? "running" : ""}`} />
              <span>{runningCount}/{dampServices.length} services</span>
            </div>
          </div>
          <div className="topbar-services">
            {dampServices.map((s) => (
              <div key={s.name} className="service-tag">
                <div className={`dot ${s.status === "running" ? "running" : "stopped"}`} />
                {s.name.replace("damp-", "")}
              </div>
            ))}
          </div>
        </header>

        <div className="content">
          {activeTab === "overview" && (
            <Overview status={status} projects={projects} onNavigate={setActiveTab} />
          )}
          {activeTab === "projects" && (
            <Projects
              status={status}
              projects={projects}
              templates={templates}
              onRefresh={refresh}
            />
          )}
          {activeTab === "databases" && (
            <Databases status={status} onRefresh={refresh} />
          )}
          {activeTab === "logs" && (
            <Logs status={status} />
          )}
        </div>

        <footer className="footer">
          <span>{status.docker_running ? t("engineRunning") : t("engineOffline")}</span>
          <span>DAMP v0.3.0</span>
        </footer>
      </div>
    </div>
  );
}
