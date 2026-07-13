import { test, expect, type Route } from "@playwright/test";

// ───────────────────────────────────────────────────────────────
// E2E: SessionView workspace — full three-panel IDE-lite experience.
//
// The SessionView is reached when the user clicks a session in SessionsList.
// It calls api.getSession(id) (REST) and useEventStream(id) (EventSource SSE).
//
// This suite mocks ALL backend endpoints via page.route() so no API server is
// needed. We cover:
//   - Skeleton loading states (SessionsList null → populated)
//   - Full workspace: file tree, timeline, diff panel, chat panel
//   - Every event type: assistant_text, tool_call, file_diff, question,
//     state_change, commit (and error / user_message)
//   - Interactive behaviors: file selection → diff, question reply chips,
//     composer send, state banner, PR status
//   - Mobile tab switching
//   - Accessibility roles & labels
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
// Each is a valid Event per packages/schema (ts, type, payload, seq).

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
  {
    seq: 1,
    ts: "2026-07-12T10:00:01Z",
    type: "state_change",
    payload: { state: "provisioning" },
  },
  {
    seq: 2,
    ts: "2026-07-12T10:00:05Z",
    type: "state_change",
    payload: { state: "running" },
  },
  {
    seq: 3,
    ts: "2026-07-12T10:00:10Z",
    type: "assistant_text",
    payload: { text: "I'll start by examining the existing middleware stack and then add JWT authentication." },
  },
  {
    seq: 4,
    ts: "2026-07-12T10:00:15Z",
    type: "tool_call",
    payload: {
      tool: "read_file",
      status: "done",
      exit_code: 0,
      duration: 2,
      summary: "Read src/middleware/index.ts (45 lines)",
    },
  },
  {
    seq: 5,
    ts: "2026-07-12T10:00:20Z",
    type: "file_diff",
    payload: {
      path: "src/middleware/auth.ts",
      content: "--- /dev/null\n+++ src/middleware/auth.ts\n@@ -0,0 +1,10 @@\n+import jwt from \"jsonwebtoken\";\n+\n+export function authMiddleware(req, res, next) {\n+  const token = req.headers.authorization?.replace(\"Bearer \", \"\");\n+  if (!token) return res.status(401).json({ error: \"No token\" });\n+  try {\n+    const decoded = jwt.verify(token, process.env.JWT_SECRET);\n+    req.user = decoded;\n+    next();\n+  } catch {\n+    res.status(401).json({ error: \"Invalid token\" });\n+  }\n+}",
    },
  },
  {
    seq: 6,
    ts: "2026-07-12T10:00:25Z",
    type: "file_diff",
    payload: {
      path: "src/middleware/index.ts",
      content: "--- src/middleware/index.ts\n+++ src/middleware/index.ts\n@@ -1,5 +1,8 @@\n import { Router } from \"express\";\n+import { authMiddleware } from \"./auth\";\n \n const router = Router();\n \n-router.get(\"/\", (req, res) => res.json({ ok: true }));\n+router.get(\"/\", authMiddleware, (req, res) => res.json({ ok: true }));\n \n export default router;",
    },
  },
  {
    seq: 7,
    ts: "2026-07-12T10:00:30Z",
    type: "tool_call",
    payload: {
      tool: "run_tests",
      status: "done",
      exit_code: 0,
      duration: 15,
      summary: "All 12 tests passed",
    },
  },
  {
    seq: 8,
    ts: "2026-07-12T10:00:35Z",
    type: "commit",
    payload: {
      sha: "a1b2c3d4e5f6789",
      message: "Add JWT authentication middleware",
      url: "https://github.com/acme/widget-factory/pull/42",
    },
  },
  {
    seq: 9,
    ts: "2026-07-12T10:00:40Z",
    type: "assistant_text",
    payload: { text: "I've added JWT authentication middleware and all tests pass. The PR is ready for review." },
  },
];

