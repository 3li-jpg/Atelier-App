import { test, expect } from "@playwright/test";
import {
  AUTHED_STATUS,
  DEFAULT_ACCOUNT,
  GUEST_STATUS,
  markOnboarded,
  mockApi,
  mockSuccessfulLogin,
} from "./helpers";

// E2E: App shell after the chat-first pivot.
// Nav is now Repos / Workspaces / Providers (+ Settings in the user section).
// The "New Task" tab is gone — repo import (Repos) replaced it.
// All network is mocked via page.route — no backend needed.

const PROVIDER = {
  id: "p1",
  name: "Umans",
  base_url: "https://api.code.umans.ai/v1",
  dialect: "openai-chat",
  models: [{ id: "umans-glm-5.2", role: "coder", tool_calls: true }],
  created_at: "2026-07-12T10:00:00Z",
};

const REPO = {
  id: 101,
  full_name: "acme/widget-factory",
  default_branch: "main",
  private: false,
};

test.describe("App shell", () => {
  test("returning user sees dashboard with sidebar nav (desktop)", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page);

    await page.goto("/");
    // Desktop: left sidebar is visible, mobile tab bar is hidden.
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".shell-tabbar")).toBeHidden();
    await expect(page.locator(".shell-wordmark").first()).toHaveText("Atelier");

    // Three nav items in the sidebar: Repos, Workspaces, Providers.
    const nav = page.locator(".shell-nav");
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("button", { name: "Repos" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Workspaces" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Providers" })).toBeVisible();

    // "New Task" is gone — repo import replaced it.
    await expect(nav.getByRole("button", { name: "New Task" })).toHaveCount(0);

    // Settings lives in the user section, not the main nav.
    await expect(page.locator(".shell-user").getByRole("button", { name: "Settings" })).toBeVisible();

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
    await mockApi(page, { providers: [PROVIDER], repos: [REPO] });
  });

  test("clicking nav items swaps the active view and header", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    // Workspaces is the default view.
    await expect(page.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible();
    await expect(page.locator(".shell-nav-item.active")).toHaveText("Workspaces");

    // → Providers
    await page.locator(".shell-nav").getByRole("button", { name: "Providers" }).click();
    await expect(page.getByRole("heading", { name: "Providers", exact: true })).toBeVisible();
    await expect(page.locator(".shell-nav-item.active")).toHaveText("Providers");

    // → Repos
    await page.locator(".shell-nav").getByRole("button", { name: "Repos" }).click();
    await expect(page.getByRole("heading", { name: "Repos", exact: true })).toBeVisible();
    await expect(page.locator(".shell-nav-item.active")).toHaveText("Repos");

    // → Settings (lives in the user section)
    await page.locator(".shell-user").getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

    // → back to Workspaces
    await page.locator(".shell-nav").getByRole("button", { name: "Workspaces" }).click();
    await expect(page.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible();
  });
});

test.describe("Mobile bottom tab bar (<900px)", () => {
  test.beforeEach(async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [PROVIDER], repos: [REPO] });
  });

  test("mobile shows header + bottom tab bar, sidebar hidden", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".shell-mobile-header")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".shell-tabbar")).toBeVisible();
    await expect(page.locator(".shell-sidebar")).toBeHidden();

    // Three tabs in the bottom bar (Repos, Workspaces, Providers) + Settings.
    const tabs = page.locator(".shell-tabbar .shell-tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs.filter({ hasText: "Workspaces" })).toHaveClass(/active/);
  });

  test("tapping a bottom tab switches the active view", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".shell-tabbar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-tabbar").getByRole("button", { name: "Providers" }).click();
    await expect(page.getByRole("heading", { name: "Providers", exact: true })).toBeVisible();
    await expect(page.locator(".shell-tabbar .shell-tab.active")).toHaveText("Providers");

    await page.locator(".shell-tabbar").getByRole("button", { name: "Repos" }).click();
    await expect(page.getByRole("heading", { name: "Repos", exact: true })).toBeVisible();
    await expect(page.locator(".shell-tabbar .shell-tab.active")).toHaveText("Repos");
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

