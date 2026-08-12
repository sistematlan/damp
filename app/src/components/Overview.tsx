import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DampStatus, Project } from "../types";

interface OverviewProps {
  status: DampStatus;
  projects: Project[];
  onNavigate: (view: string) => void;
  onRefresh: () => void;
}

const SERVICE_INFO: Record<string, { id: string; label: string; detail: string; port: string; url?: string; controllable?: boolean }> = {
  "damp-caddy": { id: "caddy", label: "Caddy", detail: "Reverse Proxy / HTTPS", port: "443", url: "dashboard", controllable: true },
  "damp-dashboard": { id: "dashboard", label: "Dashboard", detail: "Control plane", port: "9000" },
  "damp-db": { id: "mysql", label: "MySQL 8.4", detail: "Database", port: "3306", controllable: true },
  "damp-postgres": { id: "postgres", label: "PostgreSQL 16", detail: "Database", port: "5432", controllable: true },
  "damp-redis": { id: "redis", label: "Redis 7", detail: "Cache", port: "6379", controllable: true },
  "damp-mailpit": { id: "mailpit", label: "Mailpit", detail: "SMTP Testing", port: "1025", url: "mail", controllable: true },
  "damp-phpmyadmin": { id: "phpmyadmin", label: "PHPMyAdmin", detail: "DB Manager", port: "8080", url: "pma", controllable: true },
};

const formatBytes = (bytes: number) => {
  if (!bytes) return "0 MiB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
};

export default function Overview({ status, projects, onNavigate, onRefresh }: OverviewProps) {
  const [busyService, setBusyService] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dampContainers = status.containers.filter((c) => c.is_damp);
  const tld = status.tld || "test";

  const getServiceStatus = (name: string) => {
    if (name === "damp-dashboard") return "running"; // If we're here, dashboard is responding
    const c = status.containers.find((co) => co.name === name);
    return c?.state || "";
  };

  const handleOpen = (url: string) => {
    invoke("open_url", { url });
  };

  const handleService = async (service: string, action: "start" | "stop") => {
    setBusyService(service);
    setMessage(null);
    try {
      await invoke("service_action", { service, action });
      setMessage(`${service}: ${action} complete`);
      await onRefresh();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusyService(null);
    }
  };

  return (
    <div>
      <div className="stat-row">
        <div className="stat">
          <div className="stat-val">{projects.length}</div>
          <div className="stat-label">Projects</div>
        </div>
        <div className="stat">
          <div className="stat-val">{status.databases.length + status.postgres_databases.length}</div>
          <div className="stat-label">Databases</div>
        </div>
        <div className="stat">
          <div className="stat-val">{dampContainers.filter((c) => c.state === "running").length}</div>
          <div className="stat-label">Services Up</div>
        </div>
      </div>

      <div className="card runtime-card">
        <div className="card-header">
          <span className="card-title">Runtime health</span>
          <span className="runtime-latency">API {status.response_time_ms || 0} ms</span>
        </div>
        <div className="runtime-summary">
          <strong>{formatBytes(status.runtime?.memory_usage || 0)}</strong>
          <span>container memory</span>
          <span>{status.runtime?.limited_containers || 0}/{status.runtime?.running_containers || 0} bounded</span>
          <span className={(status.runtime?.warnings || 0) > 0 ? "runtime-warning" : ""}>
            {status.runtime?.warnings || 0} warnings
          </span>
        </div>
        <div className="runtime-list">
          {status.containers
            .filter((container) => container.resources)
            .sort((a, b) => (b.resources?.memory_usage || 0) - (a.resources?.memory_usage || 0))
            .map((container) => {
              const resource = container.resources!;
              return (
                <div className={`runtime-row pressure-${resource.pressure}`} key={container.name}>
                  <span className="runtime-name">{container.name}</span>
                  <span>{formatBytes(resource.memory_usage)} / {resource.memory_limited ? formatBytes(resource.memory_limit) : "unbounded"}</span>
                  <span>{resource.memory_limited ? `${resource.memory_percent.toFixed(0)}%` : "—"}</span>
                  <span>{resource.cpu_percent.toFixed(1)}% CPU</span>
                  <span>{resource.pids} PIDs</span>
                </div>
              );
            })}
        </div>
      </div>

      <div className="section-gap">
        <div className="card-header" style={{ marginBottom: 10 }}>
          <span className="card-title">Services</span>
        </div>
        {message && <div className="inline-status" role="status">{message}</div>}
        <div className="grid-4">
          {Object.entries(SERVICE_INFO).map(([name, info]) => {
            const running = getServiceStatus(name) === "running";
            return (
              <div key={name} className="service-card">
                <div className={`dot ${running ? "running" : "stopped"}`} />
                <div className="service-card-info">
                  <div className="service-card-name">{info.label}</div>
                  <div className="service-card-detail">{running ? info.detail : "Offline"}</div>
                </div>
                <div className="service-card-port">:{info.port}</div>
                {info.controllable && (
                  <button className={`btn btn-sm ${running ? "" : "btn-primary"}`} disabled={busyService === info.id} onClick={() => handleService(info.id, running ? "stop" : "start")}>
                    {busyService === info.id ? "…" : running ? "Stop" : "Start"}
                  </button>
                )}
                {info.url && running && <button className="btn btn-sm" onClick={() => handleOpen(`https://${info.url}.${tld}`)}>Open</button>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="section-gap">
        <div className="card-header" style={{ marginBottom: 10 }}>
          <span className="card-title">Quick Links</span>
        </div>
        <div className="grid-3">
          <div className="service-card service-card-link" onClick={() => handleOpen(`https://damp.${tld}`)}>
            <div className="service-card-info">
              <div className="service-card-name">Dashboard</div>
              <div className="service-card-detail">damp.{tld}</div>
            </div>
          </div>
          <div className="service-card service-card-link" onClick={() => handleOpen(`https://pma.${tld}`)}>
            <div className="service-card-info">
              <div className="service-card-name">PHPMyAdmin</div>
              <div className="service-card-detail">pma.{tld}</div>
            </div>
          </div>
          <div className="service-card service-card-link" onClick={() => handleOpen(`https://mail.${tld}`)}>
            <div className="service-card-info">
              <div className="service-card-name">Mailpit</div>
              <div className="service-card-detail">mail.{tld}</div>
            </div>
          </div>
        </div>
      </div>

      {projects.length > 0 && (
        <div className="card" style={{ cursor: "pointer" }} onClick={() => onNavigate("projects")}>
          <div className="card-header">
            <span className="card-title">Recent Projects</span>
            <span className="btn btn-sm btn-primary">View All</span>
          </div>
          {projects.slice(0, 3).map((p) => {
            const running = p.status === "running";
            return (
              <div key={p.path} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <div className={`dot ${running ? "running" : ""}`} />
                <span style={{ fontSize: 11 }}>{p.name}</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{running ? "running" : "stopped"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