// Events with a question + awaiting_user state (separate stream scenario)
const QUESTION_EVENTS: MockEvent[] = [
  ...EVENTS.slice(0, 4),
  {
    seq: 10,
    ts: "2026-07-12T10:00:45Z",
    type: "question",
    payload: {
      prompt: "Should I also add token refresh logic?",
      options: ["Yes, add refresh", "No, keep it simple", "Let me decide later"],
    },
  },
  {
    seq: 11,
    ts: "2026-07-12T10:00:46Z",
    type: "state_change",
    payload: { state: "awaiting_user" },
  },
];

// ── Route handler helpers ───────────────────────────────────────

/** Intercept all API calls and respond with mock data. */
async function mockApi(page: import("@playwright/test").Page, events = EVENTS) {
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

  await page.route(`**/sessions/${MOCK_SESSION_ID}/reply`, (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.route(`**/sessions/${MOCK_SESSION_ID}/cancel`, (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.route(`**/sessions/${MOCK_SESSION_ID}/finish`, (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  // Auth / providers / repos — return harmless defaults
  await page.route("**/auth/status", (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ oauth: false, authed: true, owner: true, user: { login: "testuser" } }) });
  });
  await page.route("**/providers", (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });
  await page.route("**/repos**", (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
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

/** Navigate to the SessionView by loading the app, waiting for the sessions list,
 *  then clicking the mock session card. */
async function navigateToSessionView(page: import("@playwright/test").Page) {
  await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
  await page.goto("/");
  // Wait for sessions list to render with the mock session.
  // Use .first() because the task text also appears in commit events and PR status.
  await expect(page.locator(".session-card").first()).toBeVisible({ timeout: 10_000 });
  // Click the session card to enter SessionView
  await page.locator(".session-card").first().click();
  // The ide-shell should appear
  await expect(page.locator(".ide-shell")).toBeVisible({ timeout: 10_000 });
}

/** When file_diff events arrive, SessionView auto-selects the first file,
 *  which replaces the timeline with the diff panel. This helper clicks
 *  "Back to timeline" to deselect and reveal the timeline again. */
async function backToTimeline(page: import("@playwright/test").Page) {
  const backBtn = page.locator('[aria-label="Back to timeline"]');
  // Wait up to 5s for the diff panel to render and show the back button
  await backBtn.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await backBtn.isVisible().catch(() => false)) {
    await backBtn.click();
    // Wait for the timeline to reappear
    await page.locator(".ide-timeline").waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  }
}

// ── Tests ───────────────────────────────────────────────────────

test.describe("SessionsList skeleton loading", () => {
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
    await page.route("**/auth/status", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ oauth: false, authed: true, owner: true, user: { login: "testuser" } }) }));
    await page.route("**/providers", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));
    await page.route("**/repos**", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }));

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

