#!/usr/bin/env node
// bridge.mjs — relays between the OpenCode HTTP server API and the Atelier control plane.
// Zero-dependency (Node builtins only; fetch is global in Node 18+).
// Usage: node bridge.mjs  (reads env: SESSION_ID, EVENTS_URL, SESSION_TOKEN,
//   REPLIES_URL, TASK, OC_PORT, OC_PASSWORD)
import { setTimeout as sleep } from "node:timers/promises";

const {
  SESSION_ID = "",
  EVENTS_URL = "",
  SESSION_TOKEN = "",
  REPLIES_URL = "",
  TASK = "",
  OC_PORT = "4096",
  OC_PASSWORD = "",
} = process.env;

for (const [k, v] of [["TASK", TASK]]) {
  if (!v) { console.error(`bridge: ${k} is required`); process.exit(1); }
}

const BASE = `http://127.0.0.1:${OC_PORT}`;
const AUTH = "Basic " + Buffer.from(`opencode:${OC_PASSWORD}`).toString("base64");
const OC_HEADERS = { "Content-Type": "application/json", ...(OC_PASSWORD ? { Authorization: AUTH } : {}) };

// Step trace to stderr -> machine logs; the only visibility inside the VM.
const log = (...a) => console.error("bridge:", ...a);
// Every non-SSE fetch gets a deadline; a hung fetch here strands the session.
const T = (ms = 15_000) => ({ signal: AbortSignal.timeout(ms) });

// ---- control-plane helpers ----

function now() { return new Date().toISOString(); }

function postEvents(events) {
  if (!EVENTS_URL || events.length === 0) return Promise.resolve();
  return fetch(EVENTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SESSION_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(events),
    ...T(),
  }).then(
    (r) => { if (!r.ok) log(`event post rejected: ${r.status}`); },
    (e) => log(`event post failed: ${e.message}`),
  );
}

function emit(type, payload) {
  return postEvents([{ type, payload, ts: now() }]);
}

