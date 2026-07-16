import { test, expect, type Route } from "@playwright/test";

// ───────────────────────────────────────────────────────────────
// E2E: SessionView workspace shell.
//
// The SessionView is reached when the user opens a session from the
// Workspaces list (or creates one from Repos). It calls api.getSession(id)
// (REST) and useEventStream(id) (EventSource SSE).
//
// The chat / diff / todos / activity UI now lives inside the embedded
// opencode iframe (.ws-opencode-frame). This suite only asserts on the
// Atelier shell around it: topbar (state badge, mode toggle, overflow menu),
// mobile tabs (Workspace / Browser), the terminal end-of-session bar, and
// ARIA roles. All backend endpoints are mocked via page.route().
// ───────────────────────────────────────────────────────────────

// ── Mock data ──────────────────────────────────────────────────

const MOCK_SESSION_ID = "sess-abc123def456";

const MOCK_SESSION_DETAIL = {
  id: MOCK_SESSION_ID,
  repo_url: "https://github.com/acme/widget-factory.git",
  branch: "feature/auth",
  model_id: "claude-sonnet-4-20250514",
  task: "Add JWT authentication middleware",
  state: "running",
  started_at: "2026-07-12T10:00:00Z",
  ended_at: null,
  provider_id: "prov-1",
  permission_mode: "auto",
  machine_id: "mac-1",
  budgets: "{}",
  billed_seconds: 120,
};

const MOCK_SESSIONS_LIST = [
  {
    id: MOCK_SESSION_ID,
    repo_url: "https://github.com/acme/widget-factory.git",
    branch: "feature/auth",
    model_id: "claude-sonnet-4-20250514",
    task: "Add JWT authentication middleware",
    state: "running",
    started_at: "2026-07-12T10:00:00Z",
    ended_at: null,
  },
];

// ── SSE event fixtures ─────────────────────────────────────────
// Only state_change events still affect the shell (badge + terminal bar);
// the opencode iframe consumes the rest over its own stream.

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type MockEvent = {
  seq: number;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
};

const EVENTS: MockEvent[] = [
  { seq: 1, ts: "2026-07-12T10:00:01Z", type: "state_change", payload: { state: "provisioning" } },
  { seq: 2, ts: "2026-07-12T10:00:05Z", type: "state_change", payload: { state: "running" } },
];

// Terminal (completed) session — the end-of-session bar overlays the opencode
// frame with a "new workspace on this repo" CTA.
const TERMINAL_EVENTS: MockEvent[] = [
  ...EVENTS,
  { seq: 31, ts: "2026-07-12T10:00:51Z", type: "state_change", payload: { state: "completed" } },
];

// ── Route handler helpers ───────────────────────────────────────

/** Intercept all API calls and respond with mock data. */
async function mockApi(page: import("@playwright/test").Page, events: MockEvent[] = EVENTS) {
  // REST endpoints
  await page.route("**/sessions", (route: Route) => {
    if (route.request().method() === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_SESSIONS_LIST),
      });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: MOCK_SESSION_ID, state: "running" }) });
    }
  });

  await page.route(`**/sessions/${MOCK_SESSION_ID}`, (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SESSION_DETAIL),
    });
  });

  await page.route(`**/sessions/${MOCK_SESSION_ID}/cancel`, (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.route(`**/sessions/${MOCK_SESSION_ID}/finish`, (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  // Auth / providers / repos / account — return harmless defaults
  await page.route("**/auth/status", (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ oauth: true, authed: true, owner: true, user: { login: "testuser" } }) });
  });
  await page.route("**/auth/logout", (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.route("**/providers**", (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/repos**", (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/account**", (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "u", login: "testuser", name: null, avatar_url: null, github_connected: true }, plan: { id: "free", name: "Free", byok: true, compute: "byoc" }, usage: { sessions: 1, billed_seconds: 0 }, compute: { byoc_provider: null } }) });
  });

  // Embedded opencode web UI (the workspace iframe) — stub the proxied route so
  // the iframe loads without a 500; no opencode backend exists in the mock env.
  await page.route(new RegExp(`/sessions/${MOCK_SESSION_ID}/opencode/`), (route: Route) => {
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>opencode</title>" });
  });
  // Browser-preview iframe (RightRail) — proxied static route, no backend in the mock env.
  await page.route(new RegExp(`/sessions/${MOCK_SESSION_ID}/preview/`), (route: Route) => {
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>preview</title>" });
  });

  // SSE event stream — fulfill with the mock events
  await page.route(`**/sessions/${MOCK_SESSION_ID}/stream**`, (route: Route) => {
    const body = events.map((e) => sseEvent(e)).join("");
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
      body,
    });
  });
}

