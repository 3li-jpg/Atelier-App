import { useEffect, useRef, useState } from "react";
import { api, type SessionSummary, type ProviderSummary } from "../api.ts";
import { formatRelTime } from "../lib.ts";
import { Button, Skeleton, useToast } from "@atelier/ui";
import { StateMessage } from "../components/StateMessage.tsx";
import { humanizeApiError, humanizeToast, parseBillingError } from "./humanize.ts";
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
          description="Describe a task in the composer above, or import a repo from Repos."
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
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
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
    setUpgradeUrl(null);
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
      const billing = parseBillingError(e);
      if (billing?.upgrade_url) {
        setErr(billing.message);
        setUpgradeUrl(billing.upgrade_url);
      } else {
        setErr(humanizeApiError(e).message);
      }
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
        <div className="qs-bar">
          <div className="qs-bar-left">
            <button
              type="button"
              className="qs-chip qs-chip--btn"
              onClick={() => setShowOpts((v) => !v)}
              aria-expanded={showOpts}
            >
              <span>Options</span>
              <svg className="qs-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <span className="qs-chip">
              {selectedProvider?.name ?? "—"} · {modelId || "no model"}
            </span>
            <span className="qs-chip">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              <span>{repoUrl ? repoLabel(repoUrl) : "blank workspace"}</span>
            </span>
          </div>
          <button
            type="button"
            className="qs-send"
            onClick={send}
            disabled={!canSend}
            aria-label="Start workspace"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
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
      </div>
      {err && (
        <div className="qs-error">
          {err}
          {upgradeUrl && (
            <>
              {" "}
              <a href={upgradeUrl} className="qs-upgrade-link">
                Upgrade
              </a>
            </>
          )}
        </div>
      )}
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
  const pulse = statusDot(s.state).live;
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
      <Button variant="ghost" onClick={() => onOpen(s.id)} className="session-card">
        <span className="session-top">
          <span className="session-task">{s.task}</span>
          <span className="session-time">{formatRelTime(s.started_at)}</span>
        </span>
        <span className="session-meta">
          <span className="session-status">
            <span className={`session-status-dot${pulse ? " is-live" : ""}`} style={statusDotColor(s.state)} />
            <span className="session-status-label">{s.state}</span>
          </span>
          <svg className="session-repo-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span className="session-repo">{s.repo_url ? repoLabel(s.repo_url) : "blank workspace"}</span>
          <span className="session-dot-sep">·</span>
          <span className="session-model">{s.model_id}</span>
        </span>
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
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
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

// Explicit status table — returns the status-dot color and whether the dot
// should pulse (live states only). Pulse moved off the whole-card box-shadow
// onto the dot itself.
function statusDot(state: string): { color: string; live: boolean } {
  switch (state) {
    case "running":
    case "starting":
    case "active":
    case "spawning":
      return { color: "var(--accent)", live: true };
    case "queued":
      return { color: "var(--warn)", live: false };
    case "completed":
    case "done":
      return { color: "var(--ok)", live: false };
    case "failed":
    case "error":
      return { color: "var(--bad)", live: false };
    case "cancelled":
      return { color: "var(--muted)", live: false };
    case "awaiting_user":
    case "hibernated":
      return { color: "var(--warn)", live: false };
    default:
      return { color: "var(--muted)", live: false };
  }
}

function statusDotColor(state: string): React.CSSProperties {
  return { background: statusDot(state).color };
}

// Strip trailing .git and leading github.com host; non-github URLs fall back
// to the pathname so something useful always shows.
function repoLabel(repo_url: string): string {
  if (!repo_url) return "blank workspace";
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
