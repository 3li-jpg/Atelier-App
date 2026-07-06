// Typed fetch client for the Atelier control plane. Same-origin: in dev the
// Vite proxy forwards /sessions,/providers,... to :3000; in prod the Hono app
// serves this bundle and the API from one origin (handoff T6).
// ponytail: no retry/backoff yet — add before the streaming UI is load-bearing
// across flaky mobile links (handoff T7.6).
import type { Event } from "@atelier/schema";

const TOKEN_KEY = "atelier:auth_token";
let authToken = (() => {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
})();

export function getAuthToken(): string { return authToken; }
export function setAuthToken(t: string): void {
  authToken = t;
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode */ }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type SessionSummary = {
  id: string; repo_url: string; branch: string; model_id: string;
  task: string; state: string; started_at: string; ended_at: string | null;
};
export type SessionDetail = SessionSummary & {
  provider_id: string; permission_mode: string; machine_id: string | null;
  budgets: string; // sqlite JSON string; parse where needed
  billed_seconds?: number;
};
export type ProviderSummary = {
  id: string; name: string; base_url: string; dialect: string;
  models: { id: string; role: string }[]; created_at: string;
};

export type ProviderCreate = {
  name: string;
  base_url: string;
  dialect: "openai-chat" | "openai-responses" | "anthropic-messages";
  models: { id: string; role: "coder" | "utility"; context?: number; tool_calls?: boolean }[];
  api_key: string;
  headers?: Record<string, string>;
  quirks?: Record<string, unknown>;
};

export type ValidationResult = {
  ok: boolean;
  latency_ms: number;
  completion: boolean;
  tool_calls: boolean;
  error?: string;
};

export type CreateSessionReq = {
  repo_url: string;
  branch?: string;
  provider_id: string;
  model_id: string;
  task: string;
  permission_mode?: "auto" | "review" | "plan";
  budgets?: { max_wall_clock_s?: number; max_turns?: number };
};

export type RepoSummary = {
  id: number; full_name: string; default_branch: string; private: boolean;
};

export type BranchSummary = { name: string };

export type { Event };

export const api = {
  listSessions: () => req<SessionSummary[]>("/sessions"),
  createSession: (input: CreateSessionReq) =>
    req<{ id: string; state: string }>("/sessions", { method: "POST", body: JSON.stringify(input) }),
  getSession: (id: string) => req<SessionDetail>(`/sessions/${encodeURIComponent(id)}`),
  cancelSession: (id: string) =>
    req<{ ok: boolean }>(`/sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  reply: (id: string, text: string) =>
    req<{ ok: boolean }>(`/sessions/${encodeURIComponent(id)}/reply`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  listProviders: () => req<ProviderSummary[]>("/providers"),
  createProvider: (cfg: ProviderCreate) =>
    req<{ id: string }>("/providers", { method: "POST", body: JSON.stringify(cfg) }),
  validateProvider: (cfg: ProviderCreate) =>
    req<ValidationResult>("/providers/validate", { method: "POST", body: JSON.stringify(cfg) }),
  getAuthStatus: () =>
    req<{ oauth: boolean; authed: boolean; owner: boolean; user: { login: string } | null }>("/auth/status"),
  logout: () => req<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  listRepos: () => req<RepoSummary[]>("/repos"),
  listBranches: (owner: string, repo: string) =>
    req<BranchSummary[]>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`),
};
