// Workspace proxy: the old openchamber proxy is retired. This service is retained
// as a placeholder for the future live-WS upgrade (§7). All routes return 410 except /healthz.
import http from "node:http";

const PORT = process.env.PORT ?? "8080";

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  res.writeHead(410, { "Content-Type": "text/plain" });
  res.end("workspace proxy retired — openchamber removed");
});

server.listen(Number(PORT), "0.0.0.0", () =>
  console.log(`workspace-proxy (stub) on :${PORT}`),
);
