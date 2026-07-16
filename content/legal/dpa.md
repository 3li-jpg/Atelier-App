# Data Processing Addendum

Effective: 2026-07-16 · Version 1.0

> This is a draft, not legal advice. It must be reviewed by qualified counsel before publishing. Items marked `[LEGAL REVIEW: ...]` require a human decision.

---

## 1. Background and parties

This Data Processing Addendum ("DPA") is entered into between **Studio Atelier** ("Atelier", "we", "us") and the business or team customer ("Customer", "you") that uses Atelier in connection with data belonging to the Customer or its authorized users. It supplements the Terms of Use and applies where Atelier processes personal data on behalf of the Customer. `[LEGAL REVIEW: confirm whether this DPA is incorporated by reference into the Terms of Use or requires a separate signed agreement; determine the execution mechanism for business customers.]`

## 2. Roles of the parties

- **Account and billing data.** Atelier acts as a **controller** of the personal data it collects to administer the account (for example, email, authentication data, billing metadata) and to operate the service.
- **Repository content handled on instruction.** Where Atelier processes personal data contained in repository content, session events, prompts, or agent outputs at the Customer's direction, Atelier acts as a **processor** on the Customer's instructions, and the Customer is the controller of that data.

`[LEGAL REVIEW: confirm the controller/processor split with counsel — in particular whether session-event and prompt data is better characterized as controller data (service operation) or processor data (on customer instruction), since the user both controls the repo and consumes the service.]`

## 3. Subject matter, duration, nature, and purpose

- **Subject matter:** the provision of the Atelier agentic coding platform, including running AI agent sessions against the Customer's repositories in isolated sandboxes.
- **Duration:** for the term of the Customer's use of the service, plus the retention periods in [data-retention.md](./data-retention.md).
- **Nature and purpose:** executing agent sessions, streaming session events, metering usage, and billing.
- **Data types:** account/identity data, encrypted model and compute keys, GitHub tokens, repository code (transient in sandboxes), session events/logs, prompts/tasks, and billing metadata.

## 4. Subprocessors

Atelier engages the subprocessors listed in [subprocessors.md](./subprocessors.md) to process personal data. The current list comprises Stripe, Supabase, GitHub, Daytona, E2B, Fly.io, Hetzner, and Vercel. Atelier remains responsible for the acts and omissions of its subprocessors as if they were Atelier's own.

## 5. Sub-processing consent

The Customer provides general authorization for Atelier to engage subprocessors as listed. Atelier will give notice of intended changes to the subprocessor list, and the Customer may object on reasonable grounds. `[LEGAL REVIEW: set the notice period for subprocessor changes (commonly 30 days) and the objection mechanism; confirm whether notice is via the public subprocessors page or direct communication.]`

## 6. Security measures

Atelier implements the security measures described in the Privacy Policy, including AES-256-GCM encryption of model keys, compute keys, and GitHub tokens at rest; sealed-box (X25519 + AES-256-GCM) delivery of keys to the agent runtime so they are not present in the sandbox environment; redaction of known secret patterns from session events on ingest; and httpOnly, SameSite session cookies. Atelier does not claim any security certification (such as SOC 2, ISO 27001, HIPAA, or PCI DSS). `[LEGAL REVIEW: do not state or imply certification; update if/when an audit is completed. Confirm the measure list is adequate for the data classes processed.]`

## 7. Customer obligations

The Customer is responsible for the lawfulness of its instructions, for obtaining any necessary consents from its authorized users, and for the personal data it directs Atelier to process (including data in repositories the Customer selects).

## 8. Audit

Atelier will make available information necessary to demonstrate compliance with this DPA and will contribute to audits, including inspections, conducted by the Customer subject to reasonable notice and confidentiality obligations. `[LEGAL REVIEW: define the audit trigger, frequency, cost allocation, and whether audits are self-serve (e.g. a SOC 2 report when available) vs. on-site; until a certification exists, clarify what evidence can realistically be provided.]`

## 9. Deletion and return on termination

On termination, Atelier will delete or return the Customer's personal data, subject to the retention periods in [data-retention.md](./data-retention.md) for records that must be kept for legal, tax, or billing reasons. Account deletion runs the full cascade described in the Privacy Policy.

## 10. International transfers

Personal data may be transferred to the regions listed in [subprocessors.md](./subprocessors.md). For transfers out of the EEA/UK/Switzerland, an appropriate transfer mechanism will be in place. `[LEGAL REVIEW: execute and reference the SCCs/IDTA and a transfer impact assessment; do not claim a mechanism is in place until it is.]`

**Effective:** 2026-07-16 · **Version:** 1.0
