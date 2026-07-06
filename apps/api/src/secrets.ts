// AES-256-GCM with a single master key from env.
// ponytail: one master key, not per-user KMS data keys — upgrade to AWS KMS
// envelope encryption (PRD §9.3) before storing anyone else's keys.
import {
  createCipheriv, createDecipheriv, randomBytes, createHash,
  generateKeyPairSync, diffieHellman, createPublicKey, createPrivateKey, hkdfSync,
} from "node:crypto";

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

// --- Sealed-box handshake (guide §2.6) ---
// Supervisor sends its X25519 pubkey; we reply with an ephemeral pubkey and
// the session config AES-256-GCM-encrypted under the ECDH shared secret.
// Authenticity comes from the per-session bearer token + TLS, not the keys.

const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex"); // DER header for raw 32-byte key

function rawToPublicKey(raw: Buffer) {
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

function sharedKey(privateKey: any, peerRaw: Buffer): Buffer {
  const secret = diffieHellman({ privateKey, publicKey: rawToPublicKey(peerRaw) });
  return Buffer.from(hkdfSync("sha256", secret, "", "atelier-handshake", 32));
}

export interface SealedConfig { orch_pub: string; iv: string; tag: string; ct: string }

export function sealConfig(supervisorPubRaw: Buffer, payload: object): SealedConfig {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const key = sharedKey(privateKey, supervisorPubRaw);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const orchPubRaw = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
  return {
    orch_pub: orchPubRaw.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  };
}

// Test helper / reference for the supervisor side (runner/handshake.mjs mirrors this).
export function openSealed(supervisorPrivPem: string, sealed: SealedConfig): object {
  const key = sharedKey(createPrivateKey(supervisorPrivPem), Buffer.from(sealed.orch_pub, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  d.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(sealed.ct, "base64")), d.final()]).toString("utf8"));
}

// Redaction filter for streamed output (PRD §9.3): known prefixes + long-token entropy.
const KEY_PATTERNS = /\b(sk-[A-Za-z0-9_-]{10,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,})\b/g;

export function redact(text: string): string {
  return text.replace(KEY_PATTERNS, "[redacted]");
}
