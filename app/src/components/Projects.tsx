import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DampStatus, Project, ProjectSuggestion, Template } from "../types";
import { t } from "../i18n/translations";

interface ProjectsProps {
  status: DampStatus;
  projects: Project[];
  templates: Template[];
  onRefresh: () => void;
}

export default function Projects({ status, projects, templates, onRefresh }: ProjectsProps) {
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("frankenphp");
  const [suggestion, setSuggestion] = useState<ProjectSuggestion | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyProject, setBusyProject] = useState<string | null>(null);
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
    setBusyProject(p.name);
    try { const result = await invoke<string>("start_project", { name: p.name }); setMessage({ text: result, type: "success" }); onRefresh(); }
    catch (e) { setMessage({ text: String(e), type: "error" }); clearMessage(); }
    finally { setBusyProject(null); }
  };

  const handleStop = async (p: Project) => {
    setBusyProject(p.name);
    try { const result = await invoke<string>("stop_project", { name: p.name }); setMessage({ text: result, type: "success" }); onRefresh(); }
    catch (e) { setMessage({ text: String(e), type: "error" }); clearMessage(); }
    finally { setBusyProject(null); }
  };

  const handleRestart = async (p: Project) => {
    setBusyProject(p.name);
    try { const result = await invoke<string>("restart_project", { name: p.name }); setMessage({ text: result, type: "success" }); onRefresh(); }
    catch (e) { setMessage({ text: String(e), type: "error" }); clearMessage(); }
    finally { setBusyProject(null); }
  };

  const handleDelete = async (p: Project) => {
    if (!confirm(t("confirmDelete"))) return;
    try { await invoke("delete_project", { name: p.name }); onRefresh(); }
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
            <div className="template-grid" style={{ flex: 1 }}>
              {templates.map((tpl) => (
                <div
                  key={tpl.name}
                  className={`template-card ${newTemplate === tpl.name ? "active" : ""}`}
                  onClick={() => setNewTemplate(tpl.name)}
                >
                  <div className="template-card-name">{tpl.name}</div>
                  <div className="template-card-desc">{tpl.description}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" onClick={handleCreate} disabled={loading || !newName.trim()}>
              {loading ? t("creating") : t("create")}
            </button>
            <button className="btn" onClick={() => setShowNewForm(false)}>{t("cancel")}</button>
          </div>
        </div>
      )}

      {suggestion && (
        <div className="adopt-panel">
          <h3>{t("adoptFolder")}</h3>
          <div className="adopt-preview">
            <div className="adopt-path">{suggestion.path}</div>
            {suggestion.detected_files.length > 0 && (
              <div className="detected-files">
                {t("detectedAs")}: {suggestion.detected_files.join(", ")}
              </div>
            )}
          </div>
          
          <div className="form-label" style={{ marginBottom: 8 }}>{t("selectTemplate")}</div>
          <div className="template-grid">
            {templates.map((tpl) => (
              <div
                key={tpl.name}
                className={`template-card ${selectedTemplate === tpl.name ? "active" : ""}`}
                onClick={() => setSelectedTemplate(tpl.name)}
              >
                <div className="template-card-name">{tpl.name}</div>
                <div className="template-card-desc">{tpl.description}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
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
          const isRunning = p.status === "running";
          const hasContainer = p.status !== "pending";
          const busy = busyProject === p.name;

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
                  <button className="btn btn-sm" disabled={busy} onClick={() => handleStop(p)}>{busy ? "…" : t("stop")}</button>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => handleStart(p)}>{busy ? "…" : t("start")}</button>
                )}
                {isRunning && (
                  <button className="btn btn-sm" disabled={busy} onClick={() => handleRestart(p)}>{t("restart")}</button>
                )}
                {isRunning && (
                  <button className="btn btn-sm btn-primary" onClick={() => handleOpen(p.name)}>{t("open")}</button>
                )}
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p)}>{t("delete")}</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
