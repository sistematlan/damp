import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DampStatus } from "../types";
import { t } from "../i18n/translations";

interface LogsProps {
  status: DampStatus;
}

export default function Logs({ status }: LogsProps) {
  const containers = status.containers.filter((c) => c.is_damp);
  const [selected, setSelected] = useState("");
  const [logs, setLogs] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [polling, setPolling] = useState(false);
  const viewerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (containers.length > 0 && !selected) {
      setSelected(containers[0].name);
    }
  }, [containers]);

  useEffect(() => {
    if (!selected || !polling) return;

    const eventSource = new EventSource(`http://localhost:9000/api/containers/${selected}/logs`);
    
    eventSource.onmessage = (event) => {
      setLogs((prev) => prev + event.data + "\n");
    };

    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      setLogs((prev) => prev + "[Connection Error]\n");
      eventSource.close();
      setPolling(false);
    };

    return () => {
      eventSource.close();
    };
  }, [selected, polling]);

  useEffect(() => {
    if (autoScroll && viewerRef.current) {
      viewerRef.current.scrollTop = viewerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleStart = () => {
    setPolling(true);
  };

  const handleStop = () => {
    setPolling(false);
  };

  return (
    <div>
      <div className="log-controls">
        <select
          className="input"
          style={{ width: 200 }}
          value={selected}
          onChange={(e) => { setSelected(e.target.value); setLogs(""); }}
        >
          <option value="">{t("selectContainer")}</option>
          {containers.map((c) => (
            <option key={c.name} value={c.name}>{c.name} ({c.status})</option>
          ))}
        </select>
        {!polling ? (
          <button className="btn btn-primary" onClick={handleStart} disabled={!selected}>
            Start
          </button>
        ) : (
          <button className="btn btn-danger" onClick={handleStop}>
            Stop
          </button>
        )}
        <button className="btn" onClick={() => setLogs("")}>{t("clearLogs")}</button>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-dim)", cursor: "pointer" }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          {t("autoScroll")}
        </label>
      </div>

      {!selected ? (
        <div className="log-empty">{t("noLogs")}</div>
      ) : (
        <pre ref={viewerRef} className="log-viewer">
          {logs || (polling ? <span className="pulse">{t("copyingLogs")}</span> : t("noLogs"))}
        </pre>
      )}
    </div>
  );
}
