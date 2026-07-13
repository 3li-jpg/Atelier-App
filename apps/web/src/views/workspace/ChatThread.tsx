import { useState } from "react";
import type { Event } from "@atelier/schema";
import { stateTone } from "../../lib.ts";

// Chat-first thread renderer. Maps each event type to a chat-appropriate
// surface: user → right bubble, assistant → unbubbled text, tool_call →
// collapsible one-liner, file_diff → glass diff card, question → inline
// action row, error → tinted alert, commit → PR bar, state → inline chip.
// All payloads read defensively (bridge shapes are not yet pinned).

type ToolStatus = "running" | "ok" | "fail";

function toolStatus(p: Record<string, unknown>): ToolStatus {
  const status = typeof p.status === "string" ? p.status : "done";
  if (status === "running") return "running";
  const code = p.exit_code ?? p.exitcode;
  if (typeof code === "number") return code === 0 ? "ok" : "fail";
  return status === "done" || status === "ok" || status === "succeeded" ? "ok" : "fail";
}

function toolLabel(s: ToolStatus, code?: number): string {
  if (s === "running") return "running";
  if (s === "ok") return "ok";
  return code != null ? `exit ${code}` : "failed";
}

type TodoItem = { text: string; done: boolean };

// Latest todo list — last todo event wins, items optional.
// ponytail: e.type is a zod enum that hasn't added "todo"/"subagent" yet
// (schema is out of scope); widen to string so these forward-compat events
// still match when the bridge ships them.
export function latestTodos(events: Event[]): TodoItem[] {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if ((e.type as string) !== "todo") continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const items = Array.isArray(p.items) ? p.items : [];
    return items.map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        text: String(o.text ?? o.label ?? o.title ?? ""),
        done: Boolean(o.done ?? o.completed ?? o.checked ?? false),
      };
    });
  }
  return [];
}

type SubagentInfo = { status: string; goal: string; summary: string };

// All subagent events, newest last.
export function collectSubagents(events: Event[]): SubagentInfo[] {
  const out: SubagentInfo[] = [];
  for (const e of events) {
    if ((e.type as string) !== "subagent") continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    out.push({
      status: String(p.status ?? "running"),
      goal: String(p.goal ?? p.name ?? ""),
      summary: String(p.summary ?? p.result ?? ""),
    });
  }
  return out;
}

