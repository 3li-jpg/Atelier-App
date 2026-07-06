// GitHub OAuth + stateless signed session cookies (handoff T3).
// ponytail: HMAC-signed cookie (no server session store) -> no revocation; add
// a sessions table if revocation is needed. SESSION_SECRET falls back to
// MASTER_KEY so the alpha works with one secret; set a dedicated SESSION_SECRET
// before multi-user. Auth also accepts a static bearer AUTH_TOKEN (owner/admin
// backdoor) so CLI use + owner-alpha keep working without OAuth.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "atelier_session";
export const OWNER_ID = "owner";
export const SESSION_COOKIE = COOKIE;

export function sessionSecret(): string {
  return process.env.SESSION_SECRET || process.env.MASTER_KEY || "";
}

export function authConfigured(): boolean {
  return Boolean(process.env.AUTH_TOKEN || (process.env.GITHUB_OAUTH_CLIENT_ID && sessionSecret()));
}

export function oauthEnabled(): boolean {
  return Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET && sessionSecret());
}

const b64u = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function signSession(userId: string, secret = sessionSecret()): string {
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days
  const payload = b64u(JSON.stringify({ uid: userId, exp }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(token: string | undefined | null, secret = sessionSecret()): string | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!payload || !mac) return null;
  const expected = sign(payload, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp === "number" && exp < Date.now()) return null;
    return String(uid);
  } catch {
    return null;
  }
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export function isSecure(): boolean {
  return (process.env.PUBLIC_WEB_URL ?? process.env.PUBLIC_URL ?? "").startsWith("https");
}

export function oauthRedirectUri(): string {
  const base = (process.env.PUBLIC_WEB_URL ?? process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
  return `${base}/auth/github/callback`;
}

export function loginUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
    redirect_uri: oauthRedirectUri(),
    scope: "repo read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

// Exchange the OAuth code for an access token, then fetch the user profile.
// fetchImpl is injectable so tests can fake the GitHub round-trips.
export async function exchangeGithubCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; user: GithubUser }> {
  const tokenRes = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? "",
      code,
    }),
  });
  if (!tokenRes.ok) throw new Error(`github token exchange: ${tokenRes.status}`);
  const tok = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tok.access_token) throw new Error(`github token exchange: ${tok.error ?? "no access_token"}`);
  const userRes = await fetchImpl("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json", "User-Agent": "atelier" },
  });
  if (!userRes.ok) throw new Error(`github user fetch: ${userRes.status}`);
  return { token: tok.access_token, user: (await userRes.json()) as GithubUser };
}

export function signWorkspaceToken(sessionId: string, userId: string, secret = sessionSecret()): string {
  const payload = b64u(JSON.stringify({ sid: sessionId, uid: userId, exp: Date.now() + 5 * 60_000 }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyWorkspaceToken(token: string | undefined | null, secret = sessionSecret()): { sid: string; uid: string } | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { sid, uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp < Date.now()) return null;
    return { sid: String(sid), uid: String(uid) };
  } catch { return null; }
}