test.describe("SessionView workspace — full experience", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("renders the three-panel IDE shell with topbar and state banner", async ({ page }) => {
    await navigateToSessionView(page);

    // Topbar
    await expect(page.locator(".ide-topbar")).toBeVisible();
    await expect(page.locator('[aria-label="Back to sessions list"]')).toBeVisible();
    // Task title (in the topbar h1)
    await expect(page.locator(".ide-topbar h1")).toContainText("Add JWT authentication middleware");

    // State banner shows "running"
    await expect(page.locator(".ide-statebar")).toBeVisible();
    await expect(page.locator(".ide-statebar")).toContainText("running");

    // Three panels exist (use IDs to avoid ambiguity with inner sections)
    await expect(page.locator("#panel-files")).toBeVisible();
    await expect(page.locator("#panel-diff")).toBeVisible();
    await expect(page.locator("#panel-chat")).toBeVisible();
  });

  test("topbar shows finish and cancel buttons for active session", async ({ page }) => {
    await navigateToSessionView(page);

    await expect(page.locator('[aria-label="Finish session: commit, push and shut down"]')).toBeVisible();
    await expect(page.locator('[aria-label="Cancel session"]')).toBeVisible();
    // Live dot
    await expect(page.locator(".live-dot")).toBeVisible();
  });

  test("file tree populates from file_diff events and shows changed files", async ({ page }) => {
    await navigateToSessionView(page);

    const filesPanel = page.locator("#panel-files");
    await expect(filesPanel).toBeVisible();

    // File tree header shows count
    await expect(filesPanel.locator(".ide-panel-header")).toContainText("Files");

    // Both files from file_diff events should appear as tree items
    const treeItems = filesPanel.locator('[role="treeitem"]');
    await expect(treeItems.filter({ hasText: "auth.ts" })).toBeVisible();
    await expect(treeItems.filter({ hasText: "index.ts" })).toBeVisible();

    // Directory "middleware" should be visible (auto-expanded)
    await expect(treeItems.filter({ hasText: "middleware" })).toBeVisible();
  });

  test("clicking a file in the file tree opens the diff panel", async ({ page }) => {
    await navigateToSessionView(page);

    const filesPanel = page.locator('[aria-label="Files panel"]');
    const treeItems = filesPanel.locator('[role="treeitem"]');

    // Click on auth.ts (file tree item)
    await treeItems.filter({ hasText: "auth.ts" }).click();

    // Diff panel should now show the file path
    await expect(page.locator(".ide-diff-path")).toContainText("auth.ts");

    // Diff content should show added lines (it's a new file: --- /dev/null)
    await expect(page.locator(".ide-diff-line.add").first()).toBeVisible();

    // Back button in diff panel
    await expect(page.locator('[aria-label="Back to timeline"]')).toBeVisible();
  });

  test("diff panel shows diff stats (additions/deletions)", async ({ page }) => {
    await navigateToSessionView(page);

    // Click index.ts which has both additions and deletions
    const filesPanel = page.locator('[aria-label="Files panel"]');
    const treeItems = filesPanel.locator('[role="treeitem"]');
    await treeItems.filter({ hasText: "index.ts" }).click();

    // Diff stats should be visible
    await expect(page.locator(".ide-diff-stats")).toBeVisible();
    await expect(page.locator(".ide-diff-stats .add")).toBeVisible();
    await expect(page.locator(".ide-diff-stats .del")).toBeVisible();
  });

  test("timeline panel shows events with correct labels", async ({ page }) => {
    await navigateToSessionView(page);

    // Wait for events to settle (SSE stream delivers all at once, causing re-renders)
    await page.waitForTimeout(1000);

    // File_diff events trigger auto-select of the first file, which replaces
    // the timeline with the diff panel. Click "Back to timeline" to reveal it.
    await backToTimeline(page);

    const middlePanel = page.locator('[aria-label="Timeline and diff panel"]');

    // Should show the Timeline heading
    await expect(middlePanel.getByText("Timeline")).toBeVisible({ timeout: 5_000 });

    // Event count should match the number of events we sent
    await expect(middlePanel.locator(".ide-panel-count")).toContainText(String(EVENTS.length));

    // Should contain tool_call labels
    await expect(middlePanel.getByText("read_file")).toBeVisible({ timeout: 5_000 });
    await expect(middlePanel.getByText("run_tests")).toBeVisible({ timeout: 5_000 });

    // Should contain commit label
    await expect(middlePanel.getByText(/commit a1b2c3d/)).toBeVisible({ timeout: 5_000 });
  });

  test("clicking a file_diff entry in the timeline opens the diff", async ({ page }) => {
    await navigateToSessionView(page);

    // Go back to timeline first (auto-select hides it)
    await backToTimeline(page);
    // Wait for the timeline to be visible
    await expect(page.locator(".ide-timeline")).toBeVisible({ timeout: 5_000 });

    // Click on the file_diff timeline entry for auth.ts.
    // Use force: true because the SSE stream causes re-renders that detach elements.
    const diffEntry = page.locator(".ide-timeline-text.clickable").filter({ hasText: "auth.ts" }).first();
    await expect(diffEntry).toBeVisible({ timeout: 5_000 });
    await diffEntry.click({ force: true });

    // Diff panel should show the file
    await expect(page.locator(".ide-diff-path")).toContainText("auth.ts");
  });

  test("chat panel renders assistant_text messages", async ({ page }) => {
    await navigateToSessionView(page);

    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');

    // First assistant message
    await expect(chatPanel.getByText("I'll start by examining the existing middleware stack")).toBeVisible();
    // Second assistant message
    await expect(chatPanel.getByText("I've added JWT authentication middleware and all tests pass")).toBeVisible();
  });

  test("chat panel renders tool_call events with status badges", async ({ page }) => {
    await navigateToSessionView(page);

    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');

    // Tool feed entries
    await expect(chatPanel.getByText("read_file")).toBeVisible();
    await expect(chatPanel.getByText("run_tests")).toBeVisible();

    // Both tools succeeded (exit code 0) — badge with "✓" and "ok" class
    const okBadges = chatPanel.locator(".badge.ok");
    await expect(okBadges.first()).toBeVisible();
  });

  test("chat panel renders commit events with SHA and message", async ({ page }) => {
    await navigateToSessionView(page);

    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');

    // Commit cell should be present with the SHA
    const commitCell = chatPanel.locator(".cell.commit");
    await expect(commitCell).toBeVisible();
    await expect(commitCell).toContainText(/a1b2c3d/);
    // Commit message
    await expect(commitCell).toContainText("Add JWT authentication middleware");
  });

  test("PR status bar appears with commit info and link", async ({ page }) => {
    await navigateToSessionView(page);

    const prStatus = page.locator(".ide-pr-status");
    await expect(prStatus).toBeVisible();

    // SHA
    await expect(prStatus.getByText(/a1b2c3d/)).toBeVisible();
    // Link to PR
    const prLink = prStatus.locator('a[href*="github.com"]');
    await expect(prLink).toBeVisible();
    await expect(prLink).toHaveAttribute("href", "https://github.com/acme/widget-factory/pull/42");
    // Commit count
    await expect(prStatus.getByText(/1 commit/)).toBeVisible();
  });

  test("chat panel renders file_diff events with expandable details", async ({ page }) => {
    await navigateToSessionView(page);

    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');

    // file_diff events render as DiffViewer with a path label.
    // Use .cell.diff to scope to the diff cells in chat.
    const diffCells = chatPanel.locator(".cell.diff");
    await expect(diffCells.first()).toBeVisible();
    // Both file paths should appear somewhere in the chat panel diff cells
    await expect(chatPanel.locator(".cell.diff").filter({ hasText: "auth.ts" })).toBeVisible();
    await expect(chatPanel.locator(".cell.diff").filter({ hasText: "index.ts" })).toBeVisible();
  });

  test("composer input is present and enabled for active session", async ({ page }) => {
    await navigateToSessionView(page);

    const composer = page.locator('[aria-label="Send a message"]');
    await expect(composer).toBeVisible();

    const input = composer.locator("input");
    await expect(input).toBeEnabled();
    await expect(input).toHaveAttribute("placeholder", "reply…");

    const sendBtn = composer.locator('button[type="submit"]');
    // Send button should be disabled when input is empty
    await expect(sendBtn).toBeDisabled();

    // Type a reply
    await input.fill("Looks good, thanks!");
    await expect(sendBtn).toBeEnabled();
  });

  test("sending a reply posts to /sessions/:id/reply and clears input", async ({ page }) => {
    await navigateToSessionView(page);

    const composer = page.locator('[aria-label="Send a message"]');
    const input = composer.locator("input");
    const sendBtn = composer.locator('button[type="submit"]');

    await input.fill("Ship it!");
    await sendBtn.click();

    // Input should be cleared after sending
    await expect(input).toHaveValue("");

    // The reply endpoint was already mocked; verify request was made
    // by checking that no error appeared
    await expect(page.locator(".ide-shell")).toBeVisible();
  });

  test("state banner updates from state_change events", async ({ page }) => {
    await navigateToSessionView(page);

    // The last state_change in EVENTS is "running" (seq 2)
    await expect(page.locator(".ide-statebar")).toContainText("running");
    // Repo label in state bar
    await expect(page.locator(".ide-statebar .meta")).toContainText("acme/widget-factory");
    await expect(page.locator(".ide-statebar .meta")).toContainText("feature/auth");
    await expect(page.locator(".ide-statebar .meta")).toContainText("claude-sonnet");
  });
});

