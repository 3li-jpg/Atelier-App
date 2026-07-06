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

for (const [k, v] of [["TASK", TASK], ["OC_PASSWORD", OC_PASSWORD]]) {
  if (!v) { console.error(`bridge: ${k} is required`); process.exit(1); }
}

const BASE = `http://127.0.0.1:${OC_PORT}`;
const AUTH = "Basic " + Buffer.from(`opencode:${OC_PASSWORD}`).toString("base64");
const OC_HEADERS = { Authorization: AUTH, "Content-Type": "application/json" };

// ---- control-plane helpers ----

function now() { return new Date().toISOString(); }

function postEvents(events) {
  if (!EVENTS_URL || events.length === 0) return Promise.resolve();
  return fetch(EVENTS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SESSION_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(events),
  }).then(() => {}, (e) => console.error(`bridge: event post failed: ${e.message}`));
}

function emit(type, payload) {
  return postEvents([{ type, payload, ts: now() }]);
}

// ---- opencode server helpers ----

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/global/health`, { headers: { Authorization: AUTH } });
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
  });
  if (!res.ok) throw new Error(`POST /session failed: ${res.status} ${await res.text()}`);
  // ponytail: assuming POST /session returns {id:string}
  const body = await res.json();
  return body.id;
}

async function sendPrompt(sid) {
  const res = await fetch(`${BASE}/session/${sid}/prompt_async`, {
    method: "POST",
    headers: OC_HEADERS,
    // ponytail: assuming prompt_async body shape is {parts:[{type:"text",text:TASK}]}
    body: JSON.stringify({ parts: [{ type: "text", text: TASK }] }),
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
  });
  if (!res.ok) console.error(`bridge: question reply ${requestId} failed: ${res.status}`);
}

async function replyPermission(sid, permissionId, response) {
  const res = await fetch(`${BASE}/session/${sid}/permissions/${permissionId}`, {
    method: "POST",
    headers: OC_HEADERS,
    // ponytail: assuming /session/{sid}/permissions/{id} body is {response:"once"|"always"|"reject"}
    body: JSON.stringify({ response }),
  });
  if (!res.ok) console.error(`bridge: permission reply ${permissionId} failed: ${res.status}`);
}

// ---- event mapping ----

function extractText(payload) {
  // ponytail: message.updated/message.part.updated shape is ASSUMED.
  // Guessed from AI SDK conventions: {parts:[{type:"text",text}]}, {content:[...]}, or {text}.
  if (typeof payload.text === "string") return payload.text;
  const parts = payload.parts ?? payload.content ?? [];
  if (Array.isArray(parts)) {
    const texts = parts
      .filter((p) => p && (p.type === "text" || typeof p.text === "string"))
      .map((p) => p.text ?? "")
      .filter(Boolean);
    if (texts.length) return texts.join("");
  }
  return JSON.stringify(payload);
}

function mapEvent(eventName, data, sid, state) {
  const type = data.type ?? eventName ?? "";

  // permission request -> question (kind: permission)
  if (type === "permission.updated" || type === "permission") {
    // ponytail: assuming permission.updated payload is
    //   {id, type, sessionID, messageID, title, metadata, time}
    const id = data.id ?? data.permissionID ?? data.permissionId ?? "";
    const prompt = data.title ?? data.metadata?.title ?? "Approve tool?";
    const options = ["approve", "reject"];
    if (id) state.pendingRequests.push({ id, kind: "permission" });
    return { atelier: { type: "question", payload: { prompt, options, request_id: id, kind: "permission" } } };
  }

  // question tool -> question (kind: question)
  if (type === "question" || type === "question.updated") {
    // ponytail: assuming question event payload is
    //   {id/requestID, question, options:[...], sessionID, messageID}
    const id = data.id ?? data.requestID ?? data.requestId ?? "";
    const prompt = data.question ?? data.title ?? data.prompt ?? "";
    const options = Array.isArray(data.options) ? data.options : [];
    if (id) state.pendingRequests.push({ id, kind: "question" });
    return { atelier: { type: "question", payload: { prompt, options, request_id: id, kind: "question" } } };
  }

  // assistant text
  if (type === "message.updated" || type === "message.part.updated" || type === "message") {
    const text = extractText(data);
    return { atelier: { type: "assistant_text", payload: { text } } };
  }

  // file edited
  if (type === "file.edited" || type === "file") {
    // ponytail: assuming file.edited payload has a `path` field
    const path = data.path ?? data.metadata?.path ?? data.file ?? "";
    return { atelier: { type: "file_diff", payload: { path } } };
  }

  // session idle -> completed
  if (type === "session.idle" ||
      (type === "session.status" && (data.status === "idle" || data.state === "idle"))) {
    return { atelier: { type: "state_change", payload: { state: "completed" } }, stop: true };
  }

  // session error
  if (type === "session.error") {
    // ponytail: assuming session.error payload has `message` or `error`
    const message = data.message ?? data.error ?? JSON.stringify(data);
    return { atelier: { type: "error", payload: { message } } };
  }

  // other -> harness
  return { atelier: { type: "harness", payload: { event: type, data } } };
}

// ---- SSE consumer (manual parse, no EventSource dependency) ----

async function consumeSSE(sid, state) {
  const res = await fetch(`${BASE}/event`, { headers: { Authorization: AUTH } });
  if (!res.ok) throw new Error(`GET /event failed: ${res.status}`);
  if (!res.body) throw new Error("GET /event returned no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (!state.stopped) throw new Error("SSE stream ended without session.idle");
      return;
    }
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

      const { atelier, stop } = mapEvent(eventName, data, sid, state);
      if (atelier) {
        postEvents([{ ...atelier, ts: now() }]);
      }
      if (stop) {
        state.stopped = true;
        return;
      }
    }
  }
}

// ---- replies poller ----

async function pollReplies(sid, state) {
  if (!REPLIES_URL) return;
  let cursor = 0;
  while (!state.stopped) {
    try {
      const res = await fetch(`${REPLIES_URL}?after=${cursor}`, {
        headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
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
            // No pending request — message consumed but not relayed.
            // ponytail: if opencode supports injecting free-form user input mid-session,
            // we could POST it as a new prompt_async. Needs T1 spike confirmation.
            console.error(`bridge: user_message with no pending request (seq=${reply.seq})`);
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
  await waitForHealth();
  const sid = await createSession();
  await sendPrompt(sid);
  await emit("state_change", { state: "running" });

  const state = { stopped: false, pendingRequests: [] };

  const pollPromise = pollReplies(sid, state);
  try {
    await consumeSSE(sid, state);
  } catch (e) {
    await emit("error", { message: e.message });
    state.stopped = true;
    await pollPromise.catch(() => {});
    process.exit(1);
  }
  state.stopped = true;
  await pollPromise.catch(() => {});
  process.exit(0);
}

main().catch(async (e) => {
  console.error(`bridge: fatal: ${e.message}`);
  try { await emit("error", { message: e.message }); } catch {}
  process.exit(1);
});
