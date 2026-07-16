# Atelier Billing

This document covers the Stripe-backed billing system for Atelier: metered sandbox subscriptions and flat Cloud-VPS subscriptions, both sharing one Stripe integration and one 3-day trial policy.

## Products

### Sandbox subscriptions (metered)

| Tier | Monthly | Included hours | CPUs | Memory | Overage mode | Overage rate |
|------|---------|----------------|------|--------|--------------|--------------|
| Free | $0 | 0 | 0 | 0 MB | hard_cap | — |
| Plus | $6 | 20 | 1 | 2048 MB | meter | $0.20/hr |
| Pro | $10 | 40 | 2 | 2048 MB | meter | $0.20/hr |
| Max | $25 | 140 | 2 | 4096 MB | meter | $0.25/hr |

- Usage is measured in billable seconds accrued while a session is in a live state (`provisioning`, `cloning`, `setup`, `running`, `awaiting_user`, `finalizing`).
- Free tier cannot launch sessions (returns `402 OUT_OF_QUOTA`).
- Metered tiers block new sessions when `remaining_hours <= 0` to prevent runaway overage; Stripe separately meters overage for any hours consumed above the included amount.
- Every metered tier's overage rate is greater than its compute cost (see `plans.ts` safety test).

### Cloud VPS subscriptions (flat)

| Size | Monthly | CPUs | Memory | Disk |
|------|---------|------|--------|------|
| Small | $10 | 2 | 4096 MB | 40 GB |
| Medium | $20 | 4 | 8192 MB | 80 GB |
| Large | $40 | 8 | 16384 MB | 160 GB |

- Flat monthly price; no metered overage.
- VPS provisioning is currently a stub: webhooks record the subscription status and set `vm_ref`/`region` to `null` on cancellation. Real VM lifecycle is out of scope for the alpha.

## Stripe setup (test mode)

1. Create a Stripe account or use an existing one.
2. Go to **Developers → API keys** and copy the **Secret key** (starts with `sk_test_…`).
3. Go to **Developers → Webhooks → Add endpoint**:
   - Endpoint URL: `https://your-api-host/billing/webhook`
   - Select events:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.deleted`
   - Copy the **Signing secret** (starts with `whsec_…`).
4. Create products and prices in Stripe:
   - One product per sandbox tier (Free, Plus, Pro, Max) with a recurring monthly price.
   - One product per VPS size (Small, Medium, Large) with a recurring monthly price.
   - One separate `overage` price (metered, recurring monthly) used for all sandbox tiers that are in meter mode.
5. Copy each price ID (starts with `price_…`) into environment variables.

## Environment variables

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Sandbox tier price IDs (monthly, flat)
STRIPE_PRICE_FREE=price_...
STRIPE_PRICE_PLUS=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_MAX=price_...

# Sandbox overage (metered)
STRIPE_PRICE_OVERAGE=price_...

# VPS size price IDs (monthly, flat)
STRIPE_PRICE_VPS_SMALL=price_...
STRIPE_PRICE_VPS_MEDIUM=price_...
STRIPE_PRICE_VPS_LARGE=price_...

# App public URL (used for checkout success/cancel and billing portal return)
PUBLIC_WEB_URL=https://your-app-host
```

Price IDs are read from env; if missing, test-mode placeholders like `price_test_plus` are used. The app never hardcodes live keys.

## Trial policy

- All subscriptions start with a 3-day trial (`trial_period_days: 3`).
- `payment_method_collection: "always"` collects a payment method during checkout, even on trial.
- Webhooks set `user_plan.status` to `trialing` on `checkout.session.completed`, then flip it to `active` (or `past_due`/`canceled`) on later subscription events.
- `trial_counter` is incremented once per user when they first enter trialing.

## Webhook flow

1. User clicks **Upgrade** in Settings → frontend calls `POST /billing/checkout`.
2. Backend creates a Stripe Checkout Session and returns `{ url }`.
3. User completes checkout; Stripe redirects back to `/billing/success?session_id=…`.
4. Stripe emits `checkout.session.completed` → backend inserts/updates `user_plan`.
5. Stripe emits `customer.subscription.updated` → backend updates status and period dates.
6. Each paid invoice (`invoice.paid`) advances `current_period_start`/`current_period_end` by one month and resets the metered-period clock.
7. A failed payment (`invoice.payment_failed`) sets status `past_due`.
8. Cancellation (`customer.subscription.deleted`) sets status `canceled`.

## Test card

Use Stripe's standard test card for happy-path checkout:

```
4242 4242 4242 4242
Any future date, any CVC, any ZIP
```

For declined payments, use `4000 0000 0000 0002`.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/billing/checkout` | Start checkout. Body: `{ product: "sandbox"|"vps", tier?: string, size?: string }`. Returns `{ url }`. |
| POST | `/billing/portal` | Open billing portal. Body: `{ customerId: string }`. Returns `{ url }`. |
| POST | `/billing/webhook` | Stripe webhook endpoint. Requires `stripe-signature` header. |
| POST | `/sessions` | Create sandbox session. Returns `402` with `{ code: "OUT_OF_QUOTA"|"PLAN_REQUIRED", upgrade_url }` when blocked. |
| GET | `/account` | Returns account, plan, usage, and billing fields. |

## Testing locally

1. Copy `.env.example` to `.env` and fill in test Stripe keys.
2. Forward webhooks with the Stripe CLI:
   ```bash
   stripe listen --forward-to localhost:3000/billing/webhook
   ```
   This gives you a temporary `STRIPE_WEBHOOK_SECRET`; paste it into `.env`.
3. Run the API: `cd apps/api && npm run dev`.
4. Run the web app: `cd apps/web && npm run dev`.
5. In the web app, sign in, go to Settings → Plan, pick a tier, and complete checkout with the test card.
6. Watch the terminal for webhook events and verify `user_plan` updates in the DB.

## Abuse guards

The shared foundation exposes `canStartTrial` and `trial_counter` stubs. Strict enforcement (one trial per email/card fingerprint, concurrent cap) is left as a later hardening step.
