// Stripe-backed billing operations. Lazy singleton so the module can be imported
// in tests or dev without real keys; the client is only constructed when env is set.
// Sandbox enforcement and VPS lifecycle are intentionally left as stubs — they are
// wired by the specialized agents in tasks 2-5.

import type { AnyStore } from "./pg-store.ts";
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
        ...(input.product === "vps" ? { size: input.size ?? "" } : { tier: input.tier ?? "" }),
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

export async function handleWebhook(input: WebhookInput, store?: AnyStore): Promise<WebhookResult> {
  const client = await stripe();
  if (!client) throw new Error("Stripe is not configured");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
  const event = client.webhooks.constructEvent(input.body, input.signature, secret);
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutSessionCompleted(event.data.object, store);
      break;
    case "customer.subscription.updated":
      await onSubscriptionUpdated(event.data.object, store);
      break;
    case "invoice.paid":
      await onInvoicePaid(event.data.object, store);
      break;
    case "invoice.payment_failed":
      await onInvoicePaymentFailed(event.data.object, store);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object, store);
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

// ---- Webhook handlers (Task 4: VPS billing lifecycle) ----

function toUtcText(ts: number | null | undefined): string | null {
  if (ts == null) return null;
  return new Date(ts * 1000).toISOString().slice(0, 19).replace("T", " ");
}

function userIdFromMetadata(obj: any): string | null {
  const m = obj?.metadata ?? {};
  return m.user_id ?? null;
}

async function planForInvoice(invoice: any, store: AnyStore | undefined): Promise<{ userId: string; plan: any } | null> {
  if (!store) return null;
  let plan: any = null;
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  if (subscriptionId) plan = await store.getUserPlanBySubscriptionId(subscriptionId);
  if (!plan) {
    const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
    if (customerId) plan = await store.getUserPlanByCustomerId(customerId);
  }
  if (!plan) return null;
  return { userId: plan.user_id, plan };
}

async function onCheckoutSessionCompleted(session: any, store?: AnyStore): Promise<void> {
  if (!store) return;
  const userId = userIdFromMetadata(session);
  if (!userId) {
    console.error("checkout.session.completed: missing user_id in metadata");
    return;
  }
  const metadata = session.metadata ?? {};
  if (metadata.product !== "vps") return;

  const tier = metadata.size ?? "";
  const sub = typeof session.subscription === "object" && session.subscription ? session.subscription : null;
  const subscriptionId = sub?.id ?? session.subscription ?? null;
  const customerId = session.customer ?? null;

  const existing = await store.getUserPlan(userId);
  const wasTrialing = existing?.status === "trialing";
  await store.setUserPlan(userId, {
    product: "vps",
    tier,
    status: "trialing",
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    trial_end: toUtcText(sub?.trial_end),
    current_period_start: toUtcText(sub?.current_period_start),
    current_period_end: toUtcText(sub?.current_period_end),
  });
  if (!wasTrialing) await store.incrementTrialCount(userId);
}

async function onSubscriptionUpdated(subscription: any, store?: AnyStore): Promise<void> {
  if (!store) return;
  const userId = userIdFromMetadata(subscription);
  if (!userId) {
    console.error("customer.subscription.updated: missing user_id in metadata");
    return;
  }

  await store.setUserPlan(userId, {
    product: (await store.getUserPlan(userId))?.product ?? "vps",
    tier: (await store.getUserPlan(userId))?.tier ?? "",
    status: subscription.status,
    stripe_customer_id: subscription.customer ?? null,
    stripe_subscription_id: subscription.id ?? null,
    trial_end: toUtcText(subscription.trial_end),
    current_period_start: toUtcText(subscription.current_period_start),
    current_period_end: toUtcText(subscription.current_period_end),
  });
}

async function onInvoicePaid(invoice: any, store?: AnyStore): Promise<void> {
  if (!store) return;
  const found = await planForInvoice(invoice, store);
  if (!found) return;
  const { userId, plan } = found;

  const currentEnd = plan.current_period_end;
  const oldEnd = currentEnd ? new Date(currentEnd + "Z") : null;
  if (!oldEnd || isNaN(oldEnd.getTime())) return;

  const newStart = new Date(oldEnd.getTime());
  const newEnd = new Date(oldEnd.getTime());
  newEnd.setUTCMonth(newEnd.getUTCMonth() + 1);

  await store.setUserPlan(userId, {
    product: plan.product,
    tier: plan.tier,
    status: plan.status,
    stripe_customer_id: plan.stripe_customer_id,
    stripe_subscription_id: plan.stripe_subscription_id,
    trial_end: plan.trial_end,
    current_period_start: newStart.toISOString().slice(0, 19).replace("T", " "),
    current_period_end: newEnd.toISOString().slice(0, 19).replace("T", " "),
  });
}

async function onInvoicePaymentFailed(invoice: any, store?: AnyStore): Promise<void> {
  if (!store) return;
  const found = await planForInvoice(invoice, store);
  if (!found) return;
  const { userId, plan } = found;

  await store.setUserPlan(userId, {
    product: plan.product,
    tier: plan.tier,
    status: "past_due",
    stripe_customer_id: plan.stripe_customer_id,
    stripe_subscription_id: plan.stripe_subscription_id,
    trial_end: plan.trial_end,
    current_period_start: plan.current_period_start,
    current_period_end: plan.current_period_end,
  });
}

async function onSubscriptionDeleted(subscription: any, store?: AnyStore): Promise<void> {
  if (!store) return;
  const userId = userIdFromMetadata(subscription);
  if (!userId) {
    console.error("customer.subscription.deleted: missing user_id in metadata");
    return;
  }

  const plan = await store.getUserPlan(userId);
  await store.setUserPlan(userId, {
    product: plan?.product ?? "vps",
    tier: plan?.tier ?? "",
    status: "canceled",
    stripe_customer_id: subscription.customer ?? null,
    stripe_subscription_id: subscription.id ?? null,
    trial_end: toUtcText(subscription.trial_end),
    current_period_start: toUtcText(subscription.current_period_start),
    current_period_end: toUtcText(subscription.current_period_end),
    vm_ref: null,
    region: null,
  });
}
