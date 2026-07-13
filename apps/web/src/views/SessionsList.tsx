import { useEffect, useRef, useState } from "react";
import { api, type SessionSummary } from "../api.ts";
import { formatRelTime } from "../lib.ts";
import { Button, Badge, Skeleton, useToast } from "@atelier/ui";
import type { BadgeTone } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";
import { humanizeApiError, humanizeToast } from "./humanize.ts";
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
        title="Couldn't load workspaces"
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
        title="No workspaces yet"
        description="Import a repo from the Repos tab to start your first workspace."
      />
    );
  }

  const removeSession = (id: string) =>
    setSessions((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));

  return (
    <ul className="session-list">
      {sessions.map((s) => (
        <li key={s.id}>
          <SessionCard session={s} onOpen={onOpen} onDeleted={removeSession} />
        </li>
      ))}
    </ul>
  );
}

function SessionCard({
  session: s,
  onOpen,
  onDeleted,
}: {
  session: SessionSummary;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terminal = s.state === "completed" || s.state === "failed" || s.state === "cancelled";
  const { tone, pulse } = statusBadge(s.state);
  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => () => clearTimer(), []);
  const askDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
    clearTimer();
    timer.current = setTimeout(() => setConfirming(false), 5000);
  };
  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
    clearTimer();
  };
  const confirmDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    clearTimer();
    setDeleting(true);
    try {
      await api.deleteSession(s.id);
      toast.push("Workspace removed", "success");
      onDeleted(s.id);
    } catch (e2) {
      toast.push(humanizeToast(e2), "error");
      setDeleting(false);
      setConfirming(false);
    }
  };
  return (
    <div className="session-card-wrap">
      <Button variant="ghost" onClick={() => onOpen(s.id)} className={`session-card${pulse ? " pulse" : ""}`}>
        <span className="session-top">
          <Badge tone={tone}>{s.state}</Badge>
          <span className="session-time muted small">{formatRelTime(s.started_at)}</span>
        </span>
        <span className="session-repo muted small">{repoLabel(s.repo_url)}</span>
        <span className="session-task">{s.task}</span>
        <span className="session-model muted small">{s.model_id}</span>
      </Button>
      {terminal &&
        (confirming ? (
          <span className="session-delete-prompt">
            Delete?
            <Button variant="danger" size="sm" onClick={confirmDelete} disabled={deleting} loading={deleting}>
              Confirm
            </Button>
            <Button variant="ghost" size="sm" onClick={cancelDelete}>
              Keep
            </Button>
          </span>
        ) : (
          <Button variant="ghost" size="sm" className="session-delete-btn" onClick={askDelete} aria-label="Delete workspace">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </Button>
        ))}
    </div>
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
