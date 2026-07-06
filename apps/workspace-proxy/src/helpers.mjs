// ponytail: HMAC helpers duplicated from apps/api/src/auth.ts — this app is
// deliberately zero-dep and can't import TS from the api workspace.
import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (payload, secret) => createHmac("sha256", secret).update(payload).digest("base64url");

function verifySigned(token, secret) {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(payload, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
}

export function verifyAttachToken(token, secret) {
  const p = verifySigned(token, secret);
  if (!p || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return { sid: String(p.sid), uid: String(p.uid) };
}

export function signCookie(sid, secret) {
  const payload = Buffer.from(JSON.stringify({ sid, exp: Date.now() + 7 * 86400_000 })).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyCookie(cookie, secret) {
  const p = verifySigned(cookie, secret);
  if (!p || typeof p.exp !== "number" || p.exp < Date.now()) return null;
  return String(p.sid);
}

export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function pingDue(lastPing, sid, now = Date.now()) {
  const prev = lastPing.get(sid) ?? 0;
  if (now - prev < 60_000) return false;
  lastPing.set(sid, now);
  return true;
}
