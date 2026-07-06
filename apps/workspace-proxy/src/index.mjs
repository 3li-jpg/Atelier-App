// Workspace proxy: cookie-routes a browser to its session's sandbox machine over
// Fly 6PN. openchamber must live at a URL root, hence a dedicated app/hostname.
import http from "node:http";
import { verifyAttachToken, signCookie, verifyCookie, parseCookies, pingDue } from "./helpers.mjs";

const {
  PORT = "8080", SESSION_SECRET = "", PROXY_TOKEN = "",
  CONTROL_PLANE_URL = "", SANDBOX_APP = "atelier-sandboxes",
} = process.env;
for (const [k, v] of [["SESSION_SECRET", SESSION_SECRET], ["PROXY_TOKEN", PROXY_TOKEN], ["CONTROL_PLANE_URL", CONTROL_PLANE_URL]]) {
  if (!v) { console.error(`workspace-proxy: ${k} required`); process.exit(1); }
}

const COOKIE = "atelier_ws";
const cache = new Map();
const lastPing = new Map();

async function lookup(sid) {
  const hit = cache.get(sid);
  if (hit && Date.now() - hit.ts < 30_000) return hit;
  const res = await fetch(`${CONTROL_PLANE_URL}/internal/workspace/${sid}`, {
    headers: { Authorization: `Bearer ${PROXY_TOKEN}` }, signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const entry = { ...body, ts: Date.now() };
  cache.set(sid, entry);
  return entry;
}

function cpPost(path) {
  fetch(`${CONTROL_PLANE_URL}${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${PROXY_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

const WAKING = `<!doctype html><meta http-equiv="refresh" content="3"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0"><p>waking your workspace…</p></body>`;
const waking = (res) => { res.writeHead(503, { "Content-Type": "text/html", "Cache-Control": "no-store" }); res.end(WAKING); };

function target(entry) { return { host: `${entry.machine_id}.vm.${SANDBOX_APP}.internal`, port: 3000 }; }

function sessionOf(req, res) {
  const sid = verifyCookie(parseCookies(req.headers.cookie)[COOKIE], SESSION_SECRET);
  if (!sid) { res.writeHead(403, { "Content-Type": "text/plain" }); res.end("not attached — open the workspace from the Atelier hub"); return null; }
  return sid;
}

// Strip our own attach cookie before forwarding to the sandbox (audit L2):
// openchamber is unauthenticated and must not see the proxy's session secret.
function fwdHeaders(rawHeaders, hostHeader) {
  const out = { ...rawHeaders };
  if (out.cookie) {
    const kept = parseCookies(out.cookie);
    delete kept[COOKIE];
    const c = Object.keys(kept).map((k) => `${k}=${kept[k]}`).join("; ");
    if (c) out.cookie = c; else delete out.cookie;
  }
  out.host = hostHeader;
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }

  if (url.pathname === "/attach") {
    const t = verifyAttachToken(url.searchParams.get("token"), SESSION_SECRET);
    if (!t) { res.writeHead(403, { "Content-Type": "text/plain" }); return res.end("bad or expired attach link — reopen from the Atelier hub"); }
    res.writeHead(302, {
      "Set-Cookie": `${COOKIE}=${signCookie(t.sid, SESSION_SECRET)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 86400}`,
      Location: "/",
    });
    return res.end();
  }

  const sid = sessionOf(req, res);
  if (!sid) return;
  const entry = await lookup(sid).catch(() => null);
  if (!entry?.machine_id) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("session has no machine (finished?)"); }
  if (entry.state === "hibernated") { cpPost(`/internal/workspace/${sid}/wake`); cache.delete(sid); return waking(res); }
  if (pingDue(lastPing, sid)) cpPost(`/internal/workspace/${sid}/activity`);

  const { host, port } = target(entry);
  const preq = http.request(
    { host, port, path: req.url, method: req.method, headers: fwdHeaders(req.headers, `${host}:${port}`) },
    (pres) => { res.writeHead(pres.statusCode ?? 502, pres.headers); pres.pipe(res); },
  );
  preq.on("error", () => {
    if (res.headersSent) return res.destroy();
    if ((req.headers.accept ?? "").includes("text/html")) { cache.delete(sid); return waking(res); }
    res.writeHead(502, { "Content-Type": "text/plain" }); res.end("upstream unavailable");
  });
  req.pipe(preq);
});

server.on("upgrade", async (req, socket) => {
  const bail = () => socket.destroy();
  const sid = verifyCookie(parseCookies(req.headers.cookie)[COOKIE], SESSION_SECRET);
  if (!sid) return bail();
  const entry = await lookup(sid).catch(() => null);
  if (!entry?.machine_id || entry.state === "hibernated") return bail();
  const { host, port } = target(entry);
  const preq = http.request({ host, port, path: req.url, method: req.method, headers: fwdHeaders(req.headers, `${host}:${port}`) });
  preq.on("upgrade", (pres, psocket, phead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (let i = 0; i < pres.rawHeaders.length; i += 2) lines.push(`${pres.rawHeaders[i]}: ${pres.rawHeaders[i + 1]}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (phead?.length) psocket.unshift(phead);
    psocket.pipe(socket); socket.pipe(psocket);
    psocket.on("error", bail); socket.on("error", () => psocket.destroy());
  });
  preq.on("error", bail);
  preq.end();
});

server.listen(Number(PORT), "0.0.0.0", () => console.log(`workspace-proxy on :${PORT}`));
