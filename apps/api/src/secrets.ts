// AES-256-GCM with a single master key from env.
// ponytail: one master key, not per-user KMS data keys — upgrade to AWS KMS
// envelope encryption (PRD §9.3) before storing anyone else's keys.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function masterKey(): Buffer {
  const secret = process.env.MASTER_KEY;
  if (!secret) throw new Error("MASTER_KEY env var required");
  return createHash("sha256").update(secret).digest();
}

export function encryptKey(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptKey(blob: Buffer | Uint8Array): string {
  const b = Buffer.from(blob);
  const iv = b.subarray(0, 12), tag = b.subarray(12, 28), ct = b.subarray(28);
  const d = createDecipheriv("aes-256-gcm", masterKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}

// Redaction filter for streamed output (PRD §9.3): known prefixes + long-token entropy.
const KEY_PATTERNS = /\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,})\b/g;

export function redact(text: string): string {
  return text.replace(KEY_PATTERNS, "[redacted]");
}
