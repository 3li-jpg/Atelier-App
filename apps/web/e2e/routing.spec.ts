import { test, expect, type Route } from "@playwright/test";
import { markOnboarded, mockApi, AUTHED_STATUS } from "./helpers";

// E2E: hash routing (App.tsx). Views map to #/workspaces, #/repos, #/providers,
// #/settings, #/w/<id>. Back/Forward work via popstate/hashchange. Onboarding
// precedes routing. A guest deep-linking #/w/<id> hits the sign-in gate, then
// lands on the session after login. All network mocked — no backend.

const SESSION_ID = "sess-route-1";
const SESSION_DETAIL = {
  id: SESSION_ID,
  repo_url: "https://github.com/acme/widget-factory.git",
  branch: "main",
  model_id: "umans-glm-5.2",
  task: "Routing e2e task",
  state: "running",
  started_at: "2026-07-12T10:00:00Z",
  ended_at: null,
  provider_id: "prov-1",
  permission_mode: "auto",
  machine_id: "mac-1",
  budgets: "{}",
  billed_seconds: 0,
};
const SESSIONS_LIST = [{ ...SESSION_DETAIL }];

/** Mock the single-session detail + SSE stream so #/w/<id> renders SessionView. */
async function mockSessionRoutes(page: import("@playwright/test").Page) {
  await page.route(`**/sessions/${SESSION_ID}`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL) }),
  );
  // Empty SSE stream — SessionView just needs a 200 on the EventSource.
  await page.route(`**/sessions/${SESSION_ID}/stream**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }),
  );
}

test.describe("Hash routing", () => {
  test.beforeEach(async ({ page }) => {
    await markOnboarded(page);
    // sessions list returns our one session so the list view is populated.
    await mockApi(page, { sessions: SESSIONS_LIST });
    await mockSessionRoutes(page);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("direct-loading #/settings renders Settings", async ({ page }) => {
    await page.goto("#/settings");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });
    // Settings view (not the default Workspaces list).
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
    // The hash survives load.
    await expect(page).toHaveURL(/#\/settings$/);
  });

  test("direct-loading #/providers renders Providers", async ({ page }) => {
    await page.goto("#/providers");
    await expect(page.getByRole("heading", { name: "Providers", exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("unknown hash falls back to the Workspaces list", async ({ page }) => {
    await page.goto("#/nope/bogus");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible();
  });

  test("direct-loading #/w/<id> renders the session", async ({ page }) => {
    await page.goto(`#/w/${SESSION_ID}`);
    await expect(page.locator(".ws")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`#/w/${SESSION_ID}$`));
  });

  test("Back from a workspace returns to the Workspaces list", async ({ page }) => {
    // Start at the list, open the session card (pushes #/w/<id>).
    await page.goto("#/workspaces");
    await expect(page.locator(".session-card").first()).toBeVisible({ timeout: 10_000 });
    await page.locator(".session-card").first().click();
    await expect(page.locator(".ws")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`#/w/${SESSION_ID}$`));

    // Browser Back → back to the list (history.popstate → view = list).
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Workspaces", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/#\/workspaces$/);
  });

  test("nav clicks update the hash", async ({ page }) => {
    await page.goto("#/workspaces");
    await expect(page.locator(".shell-sidebar")).toBeVisible({ timeout: 10_000 });

    await page.locator(".shell-nav").getByRole("button", { name: "Repos" }).click();
    await expect(page).toHaveURL(/#\/repos$/);

    await page.locator(".shell-nav").getByRole("button", { name: "Workspaces" }).click();
    await expect(page).toHaveURL(/#\/workspaces$/);
  });
});

test.describe("Auth gate + deep link", () => {
  test("guest hitting #/w/<id> sees sign-in, then lands on the session after login", async ({ page }) => {
    await markOnboarded(page);
    // Guest auth + the session routes (the gate must not render the session).
    await mockApi(page, { auth: { oauth: false, authed: false, owner: false, user: null }, sessions: SESSIONS_LIST });
    await mockSessionRoutes(page);
    // Successful login mock.
    await page.route("**/auth/login", (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, user: { login: "ali@studioatelier.ca" }, session_token: "tok-123" }),
      }),
    );
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(`#/w/${SESSION_ID}`);
    // Sign-in gate, NOT the session.
    await expect(page.locator(".auth-card")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".ws")).toHaveCount(0);

    // Log in → the stashed #/w/<id> view renders.
    await page.getByLabel("Email").fill("ali@studioatelier.ca");
    await page.getByLabel("Password").fill("correct-horse-battery-staple");
    await page.locator("form").getByRole("button", { name: "Log in" }).click();

    await expect(page.locator(".ws")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(`#/w/${SESSION_ID}$`));
  });
});

test.describe("Onboarding precedes routing", () => {
  test("a not-onboarded user landing on #/w/<id> sees onboarding, not the session", async ({ page }) => {
    // No onboarded flag → onboarding wins, even with a deep-link hash.
    await page.addInitScript(() => localStorage.clear());
    await mockApi(page, { auth: AUTHED_STATUS, sessions: SESSIONS_LIST });
    await mockSessionRoutes(page);
    await page.setViewportSize({ width: 1280, height: 800 });

    await page.goto(`#/w/${SESSION_ID}`);
    await expect(page.locator(".onboarding")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".ws")).toHaveCount(0);
  });
});
