import { useEffect, useState } from "react";
import { api, type SessionSummary } from "../api.ts";
import { formatRelTime, stateTone } from "../lib.ts";
import { Button, Badge, Card, Skeleton } from "@atelier/ui";

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
        <div className="padded" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <Skeleton height="5rem" radius="var(--radius)" />
          <Skeleton height="5rem" radius="var(--radius)" />
          <Skeleton height="5rem" radius="var(--radius)" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="muted padded">no sessions yet — create one from the New tab</p>
      ) : (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <Card variant="default" className="session-row" style={{ padding: 0 }}>
                <Button
                  variant="ghost"
                  onClick={() => onOpen(s.id)}
                  style={{ width: "100%", textAlign: "left", justifyContent: "flex-start", flexDirection: "column", alignItems: "stretch", gap: "0.25rem", border: "none", borderRadius: "var(--radius)", padding: "0.7rem 0.9rem" }}
                >
                  <div className="row-top">
                    <Badge tone={stateTone(s.state)}>{s.state}</Badge>
                    <span className="muted small">{formatRelTime(s.started_at)}</span>
                  </div>
                  <div className="row-task">{s.task}</div>
                  <div className="muted small">
                    {s.repo_url.replace(/\.git$/, "").replace(/^https:\/\/github\.com\//, "")} · {s.branch} · {s.model_id}
                  </div>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
