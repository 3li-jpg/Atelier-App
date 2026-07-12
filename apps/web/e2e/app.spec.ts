import { test, expect } from "@playwright/test";

// E2E: App loads and shows the Atelier shell.
// The web app requires the API proxy (Vite dev server proxies /auth, /sessions, /providers to :3000).
// Without the API running, the app should still render the shell and show appropriate empty/loading states.
// First-time users see the Onboarding flow; returning users (localStorage flag) see the dashboard.

test.describe("App shell", () => {
  test("loads and shows Atelier brand or onboarding", async ({ page }) => {
    // Clear localStorage to simulate first-time user
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/");
    // The app should render something — either onboarding or the main shell
    await page.waitForTimeout(2000);
    const body = page.locator("body");
    await expect(body).toBeVisible();
    // Check that the page has content (not a blank screen)
    const text = await body.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test("returning user sees dashboard with nav tabs", async ({ page }) => {
    // Set the onboarded flag to skip onboarding
    await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
    await page.goto("/");
    await expect(page.locator("header, .topbar")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Atelier").first()).toBeVisible();
    // Should have nav buttons
    await expect(page.locator("nav, .nav")).toBeVisible();
  });

  test("no unexpected console errors on load", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/");
    await page.waitForTimeout(2000);
    // Filter out expected network errors (API not running in test env)
    const unexpected = errors.filter(
      (e) =>
        !e.includes("Failed to fetch") &&
        !e.includes("NetworkError") &&
        !e.includes("ERR_CONNECTION_REFUSED") &&
        !e.includes("500") && // API returns 500 when not configured
        !e.includes("401"), // API returns 401 when auth not configured
    );
    expect(unexpected).toEqual([]);
  });
});

test.describe("Onboarding flow", () => {
  test("first-time user sees onboarding", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await page.goto("/");
    await page.waitForTimeout(2000);
    // Should see onboarding-related content (welcome, account, model, etc.)
    const body = page.locator("body");
    const text = await body.textContent();
    const hasOnboarding =
      text?.includes("Account") ||
      text?.includes("Model") ||
      text?.includes("Welcome") ||
      text?.includes("Repo") ||
      text?.includes("Skip");
    expect(hasOnboarding).toBeTruthy();
  });
});

test.describe("Responsive", () => {
  test("mobile viewport renders without horizontal scroll", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForTimeout(1000);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // +1 for sub-pixel
  });

  test("desktop viewport renders", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(1000);
    await expect(page.getByText("Atelier").first()).toBeVisible();
  });
});
