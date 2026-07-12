#!/usr/bin/env node
// hermes-bridge.mjs — relays between the Hermes API server and the Atelier control plane.
// Adapted from the original opencode bridge for Hermes /v1/runs endpoints.
//
// Zero-dependency (Node builtins only; fetch is global in Node 18+).
// Usage: node hermes-bridge.mjs  (reads env: SESSION_ID, EVENTS_URL, SESSION_TOKEN,
//   REPLIES_URL, TASK, HERMES_PORT, HERMES_KEY)

import { setTimeout as sleep } from "node:timers/promises";
import { mapEvent } from "./map-event.mjs";

const {
  SESSION_ID = "",
  EVENTS_URL = "",
  SESSION_TOKEN = "",
  REPLIES_URL = "",
  TASK = "",
  HERMES_PORT = "8642",
  HERMES_KEY = "",
} = process.env;

for (const [k, v] of [["TASK", TASK], ["HERMES_KEY", HERMES_KEY]]) {
  if (!v) { console.error(`hermes-bridge: ${k} is required`); process.exit(1); }
}

const BASE = `http://127.0.0.1:${HERMES_PORT}`;
const AUTH_HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${HERMES_KEY}`,
};

// Step trace to stderr -> machine logs; the only visibility inside the VM.
const log = (...a) => console.error("hermes-bridge:", ...a);
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

// ---- Hermes API server helpers ----

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`, { ...T(5_000) });
      if (res.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("Hermes server did not become healthy within 30s");
}

async function startRun(text = TASK) {
  const body = { input: text };
  if (SESSION_ID) body.session_id = SESSION_ID;
  const res = await fetch(`${BASE}/v1/runs`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify(body),
    ...T(30_000),
  });
  if (!res.ok) throw new Error(`POST /v1/runs failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.run_id;
}

async function resolveApproval(runId, choice) {
  // Map Atelier "approve"→"once", else "deny".
  const mapped = choice === "approve" ? "once" : "deny";
  const res = await fetch(`${BASE}/v1/runs/${runId}/approval`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify({ choice: mapped }),
    ...T(),
  });
  if (!res.ok) log(`approval ${runId} failed: ${res.status}`);
}

async function stopRun(runId) {
  try {
    await fetch(`${BASE}/v1/runs/${runId}/stop`, {
      method: "POST",
      headers: AUTH_HEADERS,
      ...T(),
    });
  } catch (e) {
    log(`stop ${runId} failed: ${e.message}`);
  }
}

// ---- SSE consumer (manual parse, no EventSource dependency) ----
//
// Hermes /v1/runs/{run_id}/events emits SSE with `data: {json}\n\n` only —
// no `event:` field. The event type is inside the JSON as `data.event`.

async function consumeSSE(runId, state, onRunEnd) {
  const res = await fetch(`${BASE}/v1/runs/${runId}/events`, {
    headers: { Authorization: `Bearer ${HERMES_KEY}` },
  });
  if (!res.ok) throw new Error(`GET /v1/runs/${runId}/events failed: ${res.status}`);
  if (!res.body) throw new Error("GET /v1/runs/events returned no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      // Stream ended — the run completed or was cancelled.
      if (onRunEnd) onRunEnd();
      return;
    }
    // Normalize \r\n -> \n (\r is a single byte, safe to strip per-chunk)
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      // Only data: lines; Hermes does not use event: field.
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
        postEvents([{ type: "harness", payload: { raw: dataStr }, ts: now() }]);
        continue;
      }

      const atelier = mapEvent(data, state);
      if (atelier) {
        postEvents([{ ...atelier, ts: now() }]);
      }
    }
  }
}

// ---- replies poller ----
//
// Polls the Atelier control plane for user replies. When a pending request
// exists and is `permission` kind, resolve the approval via the Hermes API.
// For `question` kind (clarify), there is no API endpoint — skip (the run
// will continue on its own). When no pending request, treat the reply as
// free-form steering: start a new run with the text and switch SSE consumption.

async function pollReplies(state, currentRunRef) {
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
              await resolveApproval(currentRunRef.runId, text.toLowerCase().trim() === "approve" ? "approve" : "deny");
            } else {
              // question kind (clarify) — no API endpoint; skip, run continues.
              log("clarify reply received, no API to resolve — skipping");
            }
          } else {
            // No pending request — free-form steering: start a new run.
            await sendFollowUp(text, state, currentRunRef);
          }
        }
      }
    } catch (e) {
      console.error(`hermes-bridge: replies poll error: ${e.message}`);
    }
    await sleep(1000);
  }
}

// ---- follow-up / steering ----
//
// When the user sends free-form text with no pending approval/question,
// start a new run on the same session and switch SSE consumption to it.

async function sendFollowUp(text, state, currentRunRef) {
  try {
    const newRunId = await startRun(text);
    log(`follow-up run started: ${newRunId}`);
    currentRunRef.runId = newRunId;
    state.followUpRequested = true;
  } catch (e) {
    log(`follow-up failed: ${e.message}`);
  }
}

// ---- main ----

async function main() {
  log("waiting for Hermes health");
  await waitForHealth();
  log("healthy; starting run");
  const runId = await startRun();
  log(`run ${runId}; streaming events`);
  await emit("state_change", { state: "running" });

  const state = { pendingRequests: [] };
  const currentRunRef = { runId };

  const pollPromise = pollReplies(state, currentRunRef);
  try {
    // Loop to handle follow-up runs: when a steering message creates a new
    // run, we switch SSE consumption to the new run_id and keep going.
    while (true) {
      state.followUpRequested = false;
      await consumeSSE(currentRunRef.runId, state);
      // If a follow-up was requested during consumption, loop and consume the new run.
      if (state.followUpRequested) {
        log(`switching to follow-up run: ${currentRunRef.runId}`);
        continue;
      }
      break;
    }
  } catch (e) {
    log(`sse error: ${e.message}`);
    await emit("error", { message: e.message });
    await pollPromise.catch(() => {});
    process.exit(1);
  }
  log("run completed; done");
  await pollPromise.catch(() => {});
  process.exit(0);
}

main().catch(async (e) => {
  console.error(`hermes-bridge: fatal: ${e.message}`);
  try { await emit("error", { message: e.message }); } catch {}
  process.exit(1);
});
