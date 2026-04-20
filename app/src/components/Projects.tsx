import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DampStatus, Project, ProjectSuggestion } from "../types";
import { t } from "../i18n/translations";

interface ProjectsProps {
  status: DampStatus;
  projects: Project[];
  templates: string[];
  onRefresh: () => void;
}

export default function Projects({ status, projects, templates, onRefresh }: ProjectsProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("frankenphp");
  const [suggestion, setSuggestion] = useState<ProjectSuggestion | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const tld = status.tld || "test";

  const clearMessage = () => setTimeout(() => setMessage(null), 4000);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const result = await invoke<string>("create_project", { name: newName, template: newTemplate });
      setMessage({ text: result, type: "success" });
      setNewName("");
      setShowNewForm(false);
      onRefresh();
    } catch (e) {
      setMessage({ text: String(e), type: "error" });
    } finally {
      setLoading(false);
      clearMessage();
    }
  };

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Select project folder" });
    if (selected && typeof selected === "string") {
      try {
        const sug = await invoke<ProjectSuggestion>("detect_project_type", { path: selected });
        setSuggestion(sug);
        setSelectedTemplate(sug.suggested_template);
      } catch (e) {
        setMessage({ text: String(e), type: "error" });
        clearMessage();
      }
    }
  };

  const handleAdopt = async () => {
    if (!suggestion || !selectedTemplate) return;
    setLoading(true);
    try {
      const result = await invoke<string>("adopt_project", { path: suggestion.path, template: selectedTemplate });
      setMessage({ text: result, type: "success" });
      setSuggestion(null);
      onRefresh();
    } catch (e) {
      setMessage({ text: String(e), type: "error" });
    } finally {
      setLoading(false);
      clearMessage();
    }
  };

  const handleStart = async (p: Project) => {
    try { await invoke("start_project", { path: p.path }); onRefresh(); }
    catch (e) { setMessage({ text: String(e), type: "error" }); clearMessage(); }
  };

  const handleStop = async (p: Project) => {
    try { await invoke("stop_project", { path: p.path }); onRefresh(); }
    catch (e) { setMessage({ text: String(e), type: "error" }); clearMessage(); }
  };

  const handleRestart = async (p: Project) => {
    try { await invoke("restart_project", { path: p.path }); onRefresh(); }
    catch (e) { setMessage({ text: String(e), type: "error" }); clearMessage(); }
  };

  const handleDelete = async (p: Project) => {
    if (!confirm(t("confirmDelete"))) return;
    try { await invoke("delete_project", { path: p.path }); onRefresh(); }
    catch (e) { setMessage({ text: String(e), type: "error" }); clearMessage(); }
  };

  const handleRemove = async (p: Project) => {
    if (!confirm(`Remove "${p.name}" from registry?`)) return;
    try { await invoke("remove_project", { path: p.path }); onRefresh(); }
    catch (e) { setMessage({ text: String(e), type: "error" }); clearMessage(); }
  };

  const handleOpen = (name: string) => {
    invoke("open_url", { url: `https://${name}.${tld}` });
  };

  return (
    <div>
      <div className="actions-bar">
        <button className="btn btn-primary" onClick={() => { setShowNewForm(!showNewForm); setSuggestion(null); }}>
          + {t("newProject")}
        </button>
        <button className="btn" onClick={handleOpenFolder}>
          {t("adoptFolder")}
        </button>
      </div>

      {message && (
        <div className={`inline-status ${message.type}`}>{message.text}</div>
      )}

      {showNewForm && (
        <div className="new-project-form">
          <div className="form-row">
            <span className="form-label">{t("projectName")}</span>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="my-project"
              value={newName}
              onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <div className="form-row">
            <span className="form-label">{t("selectTemplate")}</span>
            <select className="input" style={{ flex: 1 }} value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
              {templates.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn btn-primary" onClick={handleCreate} disabled={loading || !newName.trim()}>
              {loading ? t("creating") : t("create")}
            </button>
            <button className="btn" onClick={() => setShowNewForm(false)}>{t("cancel")}</button>
          </div>
        </div>
      )}

      {suggestion && (
        <div className="adopt-panel">
          <h4>{suggestion.path.split("/").pop()}</h4>
          {suggestion.detected_files.length > 0 && (
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 8 }}>
              {t("detectedAs")}: {suggestion.detected_files.join(", ")}
            </div>
          )}
          <div className="template-grid">
            {templates.map((t) => (
              <button
                key={t}
                className={`tpl-btn ${selectedTemplate === t ? "active" : ""}`}
                onClick={() => setSelectedTemplate(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={handleAdopt} disabled={loading || !selectedTemplate}>
              {loading ? t("creating") : t("confirmAdopt")}
            </button>
            <button className="btn" onClick={() => setSuggestion(null)}>{t("cancel")}</button>
          </div>
        </div>
      )}

      {projects.length === 0 && !showNewForm && !suggestion ? (
        <div className="empty-state">
          <div className="empty-state-icon">/</div>
          <div className="empty-state-text">{t("noProjectsDesc")}</div>
        </div>
      ) : (
        projects.map((p) => {
          const container = status.containers.find(
            (c) => c.name.replace(/-/g, "").startsWith(p.name.replace(/-/g, ""))
          );
          const isRunning = container?.status === "running";
          const hasContainer = !!container;

          return (
            <div key={p.path} className="project-card">
              <div className={`dot ${isRunning ? "running" : hasContainer ? "stopped" : ""}`} />
              <div className="project-info">
                <div className="project-name">
                  {p.name}
                  {hasContainer ? (
                    <span className={`badge ${isRunning ? "badge-running" : "badge-stopped"}`}>
                      {isRunning ? "running" : "stopped"}
                    </span>
                  ) : (
                    <span className="badge badge-pending">pending</span>
                  )}
                </div>
                <div className="project-path">{p.path}</div>
              </div>
              <div className="project-actions">
                {isRunning ? (
                  <button className="btn btn-sm" onClick={() => handleStop(p)}>{t("stop")}</button>
                ) : (
                  <button className="btn btn-sm btn-primary" onClick={() => handleStart(p)}>{t("start")}</button>
                )}
                {isRunning && (
                  <button className="btn btn-sm" onClick={() => handleRestart(p)}>{t("restart")}</button>
                )}
                {isRunning && (
                  <button className="btn btn-sm btn-primary" onClick={() => handleOpen(p.name)}>{t("open")}</button>
                )}
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p)}>{t("delete")}</button>
                {!hasContainer && (
                  <button className="btn btn-sm" onClick={() => handleRemove(p)}>{t("remove")}</button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
