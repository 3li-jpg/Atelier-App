import { useEffect, useState } from "react";
import { api, type SessionSummary } from "../api.ts";
import { formatRelTime } from "../lib.ts";
import { Button, Badge, Skeleton } from "@atelier/ui";
import type { BadgeTone } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";
import { humanizeApiError } from "./humanize.ts";
import "./sessions-list.css";

export function SessionsList({ onOpen }: { onOpen: (id: string) => void }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const load = () => {
    setErr(null);
    api
      .listSessions()
      .then(setSessions)
      .catch((e: unknown) => {
        setSessions([]);
        setErr(humanizeApiError(e).message);
      });
  };
  useEffect(load, [retryCount]);

  const retry = () => setRetryCount((n) => n + 1);

  if (err) {
    return (
      <StateMessage
        kind="error"
        title="Couldn't load sessions"
        description={err}
        action={<Button variant="ghost" size="sm" onClick={retry}>Retry</Button>}
      />
    );
  }
  if (sessions === null) {
    return (
      <div className="sessions-loading">
        <Skeleton height="5rem" radius="var(--radius)" />
        <Skeleton height="5rem" radius="var(--radius)" />
        <Skeleton height="5rem" radius="var(--radius)" />
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <StateMessage
        kind="empty"
        title="No sessions yet"
        description="Open the New tab and describe what you want built."
      />
    );
  }

  return (
    <ul className="session-list">
      {sessions.map((s) => {
        const { tone, pulse } = statusBadge(s.state);
        return (
          <li key={s.id}>
            <Button
              variant="ghost"
              onClick={() => onOpen(s.id)}
              className={`session-card${pulse ? " pulse" : ""}`}
            >
              <span className="session-top">
                <Badge tone={tone}>{s.state}</Badge>
                <span className="session-time muted small">{formatRelTime(s.started_at)}</span>
              </span>
              <span className="session-repo muted small">{repoLabel(s.repo_url)}</span>
              <span className="session-task">{s.task}</span>
              <span className="session-model muted small">{s.model_id}</span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

// Explicit status table — stateTone() mis-maps some of these (e.g. cancelled,
// queued). Pulse only for live states.
function statusBadge(state: string): { tone: BadgeTone; pulse: boolean } {
  switch (state) {
    case "running":
    case "starting":
    case "queued":
    case "active":
    case "spawning":
      return { tone: "accent", pulse: true };
    case "completed":
    case "done":
      return { tone: "ok", pulse: false };
    case "failed":
    case "error":
      return { tone: "bad", pulse: false };
    case "cancelled":
      return { tone: "idle", pulse: false };
    case "awaiting_user":
    case "hibernated":
      return { tone: "warn", pulse: false };
    default:
      return { tone: "default", pulse: false };
  }
}

// Strip trailing .git and leading github.com host; non-github URLs fall back
// to the pathname so something useful always shows.
function repoLabel(repo_url: string): string {
  let s = repo_url.trim().replace(/\.git$/, "");
  const gh = s.replace(/^https?:\/\/github\.com\//, "");
  if (gh !== s) return gh;
  try {
    const u = new URL(s);
    return u.pathname.replace(/^\//, "") || u.host;
  } catch {
    return s;
  }
}
