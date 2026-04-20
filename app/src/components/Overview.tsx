import { invoke } from "@tauri-apps/api/core";
import type { DampStatus, Project } from "../types";

interface OverviewProps {
  status: DampStatus;
  projects: Project[];
  onNavigate: (view: string) => void;
}

const SERVICE_INFO: Record<string, { label: string; detail: string; port: string; url?: string }> = {
  "damp-caddy": { label: "Caddy", detail: "Reverse Proxy / HTTPS", port: "443", url: "dashboard" },
  "damp-db": { label: "MySQL 8.4", detail: "Database", port: "3306" },
  "damp-postgres": { label: "PostgreSQL 16", detail: "Database", port: "5432" },
  "damp-redis": { label: "Redis 7", detail: "Cache", port: "6379" },
  "damp-mailpit": { label: "Mailpit", detail: "SMTP Testing", port: "1025", url: "mail" },
  "damp-pma": { label: "PHPMyAdmin", detail: "DB Manager", port: "8080", url: "pma" },
};

export default function Overview({ status, projects, onNavigate }: OverviewProps) {
  const dampContainers = status.containers.filter((c) => c.is_damp);
  const tld = status.tld || "test";

  const getServiceStatus = (name: string) => {
    const c = status.containers.find((co) => co.name === name);
    return c?.status || "";
  };

  const handleOpen = (url: string) => {
    invoke("open_url", { url });
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
          <div className="stat-val">{dampContainers.filter((c) => c.status === "running").length}</div>
          <div className="stat-label">Services Up</div>
        </div>
      </div>

      <div className="section-gap">
        <div className="card-header" style={{ marginBottom: 10 }}>
          <span className="card-title">Services</span>
        </div>
        <div className="grid-4">
          {Object.entries(SERVICE_INFO).map(([name, info]) => {
            const running = getServiceStatus(name) === "running";
            const isLink = !!info.url;
            return (
              <div
                key={name}
                className={`service-card ${isLink && running ? "service-card-link" : ""}`}
                onClick={() => isLink && running && handleOpen(`https://${info.url}.${tld}`)}
              >
                <div className={`dot ${running ? "running" : "stopped"}`} />
                <div className="service-card-info">
                  <div className="service-card-name">{info.label}</div>
                  <div className="service-card-detail">{running ? info.detail : "Offline"}</div>
                </div>
                <div className="service-card-port">:{info.port}</div>
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
            const container = status.containers.find((c) => c.name.startsWith(p.name.replace(/-/g, "")) || c.name.startsWith(p.name));
            const running = container?.status === "running";
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
