# Data Retention Policy

Effective: 2026-07-16 · Version 1.0

> This is a draft, not legal advice. It must be reviewed by qualified counsel before publishing. Items marked `[LEGAL REVIEW: ...]` require a human decision.

---

This policy describes how long Atelier retains each category of personal data and what happens at the end of the retention period. Retention windows are enforced by an automated sweep; the defaults below may be tuned via environment configuration.

## Retention schedule

| Data type | Retention period | Action at end |
|---|---|---|
| **Account data** (email, login, auth data) | Until the user deletes the account, plus a short grace period | Anonymized to a tombstone (login set to `deleted`, email and credentials nulled) retained for audit/billing |
| **Model provider key** (encrypted, AES-256-GCM) | Until the user removes the provider or deletes the account | Deleted |
| **Compute provider key** (BYOC, encrypted) | Until the user clears compute or deletes the account | Deleted |
| **GitHub token** (encrypted) | Until the user disconnects GitHub or deletes the account | Deleted |
| **Session events and logs** | 90 days `[LEGAL REVIEW: confirm 90 days is appropriate; shorter may reduce risk, longer may aid supportability.]` | Purged by the retention sweep |
| **Sandbox contents** (cloned repository, agent working files) | Ephemeral — destroyed when the session ends or is cleaned up | Destroyed; not recoverable |
| **VPS disk** (Cloud VPS persistent machine) | Until cancellation, plus a 30-day grace period `[LEGAL REVIEW: confirm the 30-day grace window.]` | VM destroyed by the retention sweep; data not recoverable |
| **Billing records** (Stripe customer/subscription IDs, invoices) | 6–7 years per applicable tax and finance law `[LEGAL REVIEW: confirm the exact retention period for Canadian and applicable tax/finance record-keeping requirements.]` | Retained then disposed per legal obligation |
| **Audit log** (append-only security/operational events) | Defined operational period `[LEGAL REVIEW: set the audit-log retention window and whether it is deleted or anonymized.]` | Deleted or anonymized per the defined window |
| **Abuse reports** | Retained for the life of the relevant account plus a defined period for repeat-infringer tracking `[LEGAL REVIEW: set the abuse-report retention window.]` | Deleted after the window |
| **Legal acceptances** (records of which doc version a user accepted) | Until the user deletes the account | Deleted |
| **Consent records** (analytics consent) | Until withdrawn or account deleted | Deleted |

## Deleted vs. anonymized

- **Deleted** means the record is removed from the active database. Session events are purged by the retention sweep; provider keys, tokens, sessions, and acceptances are removed during account deletion.
- **Anonymized** means identifying fields are irreversibly nulled or replaced (for example, the user row becomes a `deleted` tombstone with no email, password hash, or tokens). A tombstone is retained only where needed for audit or billing-record integrity; it no longer identifies a person.

## Account deletion

When a user deletes their account, Atelier cancels active sessions (destroying their sandboxes), destroys any Cloud VPS, cancels the Stripe subscription, deletes provider keys, the compute key, the GitHub token, all sessions and events, and legal acceptances, and anonymizes the user record. The deletion is recorded in the audit log.

## Changes

We may update this schedule. Material changes bump the version and effective date above. `[LEGAL REVIEW: confirm all windows against applicable law before publishing.]`

**Effective:** 2026-07-16 · **Version:** 1.0
