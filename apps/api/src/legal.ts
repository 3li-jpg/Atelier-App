// Single source of truth for legal doc metadata + the subprocessor list.
// Doc bodies live as .md in content/legal/; bumping a version string here is
// the entire re-consent trigger.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AnyStore } from "./pg-store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
// apps/api/src -> apps/api -> apps -> repo root (content/legal lives at root)
const DOCS_DIR = join(HERE, "..", "..", "..", "content", "legal");

export const LEGAL_DOCS = {
  terms:            { version: "1.0", effective: "2026-07-16", title: "Terms of Use", file: "terms.md" },
  privacy:          { version: "1.0", effective: "2026-07-16", title: "Privacy Policy", file: "privacy.md" },
  "ip-policy":      { version: "1.0", effective: "2026-07-16", title: "IP & Takedown Policy", file: "ip-policy.md" },
  "vps-root-terms": { version: "1.0", effective: "2026-07-16", title: "Cloud VPS Root-Access Terms", file: "vps-root-terms.md" },
} as const;

export type DocId = keyof typeof LEGAL_DOCS;

// ponytail: one static list — confirm against .env before finalizing. Add a
// provider here AND in subprocessors.md (the compliance test asserts they match).
export const SUBPROCESSORS = [
  { name: "Stripe",   purpose: "Payments",            region: "US" },
  { name: "Supabase", purpose: "Auth + database",      region: "US/EU" },
  { name: "GitHub",   purpose: "OAuth + repo access",   region: "US" },
  { name: "Daytona",  purpose: "Sandbox compute",       region: "US" },
  { name: "E2B",      purpose: "Sandbox compute",       region: "US" },
  { name: "Fly.io",   purpose: "Sandbox compute",       region: "Global" },
  { name: "Hetzner",  purpose: "VPS compute",           region: "EU/US" },
  { name: "Vercel",   purpose: "Landing hosting",       region: "Global" },
];

export function currentVersion(docId: string): string {
  const meta = (LEGAL_DOCS as Record<string, { version: string }>)[docId];
  if (!meta) throw new Error(`unknown legal doc: ${docId}`);
  return meta.version;
}

export function getDocBody(docId: string): string {
  const meta = (LEGAL_DOCS as Record<string, { file: string }>)[docId];
  if (!meta) throw new Error(`unknown legal doc: ${docId}`);
  return readFileSync(join(DOCS_DIR, meta.file), "utf8");
}

// Diff the required docs' current versions against what the user accepted.
// Returns the missing set — non-empty means the UI must show a re-consent modal.
export async function requireAcceptances(
  store: AnyStore, userId: string, docIds: string[],
): Promise<{ docId: string; version: string }[]> {
  const accepted = await store.currentAcceptances(userId);
  const missing: { docId: string; version: string }[] = [];
  for (const docId of docIds) {
    const want = currentVersion(docId);
    if (accepted[docId] !== want) missing.push({ docId, version: want });
  }
  return missing;
}
