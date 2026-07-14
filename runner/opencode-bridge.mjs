#!/usr/bin/env node
// opencode-bridge.mjs — relays between the OpenCode serve API and the Atelier
// control plane. Produces Atelier Event objects posted to
// POST /internal/sessions/:id/events.
//
// Zero-dependency (Node builtins only; fetch is global in Node 18+).
// Usage: node opencode-bridge.mjs  (reads env: SESSION_ID, EVENTS_URL, SESSION_TOKEN,
//   REPLIES_URL, TASK, OPENCODE_URL, OPENCODE_USER, OPENCODE_PASSWORD,
//   OPENCODE_MODEL, OPENCODE_AGENT)

import { setTimeout as sleep } from "node:timers/promises";
import { mapOpenCodeEvent } from "./opencode-map.mjs";

const {
  SESSION_ID = "",
  EVENTS_URL = "",
  SESSION_TOKEN = "",
  REPLIES_URL = "",
  TASK = "",
  OPENCODE_URL = "http://127.0.0.1:4096",
  OPENCODE_USER = "opencode",
  OPENCODE_PASSWORD = "",
  OPENCODE_MODEL = "",
  OPENCODE_AGENT = "",
  OPENCODE_PROVIDER_ID = "",
} = process.env;

if (!OPENCODE_PASSWORD) { console.error("opencode-bridge: OPENCODE_PASSWORD is required"); process.exit(1); }

const BASIC_AUTH = "Basic " + Buffer.from(`${OPENCODE_USER}:${OPENCODE_PASSWORD}`).toString("base64");
const OC_HEADERS = {
  "Content-Type": "application/json",
  Authorization: BASIC_AUTH,
};

// Step trace to stderr -> machine logs; the only visibility inside the VM.
const log = (...a) => console.error("opencode-bridge:", ...a);
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

// ---- OpenCode serve API helpers ----

async function waitForHealth() {
  // 120s: opencode serve cold start on a shared-cpu Fly VM can take a while.
  // Locally it's healthy in ~2s.
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${OPENCODE_URL}/global/health`, { headers: { Authorization: BASIC_AUTH }, ...T(5_000) });
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("OpenCode server did not become healthy within 120s");
}

async function createSession() {
  const res = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: OC_HEADERS,
    body: JSON.stringify({ title: `atelier-${SESSION_ID}` }),
    ...T(30_000),
  });
  if (!res.ok) throw new Error(`POST /session failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

// opencode /message expects model as { providerID, modelID } | null — a bare
// string ("umans-glm-5.2") is rejected with 400 (Payload: "Expected object |
// null"). OPENCODE_MODEL may be "providerID/modelID" (opencode's canonical
// form, e.g. "umans-ai/umans-glm-5.2") or a bare model id; split on the first
// "/" to recover the pair. A bare id with no provider falls back to OPENCODE_PROVIDER_ID.
function modelObject(raw) {
  if (!raw) return null;
  const slash = raw.indexOf("/");
  if (slash > 0) return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) };
  const providerID = OPENCODE_PROVIDER_ID || "atelier";
  return { providerID, modelID: raw };
}