export function ChatThread({
  events,
  isStreaming,
  pendingQuestionSeq,
  repoName,
  onReply,
  onOpenFile,
  selectedFile,
}: {
  events: Event[];
  isStreaming: boolean;
  pendingQuestionSeq: number | undefined;
  repoName: string;
  onReply: (text: string) => void;
  onOpenFile: (path: string) => void;
  selectedFile: string | null;
}) {
  if (events.length === 0) {
    return <Welcome repoName={repoName} onPick={onReply} />;
  }

  return (
    <div className="ws-thread" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
      <div className="ws-thread-inner">
        {events.map((e) => (
          <ThreadItem
            key={e.seq ?? e.ts}
            event={e}
            pending={pendingQuestionSeq === e.seq}
            onReply={onReply}
            onOpenFile={onOpenFile}
            selectedFile={selectedFile}
          />
        ))}
        {isStreaming && (
          <div className="ws-typing" role="status" aria-label="Assistant is working">
            <span className="ws-typing-dot" aria-hidden="true" />
            <span className="ws-typing-dot" aria-hidden="true" />
            <span className="ws-typing-dot" aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}

function Welcome({ repoName, onPick }: { repoName: string; onPick: (t: string) => void }) {
  const prompts = [
    "Explain the architecture of this repo",
    "Find and fix a bug",
    "Add a test for the core module",
  ];
  return (
    <div className="ws-thread" role="log" aria-label="Conversation">
      <div className="ws-welcome view-fade" role="status">
        {repoName && <span className="ws-welcome-repo">{repoName}</span>}
        <h2>What should we build?</h2>
        <div className="ws-welcome-prompts">
          {prompts.map((p) => (
            <button
              key={p}
              className="ws-welcome-prompt"
              onClick={() => onPick(p)}
              aria-label={`Start with: ${p}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThreadItem({
  event,
  pending,
  onReply,
  onOpenFile,
  selectedFile,
}: {
  event: Event;
  pending: boolean;
  onReply: (text: string) => void;
  onOpenFile: (path: string) => void;
  selectedFile: string | null;
}) {
  const p = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.type) {
    case "user_message": {
      return (
        <div className="ws-msg ws-msg-user view-fade" role="listitem" aria-label="Your message">
          <div className="ws-bubble">{String(p.text ?? "")}</div>
        </div>
      );
    }
    case "assistant_text": {
      const text = String(p.text ?? "");
      if (!text) return null;
      return (
        <div className="ws-msg ws-msg-assistant view-fade" role="listitem" aria-label="Assistant message">
          <div className="ws-text">{text}</div>
        </div>
      );
    }
    case "tool_call": {
      return <ToolRow event={event} />;
    }
    case "file_diff": {
      return <DiffCard event={event} onOpen={onOpenFile} selected={selectedFile} />;
    }
    case "question": {
      return <QuestionRow event={event} pending={pending} onReply={onReply} />;
    }
    case "error": {
      const msg = String(p.message ?? JSON.stringify(p));
      return (
        <div className="ws-error view-fade" role="alert" aria-label={`Error: ${msg}`}>
          {msg}
        </div>
      );
    }
    case "commit": {
      return <CommitBar event={event} />;
    }
    case "state_change": {
      const to = String(p.state ?? "");
      return (
        <div className={`ws-state tone-${stateTone(to)}`} role="status" aria-label={`State changed to ${to}`}>
          {to}
        </div>
      );
    }
    default:
      return null;
  }
}

function ToolRow({ event }: { event: Event }) {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const [open, setOpen] = useState(false);
  const status = toolStatus(p);
  const code = typeof (p.exit_code ?? p.exitcode) === "number" ? Number(p.exit_code ?? p.exitcode) : undefined;
  const tool = String(p.tool ?? p.name ?? "tool");
  const duration = typeof p.duration === "number" ? p.duration : undefined;
  const summary = p.summary ?? p.args ?? p.output;
  const ts = new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const hasDetail = summary != null;

  return (
    <div className="ws-tool view-fade" data-expanded={open} role="listitem">
      <button
        className="ws-tool-row"
        onClick={() => hasDetail && setOpen((o) => !o)}
        aria-expanded={hasDetail ? open : undefined}
        aria-label={`Tool ${tool}, ${toolLabel(status, code)}${duration != null ? `, ${duration}s` : ""}`}
      >
        <span className="ws-tool-chevron" aria-hidden="true">{hasDetail ? "▸" : "·"}</span>
        <span className={`ws-tool-dot ${status}`} aria-hidden="true" />
        <span className="ws-tool-name">{tool}</span>
        <span className="ws-tool-meta">
          {toolLabel(status, code)}{duration != null ? ` · ${duration}s` : ""} · {ts}
        </span>
      </button>
      {open && hasDetail && (
        <div className="ws-tool-detail">
          <pre aria-label={`Output for ${tool}`}>
            {typeof summary === "string" ? summary : JSON.stringify(summary, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function DiffCard({
  event,
  onOpen,
  selected,
}: {
  event: Event;
  onOpen: (path: string) => void;
  selected: string | null;
}) {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const files = (Array.isArray(p.files) ? p.files : []) as { path?: string; content?: unknown }[];
  const path = String(p.path ?? p.file ?? files[0]?.path ?? "diff");
  const content = p.content ?? files[0]?.content ?? null;
  const [open, setOpen] = useState(false);
  const text = content == null ? null : typeof content === "string" ? content : JSON.stringify(content, null, 2);

  return (
    <div className="ws-diff-card view-fade" role="listitem" aria-label={`File diff: ${path}`}>
      <button
        className="ws-diff-head"
        onClick={() => onOpen(path)}
        aria-label={`Open diff for ${path} in panel`}
      >
        <span className="ws-diff-icon" aria-hidden="true">▤</span>
        <span className="ws-diff-path">{path}</span>
        <span className="ws-diff-open" aria-hidden="true">{selected === path ? "viewing →" : "open →"}</span>
      </button>
      {open && text != null && (
        <div className="ws-diff-body" role="article" aria-label={`Diff content for ${path}`}>
          {text.split("\n").slice(0, 200).map((line, i) => {
            const cls = line.startsWith("+") && !line.startsWith("+++")
              ? "add"
              : line.startsWith("-") && !line.startsWith("---")
                ? "del"
                : line.startsWith("@@")
                  ? "hunk"
                  : "";
            return (
              <div key={i} className={`ws-diff-line ${cls}`}>
                <span>{line}</span>
              </div>
            );
          })}
        </div>
      )}
      <button
        className="ws-diff-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Hide inline diff" : "Expand inline diff"}
      >
        {open ? "Hide inline diff" : "Show inline diff"}
      </button>
    </div>
  );
}

function QuestionRow({
  event,
  pending,
  onReply,
}: {
  event: Event;
  pending: boolean;
  onReply: (text: string) => void;
}) {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const prompt = String(p.prompt ?? p.message ?? "");
  const options = Array.isArray(p.options) ? p.options.map(String) : [];
  const requestId = typeof p.request_id === "string" ? p.request_id : undefined;
  const [answered, setAnswered] = useState(false);

  // Approval-style: no options → Approve/Deny (deny sends "no"/"deny").
  const isApproval = options.length === 0;

  const reply = (text: string) => {
    onReply(text);
    setAnswered(true);
  };

  return (
    <div className={`ws-question view-fade ${answered ? "answered" : ""}`} role="form" aria-label={`Question: ${prompt}`}>
      <div className="ws-question-prompt">{prompt}</div>
      <div className="ws-question-actions">
        {isApproval ? (
          <>
            <button
              className="ws-chip approve"
              onClick={() => reply(requestId ? `${requestId}:approve` : "approve")}
              disabled={answered || !pending}
              aria-label="Approve"
            >
              Approve
            </button>
            <button
              className="ws-chip deny"
              onClick={() => reply(requestId ? `${requestId}:deny` : "deny")}
              disabled={answered || !pending}
              aria-label="Deny"
            >
              Deny
            </button>
          </>
        ) : (
          options.map((o) => (
            <button
              key={o}
              className="ws-chip"
              onClick={() => reply(o)}
              disabled={answered || !pending}
              aria-label={`Reply: ${o}`}
            >
              {o}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function CommitBar({ event }: { event: Event }) {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const sha = String(p.sha ?? "").slice(0, 7);
  const message = String(p.message ?? "");
  const url = typeof p.url === "string" ? p.url : null;
  const branch = String(p.branch ?? "");
  return (
    <div className="ws-commit view-fade" role="status" aria-label={`Commit ${sha}: ${message}`}>
      <span className="ws-commit-badge" aria-hidden="true">PR</span>
      <span className="ws-commit-sha">{sha}</span>
      <span className="ws-commit-msg ellipsis">{message}</span>
      {branch && <span className="ws-commit-count">{branch}</span>}
      {url && (
        <a className="ws-commit-link" href={url} target="_blank" rel="noopener noreferrer" aria-label={`View commit ${sha} (opens new tab)`}>
          view →
        </a>
      )}
    </div>
  );
}