// ---- opencode server helpers ----

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/global/health`, { headers: OC_PASSWORD ? { Authorization: AUTH } : {}, ...T(5_000) });
      if (res.ok) {
        // ponytail: assuming /global/health returns {healthy:boolean, version:string}
        const body = await res.json();
        if (body.healthy) return;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error("opencode server did not become healthy within 30s");
}

async function createSession() {
  const res = await fetch(`${BASE}/session`, {
    method: "POST",
    headers: OC_HEADERS,
    body: JSON.stringify({}),
    ...T(30_000),
  });
  if (!res.ok) throw new Error(`POST /session failed: ${res.status} ${await res.text()}`);
  // ponytail: assuming POST /session returns {id:string}
  const body = await res.json();
  return body.id;
}

async function sendPrompt(sid, text = TASK) {
  const res = await fetch(`${BASE}/session/${sid}/prompt_async`, {
    method: "POST",
    headers: OC_HEADERS,
    // ponytail: assuming prompt_async body shape is {parts:[{type:"text",text}]}
    body: JSON.stringify({ parts: [{ type: "text", text }] }),
    ...T(30_000),
  });
  // ponytail: assuming prompt_async returns 204 on success
  if (!res.ok && res.status !== 204) {
    throw new Error(`prompt_async failed: ${res.status} ${await res.text()}`);
  }
}

async function replyQuestion(requestId, text) {
  const res = await fetch(`${BASE}/question/${requestId}/reply`, {
    method: "POST",
    headers: OC_HEADERS,
    // ponytail: assuming /question/{id}/reply body is {answers:[[text]]}
    body: JSON.stringify({ answers: [[text]] }),
    ...T(),
  });
  if (!res.ok) console.error(`bridge: question reply ${requestId} failed: ${res.status}`);
}

async function replyPermission(sid, permissionId, response) {
  const res = await fetch(`${BASE}/session/${sid}/permissions/${permissionId}`, {
    method: "POST",
    headers: OC_HEADERS,
    // ponytail: assuming /session/{sid}/permissions/{id} body is {response:"once"|"always"|"reject"}
    body: JSON.stringify({ response }),
    ...T(),
  });
  if (!res.ok) console.error(`bridge: permission reply ${permissionId} failed: ${res.status}`);
}

// ---- event mapping ----
// opencode SSE events are {id, type, properties: {...}}. The interesting content
// lives in `properties`. Mapped to Atelier event types (packages/schema).
// ponytail: shapes confirmed against a real `opencode serve` run (umans-glm-5.2);
// tighten further if other models emit different event names.

// pure metadata/noise — drop entirely (was flooding the timeline as `harness`)
const NOISE = new Set([
  "plugin.added", "server.connected", "server.heartbeat", "catalog.updated",
  "reference.updated", "integration.updated", "file.watcher.updated",
  "session.updated", "message.updated", "message.part.updated", "message",
]);

function mapEvent(eventName, data, sid, state) {
  const type = data.type ?? eventName ?? "";
  const p = data.properties ?? data;

  // session.diff -> file_diff; forward whatever per-file content opencode
  // exposes (paths always; hunks/patch if present) so the web can render it
  // once a diff viewer lands (audit M2 — full viewer still pending T1).
  if (type === "session.diff") {
    const diff = Array.isArray(p.diff) ? p.diff : [];
    if (!diff.length) return {};
    return { atelier: { type: "file_diff", payload: {
      paths: diff.map((d) => d.path ?? d.file ?? "?"),
      files: diff.map((d) => ({
        path: d.path ?? d.file ?? "?",
        content: d.content ?? d.diff ?? d.patch ?? d.hunks ?? null,
      })),
    } } };
  }

  if (NOISE.has(type)) return {};

  // streaming assistant text — the actual agent output
  if (type === "message.part.delta") {
    const text = p.delta ?? p.text ?? "";
    return text ? { atelier: { type: "assistant_text", payload: { text } } } : {};
  }

  // tool call
  if (type.startsWith("tool.")) {
    return { atelier: { type: "tool_call", payload: { tool: p.name ?? p.tool ?? type } } };
  }

  // permission request -> approval question
  if (type === "permission.updated" || type === "permission") {
    const id = p.id ?? p.permissionID ?? "";
    const prompt = p.title ?? p.metadata?.title ?? "Approve tool?";
    if (id) state.pendingRequests.push({ id, kind: "permission" });
    return { atelier: { type: "question", payload: { prompt, options: ["approve", "reject"], request_id: id, kind: "permission" } } };
  }

  // question tool -> question
  if (type === "question" || type === "question.updated") {
    const id = p.id ?? p.requestID ?? "";
    const prompt = p.question ?? p.title ?? p.prompt ?? "";
    const options = Array.isArray(p.options) ? p.options : [];
    if (id) state.pendingRequests.push({ id, kind: "question" });
    return { atelier: { type: "question", payload: { prompt, options, request_id: id, kind: "question" } } };
  }

  // file edited
  if (type === "file.edited" || type === "file") {
    return { atelier: { type: "file_diff", payload: {
      path: p.path ?? p.file ?? "",
      content: p.content ?? p.diff ?? p.patch ?? null,
    } } };
  }

  // session idle -> interactive lull: hand to user, keep relaying
  if (type === "session.idle" || (type === "session.status" && (p.status?.type === "idle" || p.status === "idle"))) {
    return { atelier: { type: "state_change", payload: { state: "awaiting_user" } } };
  }
  // busy -> running (defers the control plane's suspend timer)
  if (type === "session.status") {
    const busy = p.status?.type === "busy" || p.status === "busy";
    return busy ? { atelier: { type: "state_change", payload: { state: "running" } } } : {};
  }

  // session error
  if (type === "session.error") {
    return { atelier: { type: "error", payload: { message: p.message ?? p.error ?? JSON.stringify(p) } } };
  }

  // unknown, non-noise -> harness (rare; keeps a breadcrumb without the full blob)
  return { atelier: { type: "harness", payload: { event: type } } };
}

// ---- SSE consumer (manual parse, no EventSource dependency) ----

async function consumeSSE(sid, state) {
  const res = await fetch(`${BASE}/event`, { headers: OC_PASSWORD ? { Authorization: AUTH } : {} });
  if (!res.ok) throw new Error(`GET /event failed: ${res.status}`);
  if (!res.body) throw new Error("GET /event returned no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error("opencode SSE stream ended");
    // Normalize \r\n -> \n (\r is a single byte, safe to strip per-chunk)
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      let eventName = "";
      const dataLines = [];
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      const dataStr = dataLines.join("\n");
      if (!dataStr) continue;

      let data;
      try {
        data = JSON.parse(dataStr);
      } catch {
        postEvents([{ type: "harness", payload: { raw: dataStr }, ts: now() }]);
        continue;
      }

      const { atelier } = mapEvent(eventName, data, sid, state);
      if (atelier) {
        postEvents([{ ...atelier, ts: now() }]);
      }
    }
  }
}

// ---- replies poller ----

async function pollReplies(sid, state) {
  if (!REPLIES_URL) return;
  let cursor = 0;
  while (true) {
    try {
      const res = await fetch(`${REPLIES_URL}?after=${cursor}`, {
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
        ...T(),
      });
      if (res.ok) {
        const replies = await res.json();
        for (const reply of replies) {
          cursor = Math.max(cursor, reply.seq);
          const text = String(reply.text ?? "");
          const pending = state.pendingRequests.shift();
          if (pending) {
            if (pending.kind === "question") {
              await replyQuestion(pending.id, text);
            } else {
              // ponytail: permission response mapping — "approve"->once, else reject
              const response = text.toLowerCase().trim() === "approve" ? "once" : "reject";
              await replyPermission(sid, pending.id, response);
            }
          } else {
            // No pending question/permission — treat as free-form steering and
            // inject the message as a new prompt. ponytail: assumes prompt_async
            // accepts follow-up prompts mid-session (T1 verification pending — audit M1).
            await sendPrompt(sid, text);
          }
        }
      }
    } catch (e) {
      console.error(`bridge: replies poll error: ${e.message}`);
    }
    await sleep(1000);
  }
}

// ---- main ----

async function main() {
  log("waiting for opencode health");
  await waitForHealth();
  log("healthy; creating session");
  const sid = await createSession();
  log(`opencode session ${sid}; sending prompt`);
  await sendPrompt(sid);
  log("prompt accepted; streaming events");
  await emit("state_change", { state: "running" });

  const state = { pendingRequests: [] };

  const pollPromise = pollReplies(sid, state);
  try {
    await consumeSSE(sid, state);
  } catch (e) {
    log(`sse error: ${e.message}`);
    await emit("error", { message: e.message });
    await pollPromise.catch(() => {});
    process.exit(1);
  }
  log("session idle; done");
  await pollPromise.catch(() => {});
  process.exit(0);
}

main().catch(async (e) => {
  console.error(`bridge: fatal: ${e.message}`);
  try { await emit("error", { message: e.message }); } catch {}
  process.exit(1);
});