async function sendMessage(sessionId, text) {
  const body = { parts: [{ type: "text", text }] };
  const model = modelObject(OPENCODE_MODEL);
  if (model) body.model = model;
  if (OPENCODE_AGENT) body.agent = OPENCODE_AGENT;
  // POST /message blocks until the agent turn completes (deltas stream on
  // GET /event during this window). A reasoning model's first turn can run
  // 60-120s+, so 30s aborts every non-trivial turn and kills the session.
  // 5min: bounded but roomy for multi-step reasoning + tool calls.
  const res = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
    method: "POST",
    headers: OC_HEADERS,
    body: JSON.stringify(body),
    ...T(300_000),
  });
  if (!res.ok) throw new Error(`POST /session/${sessionId}/message failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data;
}

async function abortSession(sessionId) {
  try {
    await fetch(`${OPENCODE_URL}/session/${sessionId}/abort`, {
      method: "POST",
      headers: OC_HEADERS,
      ...T(),
    });
  } catch (e) {
    log(`abort ${sessionId} failed: ${e.message}`);
  }
}

// Resolve a pending permission.asked request (review/plan modes). opencode
// exposes POST /session/:id/permissions/:permissionID with {response} — NOT a
// chat message. "approve"→allow, anything else→deny.
async function resolvePermission(sessionId, permissionId, allow) {
  try {
    await fetch(`${OPENCODE_URL}/session/${sessionId}/permissions/${encodeURIComponent(permissionId)}`, {
      method: "POST",
      headers: OC_HEADERS,
      body: JSON.stringify({ response: allow ? "allow" : "deny" }),
      ...T(),
    });
  } catch (e) {
    log(`resolve permission ${permissionId} failed: ${e.message}`);
  }
}

// ---- SSE consumer (manual parse, no EventSource dependency) ----
//
// OpenCode GET /event emits SSE with `data: {json}\n\n`. The event type is
// inside the JSON as `type`, and the payload is in `properties`. We filter
// for events matching our session id.

async function consumeSSE(sessionId, state, onStreamEnd) {
  const res = await fetch(`${OPENCODE_URL}/event`, {
    headers: { Authorization: BASIC_AUTH, Accept: "text/event-stream" },
  });
  if (!res.ok) throw new Error(`GET /event failed: ${res.status}`);
  if (!res.body) throw new Error("GET /event returned no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let batch = [];
  let lastFlush = Date.now();

  function flush() {
    if (batch.length === 0) return;
    const current = batch;
    batch = [];
    lastFlush = Date.now();
    return postEvents(current);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // Stream ended — the session completed or was cancelled.
      await flush();
      if (onStreamEnd) onStreamEnd();
      return;
    }
    // Normalize \r\n -> \n (\r is a single byte, safe to strip per-chunk)
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      // Only data: lines; OpenCode does not use event: field.
      const dataLines = [];
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        // Ignore comment lines (keepalive: ": keepalive\n\n")
      }
      const dataStr = dataLines.join("\n");
      if (!dataStr) continue;

      let data;
      try {
        data = JSON.parse(dataStr);
      } catch {
        batch.push({ type: "harness", payload: { raw: dataStr }, ts: now() });
        continue;
      }

      // Filter for our session id only. OpenCode events may carry
      // sessionID directly or nested in properties.sessionID.
      const evSessionId = data.sessionID || data.sessionId ||
        (data.properties && (data.properties.sessionID || data.properties.sessionId));
      if (evSessionId && evSessionId !== sessionId) continue;

      const atelier = mapOpenCodeEvent(data, state);
      if (atelier) {
        batch.push({ ...atelier, ts: now() });
      }
    }
    // Flush eagerly: the SSE stream stays open for the session lifetime, so
    // we can't wait for stream-end or a 5-event batch (a short reply yields <5
    // events and would sit buffered forever). Flush on any new data, plus a
    // 500ms safety net so we don't flush on every single token delta.
    if (batch.length > 0 && (batch.length >= 5 || Date.now() - lastFlush >= 500)) {
      await flush();
    }
  }
}

// ---- replies poller ----
//
// Polls the Atelier control plane for user replies. When a pending request
// exists and is `permission` kind, resolve it (opencode permissions auto-resolve
// when the user sends "approve"/"deny" — for now we send the reply as a new
// message if the question is pending, or treat free-form text as steering).
// For `question` kind (clarify), treat the reply as a new message to the session.
// When no pending request, treat the reply as free-form steering → POST /session/:id/message.

async function pollReplies(state, sessionId) {
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
            if (pending.kind === "permission") {
              // Permission: resolve via the dedicated endpoint (NOT a chat
              // message — opencode ignores those for permissions). "approve"
              // → allow, anything else → deny.
              await resolvePermission(sessionId, pending.id, text.toLowerCase().trim() === "approve");
            } else {
              // Question kind (clarify) — send the reply as a message.
              await sendMessage(sessionId, text);
            }
          } else {
            // No pending request — free-form steering: send as new message.
            await sendMessage(sessionId, text);
          }
        }
      }
    } catch (e) {
      console.error(`opencode-bridge: replies poll error: ${e.message}`);
    }
    await sleep(1000);
  }
}

// ---- main ----

async function main() {
  log("waiting for OpenCode health");
  await waitForHealth();
  await emit("state_change", { state: "running" });

  log("creating OpenCode session");
  const sessionId = await createSession();
  log(`session ${sessionId} created`);

  const state = { pendingRequests: [] };

  // Start the replies poller concurrently.
  const pollPromise = pollReplies(state, sessionId);

  // Subscribe to the SSE event stream BEFORE sending the message. opencode's
  // POST /session/:id/message blocks until the agent turn completes, and it
  // streams the turn's deltas on /event DURING that blocking window — so
  // subscribing after sendMessage returns misses the entire turn. Kick off the
  // consumer first, then send; the consumer runs until the stream ends.
  let sseError = null;
  const ssePromise = consumeSSE(sessionId, state, () => {
    log("event stream ended");
  }).catch((e) => { sseError = e; });

  // Give the SSE socket a moment to open so the first deltas aren't missed.
  await sleep(300);

  if (TASK) {
    log("sending initial task");
    await sendMessage(sessionId, TASK);
  } else {
    log("chat mode: no initial task; waiting for first reply");
  }

  try {
    await ssePromise;
    if (sseError) throw sseError;
  } catch (e) {
    log(`sse error: ${e.message}`);
    await emit("error", { message: e.message });
    await pollPromise.catch(() => {});
    process.exit(1);
  }
  log("session completed; done");
  await pollPromise.catch(() => {});
  process.exit(0);
}

// Graceful shutdown on SIGTERM/SIGINT — abort the opencode session then exit.
const shutdown = async () => {
  log("shutdown signal received");
  try {
    // We don't have the session id here directly, but the process will
    // be killed by the supervisor anyway. Best-effort abort.
  } catch {}
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch(async (e) => {
  console.error(`opencode-bridge: fatal: ${e.message}`);
  try { await emit("error", { message: e.message }); } catch {}
  process.exit(1);
});
