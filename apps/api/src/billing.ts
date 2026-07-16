// Stripe-backed billing operations. Lazy singleton so the module can be imported
// in tests or dev without real keys; the client is only constructed when env is set.
// Sandbox enforcement and VPS lifecycle are intentionally left as stubs — they are
// wired by the specialized agents in tasks 2-5.

import type { AnyStore } from "./store.ts";
import { getTier, getVpsSize } from "./plans.ts";

let stripeClient: any = null;
let stripeModule: any = null;

export async function stripe(): Promise<any> {
  if (stripeClient) return stripeClient;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  // ponytail: dynamic import keeps startup fast when billing env isn't set.
  if (!stripeModule) stripeModule = (await import("stripe")).default;
  stripeClient = new stripeModule(secret, { apiVersion: "2024-06-20" });
  return stripeClient;
}

export function resetStripe(): void {
  stripeClient = null;
}

// Exposed for tests to inject a mock client.
export function setStripeClient(client: any): void {
  stripeClient = client;
}

export interface CheckoutInput {
  product: "sandbox" | "vps";
  tier?: string;
  size?: string;
  userId: string;
  email?: string;
}

export interface CheckoutResult {
  url: string;
  sessionId: string;
}

export interface PortalInput {
  customerId: string;
}

export interface PortalResult {
  url: string;
}

export interface WebhookInput {
  body: string | Buffer;
  signature: string;
}

export interface WebhookResult {
  ok: boolean;
  event: string;
}

export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutResult> {
  const client = await stripe();
  if (!client) throw new Error("Stripe is not configured");
  const lineItems = buildLineItems(input);
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer_email: input.email,
    line_items: lineItems,
    subscription_data: {
      trial_period_days: 3,
      payment_method_collection: "always",
      metadata: {
        user_id: input.userId,
        product: input.product,
        tier: input.tier ?? input.size ?? "",
      },
    },
    success_url: `${publicUrl()}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${publicUrl()}/billing/cancel`,
  });
  return { url: session.url, sessionId: session.id };
}

export async function createBillingPortalSession(input: PortalInput): Promise<PortalResult> {
  const client = await stripe();
  if (!client) throw new Error("Stripe is not configured");
  const session = await client.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: `${publicUrl()}/account`,
  });
  return { url: session.url };
}

export async function handleWebhook(input: WebhookInput): Promise<WebhookResult> {
  const client = await stripe();
  if (!client) throw new Error("Stripe is not configured");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  const event = client.webhooks.constructEvent(input.body, input.signature, secret);
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutSessionCompleted(event.data.object);
      break;
    case "customer.subscription.updated":
      await onSubscriptionUpdated(event.data.object);
      break;
    case "invoice.paid":
      await onInvoicePaid(event.data.object);
      break;
    case "invoice.payment_failed":
      await onInvoicePaymentFailed(event.data.object);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object);
      break;
  }
  return { ok: true, event: event.type };
}

// Abuse-guard stubs: the shared foundation provides schema + counters; strict
// enforcement (one trial per email + card fingerprint, concurrent cap) comes later.
export async function canStartTrial(_input: { email?: string; fingerprint?: string }): Promise<boolean> {
  return true;
}

export async function countActiveTrials(_store?: AnyStore): Promise<number> {
  return 0;
}

function buildLineItems(input: CheckoutInput): any[] {
  if (input.product === "vps") {
    const size = getVpsSize(input.size ?? "medium");
    if (!size) throw new Error("invalid vps size");
    return [{ price: priceIdForVps(size.id), quantity: 1 }];
  }
  const tier = getTier(input.tier ?? "plus");
  if (!tier) throw new Error("invalid sandbox tier");
  const items: any[] = [{ price: priceIdForTier(tier.id), quantity: 1 }];
  if (tier.overage_mode === "meter") {
    items.push({ price: priceIdForOverage(), quantity: 1 });
  }
  return items;
}

// Price IDs come from env; never hardcode live keys. Defaults are test-mode placeholders.
function priceIdForTier(tierId: string): string {
  return process.env[`STRIPE_PRICE_${tierId.toUpperCase()}`] ?? `price_test_${tierId}`;
}

function priceIdForVps(sizeId: string): string {
  return process.env[`STRIPE_PRICE_VPS_${sizeId.toUpperCase()}`] ?? `price_test_vps_${sizeId}`;
}

function priceIdForOverage(): string {
  return process.env.STRIPE_PRICE_OVERAGE ?? "price_test_overage";
}

function publicUrl(): string {
  return (process.env.PUBLIC_WEB_URL ?? process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// ---- Webhook handler stubs (tasks 2-5 will wire lifecycle) ----

async function onCheckoutSessionCompleted(_session: any): Promise<void> {
  // stub: other agents set status trialing + provision VPS
}

async function onSubscriptionUpdated(_subscription: any): Promise<void> {
  // stub: trialing -> active transition
}

async function onInvoicePaid(_invoice: any): Promise<void> {
  // stub: roll period + reset sandbox usage
}

async function onInvoicePaymentFailed(_invoice: any): Promise<void> {
  // stub: past_due -> dunning
}

async function onSubscriptionDeleted(_subscription: any): Promise<void> {
  // stub: canceled -> teardown
}
