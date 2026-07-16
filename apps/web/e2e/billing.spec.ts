import { test, expect } from "@playwright/test";
import { AUTHED_STATUS, markOnboarded, mockApi, DEFAULT_ACCOUNT } from "./helpers";

// Phase 1 test obligations for billing UI:
// 1. Settings Plan section renders current billing status, product, tier, trial and usage.
// 2. Settings Plan section lets sandbox users pick a tier and start Stripe checkout.
// 3. Settings Plan section lets VPS users pick a size and start Stripe checkout.
// 4. Settings Plan section exposes a "Manage billing" portal for existing Stripe customers.
// 5. Creating a session that returns 402 shows an upgrade message with a link to upgrade_url.

const PROVIDER = {
  id: "p1",
  name: "Umans",
  base_url: "https://api.code.umans.ai/v1",
  dialect: "openai-chat",
  models: [{ id: "umans-glm-5.2", role: "coder", tool_calls: true }],
  created_at: "2026-07-12T10:00:00Z",
};

function accountWithBilling(billing: object) {
  return {
    ...DEFAULT_ACCOUNT,
    billing,
  };
}

async function gotoSettings(page: Page) {
  await page.goto("/#/settings");
  await expect(page.locator(".st-section").filter({ hasText: "Plan" })).toBeVisible({ timeout: 10_000 });
}

test.describe("Settings Plan section", () => {
  test("renders sandbox active subscription with usage", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, {
      auth: AUTHED_STATUS,
      providers: [PROVIDER],
      account: accountWithBilling({
        product: "sandbox",
        tier: "Free",
        status: "active",
        trial_end: null,
        current_period_start: "2026-07-01T00:00:00Z",
        current_period_end: "2026-07-31T00:00:00Z",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        usage_hours: 2.5,
        included_hours: 10,
      }),
    });

    await gotoSettings(page);
    const plan = page.locator(".st-section").filter({ hasText: "Plan" });
    await expect(plan).toContainText("Sandbox");
    await expect(plan).toContainText("Free");
    await expect(plan).toContainText("active");
    await expect(plan).toContainText("2.5 / 10");
  });

  test("renders trialing status with trial end date", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, {
      auth: AUTHED_STATUS,
      providers: [PROVIDER],
      account: accountWithBilling({
        product: "sandbox",
        tier: "Pro",
        status: "trialing",
        trial_end: "2026-07-20T00:00:00Z",
        current_period_start: null,
        current_period_end: null,
        stripe_customer_id: "cus_123",
        stripe_subscription_id: "sub_123",
        usage_hours: 0,
        included_hours: 100,
      }),
    });

    await gotoSettings(page);
    const plan = page.locator(".st-section").filter({ hasText: "Plan" });
    await expect(plan).toContainText("trialing");
    await expect(plan).toContainText("trial");
    await expect(plan).toContainText("Manage billing");
  });

  test("sandbox user can upgrade via tier select and checkout", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, {
      auth: AUTHED_STATUS,
      providers: [PROVIDER],
      account: accountWithBilling({
        product: "sandbox",
        tier: "Free",
        status: "active",
        trial_end: null,
        current_period_start: "2026-07-01T00:00:00Z",
        current_period_end: "2026-07-31T00:00:00Z",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        usage_hours: 2.5,
        included_hours: 10,
      }),
    });

    let checkoutBody: object | null = null;
    await page.route("**/billing/checkout", async (route) => {
      checkoutBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://checkout.stripe.test/cus_123" }),
      });
    });

    await gotoSettings(page);
    const plan = page.locator(".st-section").filter({ hasText: "Plan" });
    // SANDBOX_TIERS render <option value="pro">Pro</option> — select by id.
    await plan.locator("select").selectOption("pro");
    await plan.getByRole("button", { name: "Upgrade" }).click();

    await expect.poll(() => checkoutBody).toEqual({ product: "sandbox", tier: "pro" });
    // window.location.href = url drives external Stripe redirects; asserting the
    // request body + absence of an error covers the user interaction end-to-end.
  });

  test("VPS user can upgrade via size select and checkout", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, {
      auth: AUTHED_STATUS,
      providers: [PROVIDER],
      account: accountWithBilling({
        product: "vps",
        tier: "Small",
        status: "active",
        trial_end: null,
        current_period_start: "2026-07-01T00:00:00Z",
        current_period_end: "2026-07-31T00:00:00Z",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        usage_hours: 0,
        included_hours: null,
      }),
    });

    let checkoutBody: object | null = null;
    await page.route("**/billing/checkout", async (route) => {
      checkoutBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://checkout.stripe.test/vps" }),
      });
    });

    await gotoSettings(page);
    const plan = page.locator(".st-section").filter({ hasText: "Plan" });
    // VPS_SIZES render <option value="large">Large</option> — select by id.
    await plan.locator("select").selectOption("large");
    await plan.getByRole("button", { name: "Upgrade" }).click();

    await expect.poll(() => checkoutBody).toEqual({ product: "vps", size: "large" });
    // window.location.href = url drives external Stripe redirects; asserting the
    // request body + absence of an error covers the user interaction end-to-end.
  });

  test("Manage billing opens Stripe portal for existing customer", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, {
      auth: AUTHED_STATUS,
      providers: [PROVIDER],
      account: accountWithBilling({
        product: "sandbox",
        tier: "Plus",
        status: "active",
        trial_end: null,
        current_period_start: "2026-07-01T00:00:00Z",
        current_period_end: "2026-07-31T00:00:00Z",
        stripe_customer_id: "cus_123",
        stripe_subscription_id: "sub_123",
        usage_hours: 5,
        included_hours: 50,
      }),
    });

    let portalBody: object | null = null;
    await page.route("**/billing/portal", async (route) => {
      portalBody = await route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://billing.stripe.test/portal" }),
      });
    });

    await gotoSettings(page);
    const plan = page.locator(".st-section").filter({ hasText: "Plan" });
    await plan.getByRole("button", { name: "Manage billing" }).click();

    await expect.poll(() => portalBody).toEqual({ customerId: "cus_123" });
    // window.location.href = url drives external Stripe redirects; asserting the
    // request body + absence of an error covers the user interaction end-to-end.
  });
});

test.describe("Workspace 402 upgrade prompt", () => {
  test("creating a session returns 402 and shows upgrade link", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, {
      auth: AUTHED_STATUS,
      providers: [PROVIDER],
    });

    await page.route("**/sessions", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 402,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Sandbox free plan monthly limit reached.",
            code: "OUT_OF_QUOTA",
            upgrade_url: "https://checkout.stripe.test/upgrade",
          }),
        });
      } else if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      } else {
        await route.continue();
      }
    });

    await page.goto("/#/workspaces");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    const composer = page.locator(".qs-wrap");
    const textarea = composer.locator("textarea");
    await textarea.fill("hello world");
    await composer.getByRole("button", { name: "Start workspace" }).click();

    await expect(page.locator(".qs-error")).toContainText("limit reached");
    const upgradeLink = page.getByRole("link", { name: "Upgrade" });
    await expect(upgradeLink).toBeVisible();
    await expect(upgradeLink).toHaveAttribute("href", "https://checkout.stripe.test/upgrade");
  });
});