/** Navigate to the SessionView by loading the app, waiting for the workspaces
 *  list, then clicking the mock session card. */
async function navigateToSessionView(page: import("@playwright/test").Page) {
  await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
  await page.goto("/");
  // Wait for the workspaces list to render with the mock session.
  await expect(page.locator(".session-card").first()).toBeVisible({ timeout: 10_000 });
  // Click the session card to enter SessionView
  await page.locator(".session-card").first().click();
  // The workspace shell should appear
  await expect(page.locator(".ws")).toBeVisible({ timeout: 10_000 });
}

// ── Tests ───────────────────────────────────────────────────────

test.describe("Workspaces list skeleton loading", () => {
  test("shows skeleton placeholders while sessions are loading", async ({ page }) => {
    // Delay the /sessions response so the loading state is visible
    let resolveSessions: (val: unknown) => void;
    const sessionsPromise = new Promise((r) => { resolveSessions = r; });

    await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
    await page.route("**/sessions", async (route: Route) => {
      await sessionsPromise;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_SESSIONS_LIST),
      });
    });
    // Need to mock other endpoints too so no errors
    await page.route("**/auth/status", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ oauth: true, authed: true, owner: true, user: { login: "testuser" } }) }));
    await page.route("**/providers**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
    await page.route("**/repos**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
    await page.route("**/account**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "u", login: "testuser", name: null, avatar_url: null, github_connected: true }, plan: { id: "free", name: "Free", byok: true, compute: "byoc" }, usage: { sessions: 1, billed_seconds: 0 }, compute: { byoc_provider: null } }) }));

    await page.goto("/");

    // Skeleton loaders should be visible while waiting
    await expect(page.locator(".atelier-skeleton")).toHaveCount(3);
    await expect(page.locator(".atelier-skeleton").first()).toBeVisible();

    // Release the response
    resolveSessions!(undefined);

    // After load, the session should appear
    await expect(page.locator(".session-card").first()).toBeVisible({ timeout: 10_000 });
    // Skeletons should be gone
    await expect(page.locator(".atelier-skeleton")).toHaveCount(0);
  });
});

test.describe("SessionView workspace shell", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("renders the workspace shell with topbar and state badge", async ({ page }) => {
    await navigateToSessionView(page);

    // Topbar
    await expect(page.locator(".ws-topbar")).toBeVisible();
    await expect(page.locator('[aria-label="Back to sessions list"]')).toBeVisible();
    // Task title (in the topbar h1)
    await expect(page.locator(".ws-topbar h1")).toContainText("Add JWT authentication middleware");

    // State chip for an active session: a .ws-state-dot inside a .ws-state-chip
    // whose text reads "<model> · <state>".
    const chip = page.locator(".ws-state-chip");
    await expect(chip).toBeVisible();
    await expect(chip.locator(".ws-state-dot")).toBeVisible();
    await expect(chip).toContainText("claude-sonnet-4-20250514 · running");
  });

  test("topbar overflow menu has finish and cancel actions for active session", async ({ page }) => {
    await navigateToSessionView(page);

    await page.locator('[aria-label="Session actions menu"]').click();
    await expect(page.locator('[aria-label="Finish session: commit, push and shut down"]')).toBeVisible();
    await expect(page.locator('[aria-label="Cancel session"]')).toBeVisible();
  });
});

