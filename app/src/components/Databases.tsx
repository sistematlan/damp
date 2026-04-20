import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DampStatus } from "../types";
import { t } from "../i18n/translations";

interface DatabasesProps {
  status: DampStatus;
  onRefresh: () => void;
}

export default function Databases({ status, onRefresh }: DatabasesProps) {
  const [newDbName, setNewDbName] = useState("");
  const [dbEngine, setDbEngine] = useState("mysql");
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const clearMessage = () => setTimeout(() => setMessage(null), 3000);

  const handleCreate = async () => {
    if (!newDbName.trim()) return;
    try {
      const result = await invoke<string>("create_database", { name: newDbName, engine: dbEngine });
      setMessage({ text: result, type: "success" });
      setNewDbName("");
      onRefresh();
    } catch (e) {
      setMessage({ text: String(e), type: "error" });
    }
    clearMessage();
  };

  const handleDrop = async (name: string, engine: string) => {
    if (!confirm(`${t("confirmDropDb")} "${name}" (${engine})?`)) return;
    try {
      await invoke("drop_database", { name, engine });
      onRefresh();
    } catch (e) {
      setMessage({ text: String(e), type: "error" });
      clearMessage();
    }
  };

  const redis = status.redis;

  return (
    <div>
      {message && <div className={`inline-status ${message.type}`}>{message.text}</div>}

      <div className="db-panel">
        <div className="db-panel-header">
          <span className="db-panel-title">
            <span style={{ fontSize: 14 }}>M</span> {t("mysqlDatabases")}
            <span className="db-count">{status.databases.length}</span>
          </span>
        </div>
        <div className="db-create-row">
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder={t("dbName")}
            value={dbEngine === "mysql" ? newDbName : ""}
            onChange={(e) => setNewDbName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dbEngine === "mysql" && handleCreate()}
            onFocus={() => setDbEngine("mysql")}
          />
          <button className="btn btn-primary" onClick={handleCreate} disabled={dbEngine !== "mysql"}>
            {t("createDb")}
          </button>
        </div>
        <div className="db-list">
          {status.databases.length === 0 ? (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No MySQL databases</span>
          ) : (
            status.databases.map((db) => (
              <div key={db.name} className="db-chip">
                {db.name}
                <span className="db-chip-remove" onClick={() => handleDrop(db.name, "mysql")}>x</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="db-panel">
        <div className="db-panel-header">
          <span className="db-panel-title">
            <span style={{ fontSize: 14 }}>P</span> {t("postgresDatabases")}
            <span className="db-count">{status.postgres_databases.length}</span>
          </span>
        </div>
        <div className="db-create-row">
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder={t("dbName")}
            value={dbEngine === "postgres" ? newDbName : ""}
            onChange={(e) => setNewDbName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dbEngine === "postgres" && handleCreate()}
            onFocus={() => setDbEngine("postgres")}
          />
          <button className="btn btn-primary" onClick={handleCreate} disabled={dbEngine !== "postgres"}>
            {t("createDb")}
          </button>
        </div>
        <div className="db-list">
          {status.postgres_databases.length === 0 ? (
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>No PostgreSQL databases</span>
          ) : (
            status.postgres_databases.map((db) => (
              <div key={db.name} className="db-chip">
                {db.name}
                <span className="db-chip-remove" onClick={() => handleDrop(db.name, "postgres")}>x</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="redis-card">
        <div className="redis-header">
          <span className="db-panel-title">
            <span style={{ fontSize: 14 }}>R</span> {t("redisStatus")}
            <span className={`badge ${redis.connected ? "badge-running" : "badge-stopped"}`}>
              {redis.connected ? t("connected") : t("offline")}
            </span>
          </span>
        </div>
        {redis.connected ? (
          <div className="redis-stats">
            <div>
              <div className="redis-stat-label">{t("version_")}</div>
              <div className="redis-stat-val">{redis.version || "-"}</div>
            </div>
            <div>
              <div className="redis-stat-label">{t("memory")}</div>
              <div className="redis-stat-val">{redis.memory || "-"}</div>
            </div>
            <div>
              <div className="redis-stat-label">{t("keys")}</div>
              <div className="redis-stat-val">{redis.keys}</div>
            </div>
          </div>
        ) : (
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Redis is not running</span>
        )}
      </div>
    </div>
  );
}
