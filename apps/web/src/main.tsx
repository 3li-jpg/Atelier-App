import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { setAuthToken } from "./api.ts";
import { supabase } from "./supabase.ts";
import "./styles.css";

// Pick up Supabase access token from URL hash (passed by the landing page
// after signup). Store it so the API client sends it as
// Authorization: Bearer <token> for cross-origin auth.
const hashToken = new URLSearchParams(window.location.hash.slice(1)).get("token");
if (hashToken) {
  setAuthToken(hashToken);
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

// Also check if Supabase has an active session in localStorage and sync the
// token to our API client.
supabase.auth.getSession().then(({ data }) => {
  if (data.session?.access_token) {
    setAuthToken(data.session.access_token);
  }
});

// Keep the API client token in sync when the Supabase session changes
// (login, logout, token refresh).
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.access_token) {
    setAuthToken(session.access_token);
  }
});

createRoot(document.getElementById("root")!).render(<App />);

// ponytail: SW registered in prod only (it breaks Vite HMR in dev). Verify the
// install + offline shell with `npm run build && npm run preview` (handoff T7.6).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
