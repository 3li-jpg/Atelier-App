// Append-only audit trail + email notification stub.
// ponytail: audit() swallows errors — a logging failure must never break the
// calling path (e.g. a deletion cascade). If audit reliability matters, move
// to a queue; for now in-process insert is enough.
import type { AnyStore } from "./pg-store.ts";

export interface AuditEntry { actor: string; action: string; target: string; meta?: object }

export async function audit(store: AnyStore, e: AuditEntry): Promise<void> {
  try { await store.appendAudit(e); } catch { /* never break the caller */ }
}

// ponytail: no mail dep until a provider is chosen. console.warn in dev/test;
// swap for nodemailer/resend when SMTP_URL is set. [LEGAL REVIEW: email delivery]
export async function notify(to: string, subject: string, body: string): Promise<void> {
  if (!process.env.SMTP_URL) { console.warn(`[notify stub] to=${to} subject=${subject}`); return; }
  // TODO: real transport when SMTP provider is chosen — left as a stub so the
  // abuse-report path works end-to-end without a mail dependency today.
  console.warn(`[notify] would email ${to}: ${subject}`);
}
