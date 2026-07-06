import { useEffect, useState } from "react";
import { api, type SessionSummary } from "../api.ts";
import { formatRelTime, stateTone } from "../lib.ts";

export function SessionsList({ onOpen }: { onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.listSessions().then(setSessions).catch((e) => { setSessions([]); setErr(String(e)); });
  };
  useEffect(load, []);

  return (
    <>
      {err && <div className="error padded">{err}</div>}
      {sessions === null ? (
        <p className="muted padded">loading…</p>
      ) : sessions.length === 0 ? (
        <p className="muted padded">no sessions yet — create one from the New tab</p>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <button className="session-row" onClick={() => onOpen(s.id)}>
                <div className="row-top">
                  <span className={`pill tone-${stateTone(s.state)}`}>{s.state}</span>
                  <span className="muted small">{formatRelTime(s.started_at)}</span>
                </div>
                <div className="row-task">{s.task}</div>
                <div className="muted small">
                  {s.repo_url.replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "")} · {s.branch} · {s.model_id}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
