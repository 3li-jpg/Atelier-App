import { useEffect, useState } from "react";
import { api, setAuthToken } from "./api.ts";
import { Button, Input, useToast } from "@atelier/ui";

type AuthStatus = {
  oauth: boolean;
  authed: boolean;
  owner: boolean;
  user: { login: string } | null;
} | null;

// T7/T3 auth affordance. Three modes:
//  - authed: show login + logout
//  - OAuth configured + not authed: Login button -> /auth/github/login
//  - no OAuth + not authed (AUTH_TOKEN owner-alpha): static-token input
export function AuthBar() {
  const toast = useToast();
  const [status, setStatus] = useState<AuthStatus>(null);
  const [tok, setTok] = useState("");

  const load = () => api.getAuthStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);

  if (!status) return null;

  if (status.authed) {
    return (
      <div className="authbar">
        <span className="muted small">{status.user?.login ?? "owner"}</span>
        <Button variant="ghost" size="sm" onClick={async () => {
          await api.logout();
          toast.push("Logged out", "info");
          load();
        }}>logout</Button>
      </div>
    );
  }

  if (status.oauth) {
    return <Button variant="ghost" size="sm" onClick={() => { window.location.href = "/auth/github/login"; }}>Login</Button>;
  }

  return (
    <form
      className="authbar"
      onSubmit={(e) => {
        e.preventDefault();
        const t = tok.trim();
        if (!t) return;
        setAuthToken(t);
        window.location.reload();
      }}
    >
      <Input
        value={tok}
        onChange={(e) => setTok(e.target.value)}
        placeholder="AUTH_TOKEN"
        type="password"
        className="authbar-input"
      />
      <Button type="submit" variant="ghost" size="sm">set</Button>
    </form>
  );
}
