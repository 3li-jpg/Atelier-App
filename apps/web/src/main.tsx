import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);

// ponytail: SW registered in prod only (it breaks Vite HMR in dev). Verify the
// install + offline shell with `npm run build && npm run preview` (handoff T7.6).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
