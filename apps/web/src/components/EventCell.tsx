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
    return (
      <div className="cell assistant">
        <div className="bubble">{String(p.text ?? "")}</div>
        <time className="muted small">{ts}</time>
      </div>
    );
  }

  if (variant === "user") {
    return (
      <div className="cell user">
        <div className="bubble">{String(p.text ?? "")}</div>
      </div>
    );
  }

  if (variant === "question") {
    return (
      <QuestionCell
        prompt={String(p.prompt ?? p.message ?? "")}
        options={Array.isArray(p.options) ? p.options.map(String) : []}
        onReply={onReply}
        ts={ts}
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
    return (
      <div className="cell error">
        <div className="bubble">{String(p.message ?? JSON.stringify(p))}</div>
      </div>
    );
  }

  if (variant === "state") {
    const to = String(p.state ?? "");
    return (
      <div className="cell state">
        <span className={`pill tone-${stateTone(to)}`}>{to}</span>
        <time className="muted small">{ts}</time>
      </div>
    );
  }

  if (variant === "commit") {
    return (
      <div className="cell commit">
        ⌥ commit {String(p.sha ?? "").slice(0, 7)} — {String(p.message ?? "")}
      </div>
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
    <details className="cell verbose">
      <summary className="muted small">{event.type}</summary>
      <pre>{JSON.stringify(p, null, 2)}</pre>
    </details>
  );
}

function QuestionCell({
  prompt, options, onReply, ts,
}: {
  prompt: string; options: string[]; onReply: (t: string) => void; ts: string;
}) {
  const [answered, setAnswered] = useState(false);
  if (answered) {
    return (
      <div className="cell question answered">
        <div className="bubble">{prompt}</div>
      </div>
    );
  }
  return (
    <div className="cell question">
      <div className="bubble">{prompt}</div>
      {options.length > 0 && (
        <div className="chips">
          {options.map((o) => (
            <button
              key={o}
              className="chip"
              onClick={() => { onReply(o); setAnswered(true); }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      <time className="muted small">{ts}</time>
    </div>
  );
}