test.describe("SessionView — question & awaiting_user state", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, QUESTION_EVENTS);
  });

  test("renders question event with quick-reply option chips", async ({ page }) => {
    await navigateToSessionView(page);

    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');

    // The question prompt should be visible
    await expect(chatPanel.getByText("Should I also add token refresh logic?")).toBeVisible();

    // Quick reply option chips
    await expect(chatPanel.getByRole("button", { name: "Reply: Yes, add refresh" })).toBeVisible();
    await expect(chatPanel.getByRole("button", { name: "Reply: No, keep it simple" })).toBeVisible();
    await expect(chatPanel.getByRole("button", { name: "Let me decide later" })).toBeVisible();
  });

  test("clicking a quick-reply chip calls the reply endpoint", async ({ page }) => {
    await navigateToSessionView(page);

    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');

    // Click the "Yes, add refresh" option
    const chip = chatPanel.getByRole("button", { name: "Reply: Yes, add refresh" });
    await chip.click();

    // After clicking, the question cell should show as "answered"
    await expect(chatPanel.locator(".cell.question.answered")).toBeVisible();
  });

  test("shows awaiting_user steering bar when state is awaiting_user", async ({ page }) => {
    await navigateToSessionView(page);

    // The steer bar should be visible
    await expect(page.locator('[aria-label="Awaiting your input"]')).toBeVisible();
    await expect(page.locator(".ide-steer-bar")).toBeVisible();

    // The steer bar has finish and cancel buttons
    await expect(page.locator(".ide-steer-bar").getByText("finish")).toBeVisible();
    await expect(page.locator(".ide-steer-bar").getByText("cancel")).toBeVisible();

    // State banner should show awaiting_user
    await expect(page.locator(".ide-statebar")).toContainText("awaiting_user");

    // Composer placeholder should change
    const input = page.locator('[aria-label="Send a message"] input');
    await expect(input).toHaveAttribute("placeholder", "reply or steer…");
  });

  test("composer input gets focused when session enters awaiting_user", async ({ page }) => {
    await navigateToSessionView(page);

    // The input should be focused
    const input = page.locator('[aria-label="Reply or steer the session"]');
    await expect(input).toBeFocused();
  });
});

