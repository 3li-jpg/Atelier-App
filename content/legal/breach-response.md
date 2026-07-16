# Breach Response Plan

Effective: 2026-07-16 · Version 1.0

> This is a draft, not legal advice. It must be reviewed by qualified counsel before publishing. Items marked `[LEGAL REVIEW: ...]` require a human decision. This is an internal runbook.

---

## 1. Purpose

This plan defines how Atelier detects, assesses, and responds to a personal-data breach. It is an internal runbook. `[LEGAL REVIEW: assign a named Breach Response Lead and an alternate; document the on-call rotation and escalation path.]`

## 2. Detection

A breach may be detected through security logging, the audit log, subprocessor notifications, user reports, or anomalous system behavior. Anyone who suspects a breach must notify the Breach Response Lead immediately. The audit log (append-only) and session-event redaction on ingest are the primary internal signals.

## 3. Assessment and containment

On detection, the Breach Response Lead will:

1. **Confirm** whether a breach has occurred (distinguish a confirmed incident from a false alarm).
2. **Contain** it — for example, rotate the `MASTER_KEY`, revoke and rotate exposed provider keys/tokens, suspend affected sessions or accounts, revoke credentials, and isolate affected systems.
3. **Assess scope** — what data categories were affected (account data, encrypted keys, session events, billing metadata), how many users, and the risk of harm.
4. **Record** the assessment, including the timeline, affected systems, and containment actions.

`[LEGAL REVIEW: define the containment playbook per data class — in particular the procedure for rotating the master key and re-encrypting stored keys, and whether a master-key compromise is recoverable given the single-key design (see secrets.ts).]`

## 4. Notification duties and timelines

Notification obligations depend on the jurisdictions of affected users and the severity of the breach:

- **GDPR (EEA/UK):** Where a breach is likely to result in a risk to the rights and freedoms of natural persons, notify the competent supervisory authority without undue delay and, where feasible, **within 72 hours** of becoming aware. Where the breach is likely to result in a high risk, also notify affected data subjects without undue delay.
- **PIPEDA (Canada):** Where a breach creates a **real risk of significant harm** to an individual, notify the individual and the Privacy Commissioner of Canada as soon as feasible after determining the breach has occurred, and keep records of the breach for 24 months.
- **CCPA/CPRA (California):** Provide notice to affected California residents in the most expedient time possible and without unreasonable delay where their personal information is subject to a breach.

`[LEGAL REVIEW: confirm the exact notification triggers, recipients, and timelines for each applicable jurisdiction; map which supervisory authority(ies) must be notified and maintain their contact details. Confirm whether the 72-hour GDPR clock starts at awareness or confirmation.]`

## 5. Who is notified

- **Affected users** — when required by law or when there is a real risk of harm.
- **Supervisory authorities** — the relevant data-protection authority(ies) per Section 4.
- **Subprocessors** — where the breach originated with or affects a subprocessor, coordinate with them.
- **Law enforcement** — where legally required or appropriate.

## 6. How affected users are contacted

Affected users are notified by email (to the address on file) and, where appropriate, by an in-product notice. The notice will describe, to the extent known: the nature of the breach, the categories of data involved, the likely consequences, the measures taken and proposed, and how users can protect themselves. `[LEGAL REVIEW: prepare notification templates in advance; confirm the contact channel and whether a dedicated breach-notice address or landing page is required.]`

## 7. Post-incident review

After containment and notification, the Breach Response Lead will conduct a post-incident review to determine root cause, document lessons learned, and implement corrective measures to prevent recurrence. The review and its outcomes are recorded.

## 8. Contact

Breach-related matters: **ali@studioatelier.ca**. `[LEGAL REVIEW: confirm the breach-reporting contact and whether a dedicated security address should be used instead.]`

**Effective:** 2026-07-16 · **Version:** 1.0