test.describe("Workspaces (SessionsList)", () => {
  test("empty state says 'No workspaces yet' and points to Repos", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { sessions: [] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText("No workspaces yet")).toBeVisible();
    await expect(page.getByText(/Import a repo from the Repos tab/)).toBeVisible();
  });

  test("terminal card delete confirm removes the workspace", async ({ page }) => {
    await markOnboarded(page);
    // One completed (terminal) session + one running session.
    await mockApi(page, {
      sessions: [
        { id: "sess-done", repo_url: "https://github.com/acme/widget", model_id: "m", task: "finished work", state: "completed", started_at: "2026-07-12T10:00:00Z", ended_at: "2026-07-12T10:30:00Z", branch: "main" },
        { id: "sess-run", repo_url: "https://github.com/acme/widget", model_id: "m", task: "in flight", state: "running", started_at: "2026-07-12T11:00:00Z", ended_at: null, branch: "main" },
      ],
    });
    // Capture the DELETE on the terminal session.
    let deletedId = "";
    await page.route("**/sessions/*", (route) => {
      if (route.request().method() === "DELETE") {
        deletedId = route.request().url().split("/").pop() ?? "";
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      }
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    // The completed card has a Delete affordance; the running one does not.
    const doneCard = page.locator(".session-list li").filter({ hasText: "finished work" });
    await expect(doneCard.getByRole("button", { name: "Delete workspace" })).toBeAttached();
    const runCard = page.locator(".session-list li").filter({ hasText: "in flight" });
    await expect(runCard.getByRole("button", { name: "Delete workspace" })).toHaveCount(0);

    // Click Delete → confirm prompt appears. (force: opacity:0 hover-gated.)
    await doneCard.getByRole("button", { name: "Delete workspace" }).click({ force: true });
    await expect(doneCard.getByRole("button", { name: "Confirm" })).toBeVisible();

    // Confirm → DELETE fires, card removed.
    await doneCard.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => deletedId).toBe("sess-done");
    await expect(page.locator(".session-list li").filter({ hasText: "finished work" })).toHaveCount(0);
    // The running card is still there.
    await expect(runCard).toBeVisible();
  });
});

test.describe("Repos view", () => {
  test("unconnected state shows Connect GitHub when oauth is false", async ({ page }) => {
    await markOnboarded(page);
    // oauth:false → Repos goes to the connect phase.
    await mockApi(page, { auth: { ...AUTHED_STATUS, oauth: false } });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "Repos" }).click();
    await expect(page.getByRole("heading", { name: "Connect GitHub to import repos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
  });

  test("connected: list renders, opening a repo shows the new-workspace sheet", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [PROVIDER], repos: [REPO] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "Repos" }).click();

    // The repo appears in the list.
    const repoBtn = page.locator(".rp-repo").filter({ hasText: "acme/widget-factory" });
    await expect(repoBtn).toBeVisible();

    // Clicking it opens the inline new-workspace sheet.
    await repoBtn.click();
    await expect(page.locator(".rp-sheet")).toBeVisible();
    // Provider + model selects are present (provider pre-listed).
    await expect(page.locator(".rp-sheet select").first()).toBeVisible();
    // Create button is disabled until provider+model+branch are chosen.
    await expect(page.getByRole("button", { name: "Create workspace" })).toBeDisabled();
  });

  test("creating a workspace POSTs /sessions and navigates to the session", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [PROVIDER], repos: [REPO] });
    // Capture the POST and return a known session id.
    let createdBody: unknown = null;
    await page.route("**/sessions", (route) => {
      if (route.request().method() === "POST") {
        createdBody = JSON.parse(route.request().postData() ?? "null");
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: "sess-from-repo", state: "queued" }),
        });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      }
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "Repos" }).click();
    await page.locator(".rp-repo").filter({ hasText: "acme/widget-factory" }).click();

    // The sheet has three selects: Branch, Provider, Model (branch loads async
    // from /repos/:owner/:repo/branches). Select provider by visible label,
    // then model — Create enables once all three are chosen.
    await page.locator(".rp-sheet select").nth(1).selectOption(PROVIDER.id);
    await page.locator(".rp-sheet select").nth(2).selectOption(PROVIDER.models[0].id);

    await page.getByRole("button", { name: "Create workspace" }).click();

    // Navigates into the SessionView workspace shell.
    await expect(page.locator(".ws")).toBeVisible({ timeout: 10_000 });
    expect(createdBody).toBeTruthy();
    expect((createdBody as { repo_url: string }).repo_url).toContain("acme/widget-factory");
  });
});