test.describe("SessionView — terminal session", () => {
  test("terminal session shows end-of-session bar and new-workspace button POSTs /sessions", async ({ page }) => {
    await mockApi(page, TERMINAL_EVENTS);
    await navigateToSessionView(page);

    // The opencode frame is overlaid by the end-of-session bar.
    await expect(page.locator(".ws-opencode-ended")).toBeVisible();
    await expect(page.locator(".ws-endbar-text")).toContainText("This workspace has ended.");

    const cta = page.locator('[aria-label="New workspace on this repo"]');
    await expect(cta).toBeVisible();

    // Capture the POST /sessions body — it must reuse this session's repo/branch/provider/model.
    let createBody: Record<string, unknown> | null = null;
    await page.route("**/sessions", (route: Route) => {
      if (route.request().method() === "POST") {
        createBody = JSON.parse(route.request().postData() ?? "null");
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "sess-new999", state: "running" }) });
      } else {
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MOCK_SESSIONS_LIST) });
      }
    });

    await cta.click();

    // The new workspace reuses the original session's repo/branch/provider/model.
    await expect.poll(() => createBody).toMatchObject({
      repo_url: "https://github.com/acme/widget-factory.git",
      branch: "feature/auth",
      provider_id: "prov-1",
      model_id: "claude-sonnet-4-20250514",
    });
  });
});

test.describe("SessionView — mobile tabs", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("mobile tabs switch between Workspace and Browser", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByText("Add JWT authentication middleware").first()).toBeVisible({ timeout: 10_000 });
    await page.locator(".session-card").first().click();
    await expect(page.locator(".ws")).toBeVisible({ timeout: 10_000 });

    // Mobile tabs should be visible (.ws-mobile-tabs is itself the tablist).
    await expect(page.locator('.ws-mobile-tabs[role="tablist"]')).toBeVisible();

    const workspaceTab = page.locator(".ws-mobile-tab").filter({ hasText: "Workspace" });
    const browserTab = page.locator(".ws-mobile-tab").filter({ hasText: "Browser" });

    // Exactly two tabs; default is Workspace.
    await expect(page.locator(".ws-mobile-tab")).toHaveCount(2);
    await expect(workspaceTab).toHaveClass(/active/);

    // Workspace active → opencode pane visible.
    await expect(page.locator(".ws-opencode")).toHaveClass(/mobile-active/);

    // Switch to Browser → rail visible.
    await browserTab.click();
    await expect(page.locator(".ws-rail")).toHaveClass(/mobile-active/);

    // Back to Workspace → opencode pane visible again.
    await workspaceTab.click();
    await expect(page.locator(".ws-opencode")).toHaveClass(/mobile-active/);
  });
});

test.describe("SessionView — accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("workspace has correct ARIA roles and labels", async ({ page }) => {
    await navigateToSessionView(page);

    // Main application landmark
    await expect(page.locator('[role="application"][aria-label="Session workspace"]')).toBeVisible();

    // Banner (topbar)
    await expect(page.locator('[role="banner"]')).toBeVisible();

    // Mobile tablist
    await expect(page.locator('[role="tablist"][aria-label="Workspace panels"]')).toHaveCount(1);

    // opencode workspace region
    await expect(page.locator('[role="region"][aria-label="opencode workspace"]')).toBeVisible();

    // Right rail is a labelled aside (browser preview).
    await expect(page.locator('aside[aria-label="Browser preview"]')).toBeVisible();
  });
});

test.describe("SessionView — no unexpected console errors", () => {
  test("workspace loads without JS errors", async ({ page }) => {
    await mockApi(page);
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    await navigateToSessionView(page);
    await page.waitForTimeout(2000);

    // Filter out expected network errors
    const unexpected = errors.filter(
      (e) =>
        !e.includes("Failed to fetch") &&
        !e.includes("NetworkError") &&
        !e.includes("ERR_CONNECTION_REFUSED"),
    );
    expect(unexpected).toEqual([]);
  });
});
