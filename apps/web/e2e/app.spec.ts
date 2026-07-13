import { test, expect } from "@playwright/test";
import {
  AUTHED_STATUS,
  GUEST_STATUS,
  markOnboarded,
  mockApi,
  mockSuccessfulLogin,
} from "./helpers";

// E2E: App shell after the auth-gate overhaul.
// All network is mocked via page.route — no backend needed.

test.describe("App shell", () => {
  test("returning user sees dashboard with sidebar nav (desktop)", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page);

    await page.goto("/");
    // Desktop: left sidebar is visible, mobile tab bar is hidden.
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".shell-tabbar")).toBeHidden();
    await expect(page.locator(".shell-wordmark").first()).toHaveText("Atelier");

    // Three nav items exist.
    const nav = page.locator(".shell-nav");
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("button", { name: "Sessions" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "New Task" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Providers" })).toBeVisible();

    // Authed user's login shows in the user section.
    await expect(page.locator(".shell-user")).toContainText("testuser@example.com");
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  });

  test("no unexpected console errors on load", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page);
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });
    // Let any lazy-loaded views / SSE settle.
    await page.waitForTimeout(1000);

    const unexpected = errors.filter(
      (e) =>
        !e.includes("Failed to fetch") &&
        !e.includes("NetworkError") &&
        !e.includes("ERR_CONNECTION_REFUSED"),
    );
    expect(unexpected).toEqual([]);
  });
});

test.describe("Signed-out auth gate", () => {
  test("guest renders the sign-in card and switches Log in / Sign up tabs", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { auth: GUEST_STATUS });

    await page.goto("/");
    await expect(page.locator(".auth-gate")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".auth-card")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome back to Atelier" })).toBeVisible();

    // Log in tab is active by default. (Scope to .auth-tabs — the submit button
    // is also labelled "Log in".)
    const tabs = page.locator(".auth-tabs");
    const loginTab = tabs.getByRole("button", { name: "Log in" });
    const signupTab = tabs.getByRole("button", { name: "Sign up" });
    await expect(loginTab).toHaveClass(/active/);
    await expect(signupTab).not.toHaveClass(/active/);

    // Switch to Sign up.
    await signupTab.click();
    await expect(signupTab).toHaveClass(/active/);
    await expect(loginTab).not.toHaveClass(/active/);

    // No GitHub OAuth button when oauth:false.
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toHaveCount(0);
  });

  test("successful login lands on the dashboard", async ({ page }) => {
    await markOnboarded(page);
    // Guest until login; onSuccess flips auth client-side (no /auth/status re-fetch).
    await mockApi(page, { auth: GUEST_STATUS });
    await mockSuccessfulLogin(page);

    await page.goto("/");
    await expect(page.locator(".auth-card")).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Email").fill("ali@studioatelier.ca");
    await page.getByLabel("Password").fill("correct-horse-battery-staple");
    // Scope to the form so we click the submit button, not the tab of the same name.
    await page.locator("form").getByRole("button", { name: "Log in" }).click();

    // Dashboard shell appears with the logged-in user.
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".shell-user")).toContainText("ali@studioatelier.ca");
  });
});

test.describe("Sidebar nav switches views (desktop ≥900px)", () => {
  test.beforeEach(async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [{ id: "p1", name: "Umans", base_url: "https://api.code.umans.ai/v1", dialect: "openai-chat", models: [{ id: "umans-glm-5.2", role: "coder" }], created_at: "2026-07-12T10:00:00Z" }] });
  });

  test("clicking nav items swaps the active view and header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    // Sessions is the default view.
    await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
    await expect(page.locator(".shell-nav-item.active")).toHaveText("Sessions");

    // → Providers
    await page.locator(".shell-nav").getByRole("button", { name: "Providers" }).click();
    await expect(page.getByRole("heading", { name: "Providers", exact: true })).toBeVisible();
    await expect(page.locator(".shell-nav-item.active")).toHaveText("Providers");

    // → New Task
    await page.locator(".shell-nav").getByRole("button", { name: "New Task" }).click();
    await expect(page.getByRole("heading", { name: "New Task", exact: true })).toBeVisible();
    await expect(page.locator(".shell-nav-item.active")).toHaveText("New Task");

    // → back to Sessions
    await page.locator(".shell-nav").getByRole("button", { name: "Sessions" }).click();
    await expect(page.getByRole("heading", { name: "Sessions", exact: true })).toBeVisible();
  });
});

