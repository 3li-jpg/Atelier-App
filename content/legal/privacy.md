# Privacy Policy

Effective: 2026-07-16 · Version 1.0

> This is a draft, not legal advice. It must be reviewed by qualified counsel before publishing. Items marked `[LEGAL REVIEW: ...]` require a human decision.

---

## 1. Who we are and how to contact us

Atelier is operated by **Studio Atelier**, a company based in Canada. The product is an open-source (MIT-licensed), self-hostable, chat-first agentic coding platform: you connect your own model API key (bring-your-own-key, "BYOK"), pick a GitHub repository, and an AI agent runs in an isolated cloud sandbox that edits files, runs tools, and opens a pull request.

**Contact:** privacy@studioatelier.ca (general privacy questions) or ali@studioatelier.ca.

If you are a resident of the European Union, the United Kingdom, or another jurisdiction that requires a local representative for data-protection matters, we will designate one before offering the service in that region. `[LEGAL REVIEW: appoint an EU/UK Article 27 representative if EU/UK users are targeted; confirm whether one is needed at launch given current user base.]`

## 2. The data we collect and why

We collect only what is necessary to run the service. The categories are:

- **Account and identity data.** Email address and password hash (for email/password sign-up), or your GitHub login, name, and avatar (for GitHub OAuth). Used to create and authenticate your account.
- **Model provider keys (BYOK).** The API key you supply for your chosen model provider (for example an OpenAI-compatible endpoint). This key is encrypted at rest with **AES-256-GCM** under a master key derived from the `MASTER_KEY` environment variable and is only decrypted in the API process when a session needs it. **Your model key is never placed in the sandbox environment.** It is delivered to the agent runtime through a sealed-box (X25519 + AES-256-GCM) handshake, not as a plaintext environment variable.
- **GitHub access token.** If you connect GitHub, the OAuth token is stored encrypted (AES-256-GCM) and used only to list your repositories, read branches, and push commits/PRs on your behalf.
- **Compute provider key (BYOC).** On the free plan you may bring your own compute (BYOC) by supplying a sandbox-provider key (E2B or Daytona). This is stored encrypted (AES-256-GCM) and used to provision sandboxes on your behalf.
- **Repository code.** When you start a session, your selected repository is cloned into an isolated sandbox so the agent can work on it. The sandbox is ephemeral; its contents are destroyed when the session ends or is cleaned up. We do not retain a copy of your repository after the session.
- **Session events and logs.** As the agent runs, structured events (tool calls, file edits, messages, state changes) are streamed and stored so you can review what happened. These are retained on a schedule — see [data-retention.md](./data-retention.md). Known secret patterns are redacted on ingest before storage.
- **Prompts and tasks.** The task description and messages you send to the agent are stored as session events so the conversation can be replayed.
- **Usage metering.** For metered sandbox plans, billed seconds are accumulated per session to compute usage against your included hours. For VPS plans, the subscription period is tracked.
- **Billing metadata.** We store a Stripe customer ID and subscription ID. **We never receive or store your raw card number.** Card data is collected and held directly by Stripe; see [subprocessors.md](./subprocessors.md).

`[LEGAL REVIEW: confirm this list is exhaustive against the actual schema (users, providers, sessions, events, user_plan, audit_log, legal_acceptances, consent, abuse_reports) and that no additional field collects personal data.]`

## 3. Legal bases for processing (GDPR)

Where the GDPR applies, we process personal data on the following bases:

- **Performance of a contract** (Art. 6(1)(b)) — creating your account, running sessions, and delivering the service you signed up for.
- **Legal obligation** (Art. 6(1)(c)) — retaining billing/tax records and cooperating with lawful takedown requests.
- **Legitimate interests** (Art. 6(1)(f)) — security logging, abuse prevention, and product stability.
- **Consent** (Art. 6(1)(a)) — any optional analytics, where enabled; consent is recorded and withdrawable.

`[LEGAL REVIEW: confirm the lawful basis mapping with counsel, particularly whether BYOK key handling and session-event retention should rest on contract or legitimate interests, and document the legitimate-interests balancing test.]`

