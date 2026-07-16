# Subprocessors

Effective: 2026-07-16 · Version 1.0

> This is a draft, not legal advice. It must be reviewed by qualified counsel before publishing. Items marked `[LEGAL REVIEW: ...]` require a human decision.

---

Atelier engages the following subprocessors to process personal data in order to operate the service. This list is generated from the `SUBPROCESSORS` configuration in `apps/api/src/legal.ts`; a compliance test asserts that this document mentions every configured provider, so the two stay in sync.

`[LEGAL REVIEW: confirm each provider's actual processing region and purpose against their current terms before publishing; update the legal.ts list and this document together if any provider changes.]`

| Subprocessor | Purpose | Region |
|---|---|---|
| Stripe | Payments (card collection and subscription billing) | US |
| Supabase | Authentication and database | US/EU |
| GitHub | OAuth and repository access | US |
| Daytona | Sandbox compute | US |
| E2B | Sandbox compute | US |
| Fly.io | Sandbox compute | Global |
| Hetzner | VPS compute | EU/US |
| Vercel | Landing hosting | Global |

## Notes

- **Stripe** collects and holds card data directly; Atelier never receives or stores raw card numbers — only a Stripe customer ID and subscription ID.
- **Supabase** may be used for authentication and as the primary database when a `DATABASE_URL` is configured; otherwise the service runs on a local SQLite store.
- **GitHub** is used for sign-in (OAuth) and to list repositories, read branches, and push commits/PRs on the user's behalf.
- **Daytona**, **E2B**, and **Fly.io** provision the isolated sandboxes in which agent sessions run. Repository code is cloned into a sandbox transiently and destroyed when the session ends.
- **Hetzner** provisions persistent Cloud VPS machines.
- **Vercel** hosts the public landing site.

## Changes

We will update this list when subprocessors change. Where required, we will provide notice and an opportunity to object before a new subprocessor processes personal data. `[LEGAL REVIEW: set the notice period and objection mechanism; see the DPA, Section 5.]`

**Effective:** 2026-07-16 · **Version:** 1.0