test.describe("Mobile bottom tab bar (<900px)", () => {
  test.beforeEach(async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [{ id: "p1", name: "Umans", base_url: "https://api.code.umans.ai/v1", dialect: "openai-chat", models: [{ id: "umans-glm-5.2", role: "coder" }], created_at: "2026-07-12T10:00:00Z" }] });
  });

  test("mobile shows header + bottom tab bar, sidebar hidden", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".shell-mobile-header")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".shell-tabbar")).toBeVisible();
    await expect(page.locator(".shell-sidebar")).toBeHidden();

    // Three tabs in the bottom bar.
    const tabs = page.locator(".shell-tabbar .shell-tab");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.filter({ hasText: "Sessions" })).toHaveClass(/active/);
  });

  test("tapping a bottom tab switches the active view", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".shell-tabbar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-tabbar").getByRole("button", { name: "Providers" }).click();
    await expect(page.getByRole("heading", { name: "Providers", exact: true })).toBeVisible();
    await expect(page.locator(".shell-tabbar .shell-tab.active")).toHaveText("Providers");

    await page.locator(".shell-tabbar").getByRole("button", { name: "New Task" }).click();
    await expect(page.getByRole("heading", { name: "New Task", exact: true })).toBeVisible();
    await expect(page.locator(".shell-tabbar .shell-tab.active")).toHaveText("New Task");
  });

  test("mobile viewport renders without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".shell-tabbar")).toBeVisible({ timeout: 10_000 });
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // +1 sub-pixel tolerance
  });
});

test.describe("NewTask view", () => {
  test("shows 'Add a provider first' when /providers returns []", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "New Task" }).click();
    // StateMessage empty/info guidance for missing provider.
    await expect(page.getByText("Add a provider first")).toBeVisible();
    await expect(page.getByText(/Switch to the Providers tab/)).toBeVisible();
  });
});

test.describe("Providers view", () => {
  test("renders preset cards and the add-provider form", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "Providers" }).click();

    // Preset radiogroup with one card per preset (Umans, OpenRouter, Anthropic, OpenAI, GLM, Custom).
    const presets = page.locator('[role="radiogroup"][aria-label="Provider preset"] [role="radio"]');
    await expect(presets).toHaveCount(6, { timeout: 10_000 });
    // The Umans preset is selected by default.
    await expect(presets.filter({ hasText: "Umans" })).toHaveAttribute("aria-checked", "true");

    // Form fields: API key input + Save/Test actions.
    // (Note: the @atelier/ui Input only associates its <label> when an id/name
    // is passed; Providers.tsx passes neither, so getByLabel won't match —
    // assert via the placeholder instead. See summary for the app bug.)
    await expect(page.locator('input[placeholder="sk-…"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Test key" })).toBeVisible();

    // Selecting the Custom preset unlocks the editable Name/Base URL inputs.
    await presets.filter({ hasText: "Custom" }).click();
    await expect(presets.filter({ hasText: "Custom" })).toHaveAttribute("aria-checked", "true");
    const nameInput = page.locator('input[placeholder="My OpenRouter"]');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).not.toHaveAttribute("readonly");
  });
});

test.describe("Onboarding", () => {
  test("first-time user sees onboarding", async ({ page }) => {
    // No onboarded flag → App renders the Onboarding view.
    await page.addInitScript(() => localStorage.clear());
    await mockApi(page, { auth: AUTHED_STATUS });
    await page.goto("/");
    // Onboarding renders its progress dots and step labels.
    await expect(page.locator(".onboarding")).toBeVisible({ timeout: 10_000 });
    // Step labels live in the progress indicator (scoped to avoid matching
    // the model/preset text elsewhere in the onboarding steps).
    const progress = page.locator(".onb-progress");
    await expect(progress.getByText("Account", { exact: true })).toBeVisible();
    await expect(progress.getByText("Model", { exact: true })).toBeVisible();
    await expect(progress.getByText("Repo", { exact: true })).toBeVisible();
    await expect(progress.getByText("Task", { exact: true })).toBeVisible();
    // Skip link lets an existing user bail to the dashboard.
    await expect(page.getByRole("button", { name: /Skip setup/ })).toBeVisible();
  });
});
