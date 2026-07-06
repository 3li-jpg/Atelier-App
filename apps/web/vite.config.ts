import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ponytail: dev proxy keeps the SPA same-origin with the API (no CORS), with
// zero backend change. SPA routes use non-colliding prefixes (/s/:id, /p, /n)
// so browser navigations never shadow API paths. In prod the Hono app serves
// the built bundle from the same origin (handoff T6).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/health": "http://localhost:3000",
      "/sessions": "http://localhost:3000",
      "/providers": "http://localhost:3000",
      "/internal": "http://localhost:3000",
      "/webhooks": "http://localhost:3000",
    },
  },
});