test.describe("SessionView — empty states", () => {
  test("shows waiting message when no events arrive", async ({ page }) => {
    // Mock with empty event stream
    await mockApi(page, []);
    await navigateToSessionView(page);

    // Timeline should show "waiting for events…"
    const middlePanel = page.locator('[aria-label="Timeline and diff panel"]');
    await expect(middlePanel.getByText("waiting for events…")).toBeVisible();

    // Chat panel should also show "waiting for events…"
    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');
    await expect(chatPanel.getByText("waiting for events…")).toBeVisible();

    // File tree should show "No files changed yet"
    const filesPanel = page.locator('[aria-label="Files panel"]');
    await expect(filesPanel.getByText("No files changed yet")).toBeVisible();
  });
});

test.describe("SessionView — mobile tabs", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("mobile tabs switch between Files, Diff, and Chat panels", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByText("Add JWT authentication middleware")).toBeVisible({ timeout: 10_000 });
    await page.getByText("Add JWT authentication middleware").click();
    await expect(page.locator(".ide-shell")).toBeVisible({ timeout: 10_000 });

    // Mobile tabs should be visible
    await expect(page.locator('[role="tablist"]').first()).toBeVisible();

    // Default tab is "chat"
    const filesTab = page.locator("#tab-files");
    const diffTab = page.locator("#tab-diff");
    const chatTab = page.locator("#tab-chat");

    // Switch to Files tab
    await filesTab.click();
    await expect(page.locator("#panel-files")).toBeVisible();
    await expect(page.locator("#panel-files")).toHaveClass(/active/);

    // Switch to Diff tab
    await diffTab.click();
    await expect(page.locator("#panel-diff")).toBeVisible();
    await expect(page.locator("#panel-diff")).toHaveClass(/active/);

    // Switch to Chat tab
    await chatTab.click();
    await expect(page.locator("#panel-chat")).toBeVisible();
    await expect(page.locator("#panel-chat")).toHaveClass(/active/);
  });
});

