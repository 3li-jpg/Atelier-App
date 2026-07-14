import { useEffect, useRef, useState } from "react";
import { api, type SessionSummary, type ProviderSummary } from "../api.ts";
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

  const removeSession = (id: string) =>
    setSessions((prev) => (prev ? prev.filter((x) => x.id !== id) : prev));

  return (
    <div className="sessions-wrap">
      <QuickStart sessions={sessions} onCreated={onOpen} />
      {sessions.length === 0 ? (
        <StateMessage
          kind="empty"
          title="No workspaces yet"
          description="Type above to start a chat, or import a repo from the Repos tab."
        />
      ) : (
        <ul className="session-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <SessionCard session={s} onOpen={onOpen} onDeleted={removeSession} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// QuickStart — the chat-first entry point. Type + Enter → create a session with
// sensible defaults and drop into it. No tab-hopping, no multi-step sheet.
// Defaults: the most recent session's repo + model; else the first provider's
// first model with no repo (blank scratchpad). A repo picker collapses the
// Repos-tab flow into one inline control for when you DO want a repo.
function QuickStart({
  sessions,
  onCreated,
}: {
  sessions: SessionSummary[];
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.listProviders().then(setProviders).catch(() => {});
  }, []);

  // Seed defaults from the most recent session that had a repo+model, falling
  // back to the first provider/model. repoUrl empty = blank scratchpad.
  const last = sessions.find((s) => s.model_id) ?? sessions[0];
  const defaultProvider = providers.find((p) => p.models.some((m) => m.id === last?.model_id)) ?? providers[0];
  const defaultModel = last?.model_id ?? defaultProvider?.models[0]?.id ?? "";

  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [showOpts, setShowOpts] = useState(false);

  // Apply defaults once providers load (and when they change identity).
  useEffect(() => {
    if (!defaultProvider || providerId) return;
    setProviderId(defaultProvider.id);
    setModelId(defaultModel);
    if (last?.repo_url) setRepoUrl(last.repo_url);
  }, [defaultProvider, defaultModel, last, providerId]);

  const selectedProvider = providers.find((p) => p.id === providerId) ?? null;
  const noProviders = providers.length === 0;

  const canSend = Boolean(!sending && !noProviders && modelId && text.trim());

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setErr(null);
    try {
      const res = await api.createSession({
        repo_url: repoUrl.trim() || undefined,
        provider_id: providerId,
        model_id: modelId,
        task: text.trim(),
      });
      setText("");
      onCreated(res.id);
    } catch (e) {
      setErr(humanizeApiError(e).message);
      toast.push(humanizeToast(e), "error");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (noProviders) {
    return (
      <div className="qs-wrap">
        <div className="qs-empty">
          Add a model provider first — open the <strong>Providers</strong> tab to add an API key.
        </div>
      </div>
    );
  }

  return (
    <div className="qs-wrap">
      <div className="qs-composer">
        <textarea
          ref={ref}
          className="qs-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything, or paste a GitHub repo URL to work on it…"
          rows={1}
          aria-label="Start a new workspace"
        />
        <button
          type="button"
          className="qs-send"
          onClick={send}
          disabled={!canSend}
          aria-label="Start workspace"
        >
          {sending ? "…" : "→"}
        </button>
      </div>
      <div className="qs-meta">
        <button
          type="button"
          className="qs-toggle"
          onClick={() => setShowOpts((v) => !v)}
          aria-expanded={showOpts}
        >
          {showOpts ? "Hide options" : "Options"}
        </button>
        <span className="qs-summary">
          {selectedProvider?.name ?? "—"} · {modelId || "no model"}
          {repoUrl ? ` · ${repoLabel(repoUrl)}` : " · blank workspace"}
        </span>
      </div>
      {showOpts && (
        <div className="qs-opts">
          <label className="qs-field">
            <span>Provider</span>
            <select className="atelier-select" value={providerId} onChange={(e) => { setProviderId(e.target.value); setModelId(""); }}>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="qs-field">
            <span>Model</span>
            <select className="atelier-select" value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">select…</option>
              {selectedProvider?.models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
            </select>
          </label>
          <label className="qs-field qs-field-wide">
            <span>Repo URL (optional)</span>
            <input
              className="atelier-input"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/owner/repo — leave empty for a blank workspace"
            />
          </label>
        </div>
      )}
      {err && <div className="qs-error">{err}</div>}
    </div>
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
