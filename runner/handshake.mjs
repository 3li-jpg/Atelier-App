// Supervisor half of the sealed-box handshake (mirrors apps/api/src/secrets.ts).
// Usage: node handshake.mjs  (reads HANDSHAKE_URL + SESSION_TOKEN from env)
// Prints the decrypted session config JSON to stdout. Secrets touch memory only.
import {
  generateKeyPairSync, diffieHellman, createPublicKey, createDecipheriv, hkdfSync,
} from "node:crypto";

const SPKI = Buffer.from("302a300506032b656e032100", "hex");
const { HANDSHAKE_URL, SESSION_TOKEN } = process.env;
if (!HANDSHAKE_URL || !SESSION_TOKEN) throw new Error("HANDSHAKE_URL and SESSION_TOKEN required");

const { publicKey, privateKey } = generateKeyPairSync("x25519");
const pubRaw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);

const res = await fetch(HANDSHAKE_URL, {
  method: "POST",
  headers: { Authorization: `Bearer ${SESSION_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ pubkey: pubRaw.toString("base64") }),
});
if (!res.ok) throw new Error(`handshake failed: ${res.status} ${await res.text()}`);
const sealed = await res.json();

const secret = diffieHellman({
  privateKey,
  publicKey: createPublicKey({
    key: Buffer.concat([SPKI, Buffer.from(sealed.orch_pub, "base64")]),
    format: "der", type: "spki",
  }),
});
const key = hkdfSync("sha256", secret, "", "atelier-handshake", 32);
const d = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(sealed.iv, "base64"));
d.setAuthTag(Buffer.from(sealed.tag, "base64"));
process.stdout.write(Buffer.concat([d.update(Buffer.from(sealed.ct, "base64")), d.final()]).toString("utf8"));
