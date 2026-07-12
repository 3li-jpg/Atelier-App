import { useEffect, useState } from "react";
import { Button } from "@atelier/ui";

// T7.6 install affordance. Chrome/Android fire `beforeinstallprompt` (we capture
// + show an Install button). iOS Safari never fires it, so we detect iOS and
// surface the manual Share→Add to Home Screen hint. iOS web push only works
// once installed, so this prompt gates the core notify loop (handoff T7.6).
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIOS(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(
    typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches,
  );
  const [showIOSHint, setShowIOSHint] = useState(false);

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  if (deferred) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          await deferred.prompt();
          const choice = await deferred.userChoice;
          if (choice.outcome === "accepted") setInstalled(true);
          setDeferred(null);
        }}
      >
        Install
      </Button>
    );
  }

  if (isIOS()) {
    return showIOSHint ? (
      <span className="muted small">Share → Add to Home Screen</span>
    ) : (
      <Button variant="ghost" size="sm" onClick={() => setShowIOSHint(true)}>Install</Button>
    );
  }

  return null;
}