## 4. How we use your data (and what we do not do)

We use your data to operate the service: authenticate you, run agent sessions, bill for paid plans, secure the platform, and respond to your support requests.

**We do NOT train models on your code, prompts, or agent outputs.** Your repository content and conversation are used solely to execute the session you requested. `[LEGAL REVIEW: confirm this is and remains true; if any telemetry or model-improvement data sharing is ever introduced, this section and the legal basis must be updated and re-consented.]`

## 5. Sharing and subprocessors

We share personal data only with the subprocessors needed to run the service, and only for the purposes described in [subprocessors.md](./subprocessors.md). We do not sell your data. The current subprocessors are Stripe (payments), Supabase (auth and database), GitHub (OAuth and repo access), Daytona and E2B (sandbox compute), Fly.io (sandbox compute), Hetzner (VPS compute), and Vercel (landing hosting).

## 6. International data transfers

Your data may be processed in Canada, the United States, the EU, and other regions where our subprocessors operate (see the regions in [subprocessors.md](./subprocessors.md)). For transfers out of the EEA/UK/ Switzerland, we rely on an appropriate transfer mechanism. `[LEGAL REVIEW: select and execute the transfer mechanism — EU Standard Contractual Clauses, UK IDTA/Addendum, and a transfer impact assessment; do not claim adequacy or SCCs are in place until they actually are.]`

## 7. Data retention

We keep personal data only as long as necessary. The retention schedule by data type is in [data-retention.md](./data-retention.md). When you delete your account, we cancel active sessions, destroy your VPS (if any), cancel your Stripe subscription, delete your provider keys, compute key, GitHub token, sessions, events, and acceptances, and anonymize your user record to a tombstone retained only for audit/billing purposes.

## 8. Security

We encrypt model keys, compute keys, and GitHub tokens at rest with AES-256-GCM. Keys are delivered to the agent runtime through a sealed-box handshake (X25519 ephemeral ECDH + AES-256-GCM), not via plaintext environment variables, so they are not present in the sandbox environment. Known secret patterns are redacted from session events on ingest. Session cookies are httpOnly and SameSite=Lax. We do not claim any security certification (such as SOC 2, ISO 27001, HIPAA, or PCI DSS) and have not undergone such audits. `[LEGAL REVIEW: do not state or imply certification status; update this section if/when a formal audit is completed.]`

## 9. Your rights

Depending on your jurisdiction, you may have rights to access, correct, delete, port, or object to processing of your personal data, and to withdraw consent. You can exercise several of these directly in the product: **Export your data** via the account export endpoint, and **Delete your account** via the account deletion flow (which runs the cascade described in Section 7). You can also contact privacy@studioatelier.ca.

We aim to respond to verified requests within 30 days. `[LEGAL REVIEW: confirm response timelines — GDPR allows one month (extendable by two), PIPEDA requires 30 days, CCPA allows 45 days; set the committed window to the strictest applicable.]`

## 10. Cookies and tracking

We use essential cookies to keep you signed in (the `atelier_session` httpOnly cookie). We do not run analytics or advertising trackers unless you have consented. A cookie consent banner is shown only when an analytics provider is configured; your choice is recorded. `[LEGAL REVIEW: if analytics is enabled, update this section and ensure the consent mechanism meets ePrivacy/GDPR consent standards.]`

## 11. Children

The service is not directed to children. You must be at least 16 years of age (or the age of digital consent in your jurisdiction) to use it. `[LEGAL REVIEW: confirm the minimum age — 16 is the GDPR digital-consent floor but varies by member state; align with the Terms of Use eligibility clause.]` We do not knowingly collect data from anyone under that age; if you believe we have, contact privacy@studioatelier.ca and we will delete it.

## 12. Changes and effective date

We may update this Policy. When we make material changes, we bump the version and effective date above and, where required, prompt you to re-accept. Continued use after the effective date constitutes acceptance of the updated Policy.

**Effective:** 2026-07-16 · **Version:** 1.0
