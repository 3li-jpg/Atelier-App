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
      "/auth": "http://localhost:3000",
      "/health": "http://localhost:3000",
      "/sessions": "http://localhost:3000",
      "/providers": "http://localhost:3000",
      "/repos": "http://localhost:3000",
      "/internal": "http://localhost:3000",
      "/webhooks": "http://localhost:3000",
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // React core — needed for initial render, keep in its own chunk
          // so it's cached independently of app code.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          // framer-motion — only needed once a view mounts; split it out
          // so the initial paint doesn't download the animation library.
          if (
            id.includes("/node_modules/framer-motion/") ||
            id.includes("/node_modules/motion-dom/") ||
            id.includes("/node_modules/motion-utils/") ||
            id.includes("/node_modules/tslib/")
          ) {
            return "motion-vendor";
          }

          // Supabase client + data libraries — lazy-loaded with views.
          if (
            id.includes("/node_modules/@supabase/") ||
            id.includes("/node_modules/web-streams-polyfill/") ||
            id.includes("/node_modules/cross-fetch/")
          ) {
            return "supabase-vendor";
          }
        },
      },
    },
  },
});
