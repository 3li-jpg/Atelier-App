import { useState } from "react";
import type { Event } from "@atelier/schema";
import { classifyEvent, stateTone } from "../lib.ts";
import { DiffViewer } from "./DiffViewer.tsx";
import { ToolFeed } from "./ToolFeed.tsx";

// T7.2: typed event cells. tool_call collapsed w/ exit-code badge; question
// renders quick-reply chips that POST /sessions/:id/reply. Payload shapes come
// from the supervisor (handoff T7.2 supervisor-side channel still open) so
// every field is read defensively — unknown types fall back to a <details> dump.
export function EventCell({ event, onReply }: { event: Event; onReply: (text: string) => void }) {
  const variant = classifyEvent(event.type);
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const ts = new Date(event.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (variant === "assistant") {
    const text = String(p.text ?? "");
    return (
      <article
        className="cell assistant"
        role="article"
        aria-label={`Assistant message at ${ts}`}
      >
        <div className="bubble">{text}</div>
        <time className="muted small" dateTime={event.ts}>{ts}</time>
      </article>
    );
  }

  if (variant === "user") {
    const text = String(p.text ?? "");
    return (
      <article
        className="cell user"
        role="article"
        aria-label={`Your message at ${ts}`}
      >
        <div className="bubble">{text}</div>
      </article>
    );
  }

  if (variant === "question") {
    return (
      <QuestionCell
        prompt={String(p.prompt ?? p.message ?? "")}
        options={Array.isArray(p.options) ? p.options.map(String) : []}
        onReply={onReply}
        ts={ts}
        eventTs={event.ts}
      />
    );
  }

  if (variant === "tool_call") {
    return (
      <ToolFeed
        tool={String(p.tool ?? p.name ?? "tool")}
        status={typeof p.status === "string" ? p.status : "done"}
        exitCode={typeof (p.exit_code ?? p.exitcode) === "number" ? Number(p.exit_code ?? p.exitcode) : undefined}
        duration={typeof p.duration === "number" ? p.duration : undefined}
        summary={p.summary ?? p.args ?? p.output}
      />
    );
  }

  if (variant === "error") {
    const msg = String(p.message ?? JSON.stringify(p));
    return (
      <article
        className="cell error"
        role="alert"
        aria-label={`Error at ${ts}: ${msg}`}
      >
        <div className="bubble">{msg}</div>
      </article>
    );
  }

  if (variant === "state") {
    const to = String(p.state ?? "");
    return (
      <div
        className="cell state"
        role="status"
        aria-label={`State changed to ${to} at ${ts}`}
      >
        <span className={`pill tone-${stateTone(to)}`}>{to}</span>
        <time className="muted small" dateTime={event.ts}>{ts}</time>
      </div>
    );
  }

  if (variant === "commit") {
    const sha = String(p.sha ?? "").slice(0, 7);
    const message = String(p.message ?? "");
    return (
      <article
        className="cell commit"
        role="article"
        aria-label={`Commit ${sha} at ${ts}: ${message}`}
      >
        <span aria-hidden="true">⌥ </span>
        commit {sha} — {message}
      </article>
    );
  }

  if (variant === "diff") {
    // Render path(s) always; if the bridge forwarded per-file content (hunks/
    // patch), show it in an expandable <details> via DiffViewer.
    const files = (Array.isArray(p.files) ? p.files : []) as { path?: string; content?: unknown }[];
    const label = String(p.path ?? p.file ?? (files[0]?.path ?? "diff"));
    const inline = p.content ?? null;
    const contentFiles = files.filter((f) => f && f.content != null);
    if (contentFiles.length === 0 && inline == null) {
      return <DiffViewer path={label} content={null} />;
    }
    if (inline != null) {
      return <DiffViewer path={label} content={inline} />;
    }
    return <DiffViewer path={label} content={contentFiles.map((f) => f.content).join("\n")} />;
  }

  return (
    <details className="cell verbose" aria-label={`Event: ${event.type}`}>
      <summary className="muted small">{event.type}</summary>
      <pre aria-label={`Raw payload for ${event.type} event`}>{JSON.stringify(p, null, 2)}</pre>
    </details>
  );
}

function QuestionCell({
  prompt, options, onReply, ts, eventTs,
}: {
  prompt: string; options: string[]; onReply: (t: string) => void; ts: string; eventTs: string;
}) {
  const [answered, setAnswered] = useState(false);
  if (answered) {
    return (
      <article
        className="cell question answered"
        role="article"
        aria-label={`Answered question: ${prompt}`}
      >
        <div className="bubble">{prompt}</div>
      </article>
    );
  }
  return (
    <article
      className="cell question"
      role="form"
      aria-label={`Question requires response: ${prompt}`}
    >
      <div className="bubble">{prompt}</div>
      {options.length > 0 && (
        <div className="chips" role="group" aria-label="Quick reply options">
          {options.map((o) => (
            <button
              key={o}
              className="chip"
              onClick={() => { onReply(o); setAnswered(true); }}
              aria-label={`Reply: ${o}`}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <time className="muted small" dateTime={eventTs}>{ts}</time>
    </article>
  );
}