test.describe("SessionView — accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("workspace has correct ARIA roles and labels", async ({ page }) => {
    await navigateToSessionView(page);

    // Wait for events to settle
    await page.waitForTimeout(1000);

    // Main application landmark
    await expect(page.locator('[role="application"][aria-label="Session workspace"]')).toBeVisible();

    // Banner (topbar)
    await expect(page.locator('[role="banner"]')).toBeVisible();

    // Tablist for mobile tabs (may be display:none on desktop, but should exist)
    await expect(page.locator('[role="tablist"][aria-label="Workspace panels"]')).toHaveCount(1);

    // File tree has role="tree"
    await expect(page.locator('[role="tree"]')).toBeVisible();

    // Chat messages have role="log"
    await expect(page.locator('[role="log"][aria-label="Chat messages"]')).toBeVisible();

    // Composer has role="search"
    await expect(page.locator('[role="search"][aria-label="Send a message"]')).toBeVisible();

    // Timeline has role="log" — only visible when no file is selected.
    // Go back to timeline to reveal it.
    await backToTimeline(page);
    await expect(page.locator('[role="log"][aria-labelledby="timeline-heading"]')).toBeVisible({ timeout: 5_000 });
  });

  test("file tree items have treeitem role with status labels", async ({ page }) => {
    await navigateToSessionView(page);

    // Tree items should have proper roles
    const treeItems = page.locator('[role="treeitem"]');
    await expect(treeItems.first()).toBeVisible();

    // File items should have aria-labels with status (added/modified)
    const authFile = page.locator('[role="treeitem"]').filter({ hasText: "auth.ts" });
    await expect(authFile).toHaveAttribute("aria-label", /added/);

    const indexFile = page.locator('[role="treeitem"]').filter({ hasText: "index.ts" });
    await expect(indexFile).toHaveAttribute("aria-label", /modified/);
  });

  test("tool call cells have descriptive aria-labels", async ({ page }) => {
    await navigateToSessionView(page);

    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');

    // Tool call cells should have aria-labels with tool name and status
    const toolCells = chatPanel.locator('[role="listitem"][aria-label*="Tool:"]');
    await expect(toolCells.first()).toBeVisible();
    await expect(toolCells.filter({ hasText: "read_file" })).toHaveAttribute("aria-label", /read_file/);
    await expect(toolCells.filter({ hasText: "run_tests" })).toHaveAttribute("aria-label", /succeeded/);
  });
});

test.describe("SessionView — error event", () => {
  test("renders error events with alert role", async ({ page }) => {
    const errorEvents: MockEvent[] = [
      ...EVENTS.slice(0, 3),
      {
        seq: 100,
        ts: "2026-07-12T10:00:20Z",
        type: "error",
        payload: { message: "Failed to connect to git remote" },
      },
    ];
    await mockApi(page, errorEvents);
    await navigateToSessionView(page);

    const chatPanel = page.locator('[aria-label="Chat and activity panel"]');
    await expect(chatPanel.getByText("Failed to connect to git remote")).toBeVisible();

    // Error cell should have role="alert"
    await expect(chatPanel.locator('[role="alert"]')).toBeVisible();
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