test.describe("Settings view", () => {
  test("renders account, plan, and usage from /account", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, {
      account: {
        user: { id: "u-1", login: "ali@studioatelier.ca", name: "Ali", avatar_url: null, github_connected: true },
        plan: { id: "free", name: "Free", byok: true, compute: "byoc" },
        usage: { sessions: 5, billed_seconds: 5400 },
        compute: { byoc_provider: null },
      },
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-user").getByRole("button", { name: "Settings" }).click();

    // Account login.
    await expect(page.locator(".st-account-login").first()).toHaveText("ali@studioatelier.ca");
    // GitHub connected chip.
    await expect(page.locator(".st-chip.ok").filter({ hasText: "GitHub connected" })).toBeVisible();
    // Plan name.
    await expect(page.locator(".st-section").filter({ hasText: "Plan" }).locator(".st-account-login")).toHaveText("Free");
    // Usage: 5 workspaces, 5400s = 1h 30m.
    await expect(page.locator(".st-stat-value").nth(0)).toHaveText("5");
    await expect(page.locator(".st-stat-value").nth(1)).toHaveText("1h 30m");
  });

  test("saving a compute key PUTs to /account/compute", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { account: DEFAULT_ACCOUNT });
    let putBody: unknown = null;
    await page.route("**/account/compute", (route) => {
      if (route.request().method() === "PUT") {
        putBody = JSON.parse(route.request().postData() ?? "null");
      }
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-user").getByRole("button", { name: "Settings" }).click();

    // Fill the compute form.
    await page.locator('input[placeholder="paste your E2B/Daytona key"]').fill("e2b-secret-key");
    await page.getByRole("button", { name: "Save compute" }).click();

    // The PUT was made with the provider + key.
    await expect.poll(() => putBody).toEqual({ provider: "e2b", api_key: "e2b-secret-key" });
  });

  test("sign out returns to the auth gate", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { account: DEFAULT_ACCOUNT });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-user").getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();

    // Back to the sign-in card.
    await expect(page.locator(".auth-gate")).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Providers view", () => {
  test("renders preset cards and the add-provider form when empty", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "Add provider" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Test" })).toBeVisible();

    // Selecting the Custom preset unlocks the editable Name input.
    await presets.filter({ hasText: "Custom" }).click();
    await expect(presets.filter({ hasText: "Custom" })).toHaveAttribute("aria-checked", "true");
    const nameInput = page.locator('input[placeholder="My OpenRouter"]');
    await expect(nameInput).toBeVisible();
  });

  test("edit flow PATCHes /providers/:id", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [PROVIDER] });
    let patchBody: unknown = null;
    let patchMethod = "";
    await page.route("**/providers/p1", (route) => {
      patchMethod = route.request().method();
      if (patchMethod === "PATCH") patchBody = JSON.parse(route.request().postData() ?? "null");
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "Providers" }).click();

    // The provider card renders with an Edit button.
    await expect(page.locator(".pv-card").filter({ hasText: "Umans" })).toBeVisible();
    await page.locator(".pv-card").filter({ hasText: "Umans" }).getByRole("button", { name: "Edit" }).click();

    // Editor appears (in-card). Change the name and save.
    const nameInput = page.locator(".pv-editor.in-card input").first();
    await nameInput.fill("Umans Renamed");
    await page.locator(".pv-editor.in-card").getByRole("button", { name: "Save" }).click();

    await expect.poll(() => patchMethod).toBe("PATCH");
    expect((patchBody as { name: string }).name).toBe("Umans Renamed");
  });

  test("delete confirm flow DELETEs /providers/:id", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [PROVIDER] });
    let deleteMethod = "";
    await page.route("**/providers/p1", (route) => {
      deleteMethod = route.request().method();
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "Providers" }).click();
    const card = page.locator(".pv-card").filter({ hasText: "Umans" });

    // Click Delete → inline confirm prompt appears.
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(card.getByText("Delete provider?")).toBeVisible();

    // Confirm → DELETE fires.
    await card.getByRole("button", { name: "Confirm" }).click();
    await expect.poll(() => deleteMethod).toBe("DELETE");
  });

  test("models editor adds and removes rows", async ({ page }) => {
    await markOnboarded(page);
    await mockApi(page, { providers: [] });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "Providers" }).click();

    // Default preset (Umans) seeds four model rows.
    const modelRows = page.locator('.pv-rows .pv-row:has(input[aria-label="Model id"])');
    await expect(modelRows).toHaveCount(4);

    // Add a model row.
    await page.getByRole("button", { name: "+ Add model" }).click();
    await expect(modelRows).toHaveCount(5);

    // Remove the last row (only shows ✕ when more than one model).
    await modelRows.nth(4).getByRole("button", { name: "Remove model" }).click();
    await expect(modelRows).toHaveCount(4);
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
