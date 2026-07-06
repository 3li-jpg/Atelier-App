// Atelier service worker — app-shell cache for offline + installability.
// ponytail: network-first for navigations (picks up new deploys), cache-first
// for static assets; API + SSE stream requests are never cached. Web Push
// (push event handler + VAPID) lands with T7.6 push-sending (needs keys).
const CACHE = "atelier-shell-v1";
const PRECACHE = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];
const API_PREFIXES = ["/sessions", "/providers", "/internal", "/health", "/webhooks"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (API_PREFIXES.some((p) => url.pathname.startsWith(p))) return; // never cache API / SSE

  // Navigations: network-first, fall back to the cached shell when offline.
  // The cached /index.html fallback also makes SPA deep-links (/s/:id) work
  // even before the API gains a catch-all for non-API GETs (handoff T6).
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Static assets: cache-first, runtime-cache the response.
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
