import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { setAuthToken } from "./api.ts";
import { supabase } from "./supabase.ts";
import { ToastProvider } from "@atelier/ui";
import { CommandPalette, useCommandPaletteHotkey } from "./components/CommandPalette.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { OfflineIndicator } from "./components/OfflineIndicator.tsx";
import "./styles.css";
import "./components/command-palette.css";
import "./components/states.css";

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

// Fade out the boot loading state (defined in index.html) right before
// React mounts. The 0.3s CSS animation runs concurrently with React's
// first paint, so the user sees a smooth crossfade from the boot screen
// to the app instead of a hard flash.
document.documentElement.classList.add("boot-done");

// App wrapper: ToastProvider gives all child components access to
// useToast() for success/error notifications. CommandPalette is a
// global overlay rendered as a sibling to App — it uses a hotkey
// hook (Cmd+K / Ctrl+K) to toggle visibility.
function Root() {
  const [paletteOpen, togglePalette] = useCommandPaletteHotkey();
  return (
    <ToastProvider>
      <ErrorBoundary>
        <OfflineIndicator />
        <App />
        <CommandPalette open={paletteOpen} onClose={togglePalette} />
      </ErrorBoundary>
    </ToastProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);

// ponytail: SW registered in prod only (it breaks Vite HMR in dev). Verify the
// install + offline shell with `npm run build && npm run preview` (handoff T7.6).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
