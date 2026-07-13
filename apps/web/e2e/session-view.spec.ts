import { test, expect, type Route } from "@playwright/test";

// ───────────────────────────────────────────────────────────────
// E2E: chat-first SessionView workspace.
//
// The SessionView is reached when the user opens a session from the
// Workspaces list (or creates one from Repos). It calls api.getSession(id)
// (REST) and useEventStream(id) (EventSource SSE).
//
// Layout: .ws-topbar + .ws-body → .ws-center (ChatThread + Composer, with a
// center-stage diff overlay when a file is selected) and .ws-rail (Files /
// Todos / Activity panels). Mobile swaps via .ws-mobile-tabs.
//
// This suite mocks ALL backend endpoints via page.route() so no API server is
// needed. We cover:
//   - Workspaces list skeleton → populated → open session
//   - Chat thread: assistant_text, tool_call (collapsible), file_diff card,
//     commit bar, error alert, state chip
//   - Right rail: Files (from file_diff), Todos (from todo event), Activity
//     (from subagent event), tool count
//   - Composer: send → POST /sessions/:id/reply; awaiting_user focus
//   - Question/approval: option chips + approve/deny buttons
//   - Diff overlay: file select → DiffPanel, back
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
// "todo" and "subagent" are forward-compat types ChatThread reads via string
// widening (schema enum hasn't added them yet).

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

// Approval-style question (no options → Approve/Deny buttons).
const APPROVAL_EVENTS: MockEvent[] = [
  ...EVENTS.slice(0, 4),
  {
    seq: 10,
    ts: "2026-07-12T10:00:45Z",
    type: "question",
    payload: { prompt: "Run this shell command?", request_id: "req-7" },
  },
  {
    seq: 11,
    ts: "2026-07-12T10:00:46Z",
    type: "state_change",
    payload: { state: "awaiting_user" },
  },
];

// Events with a todo list + a subagent (forward-compat event types).
const TODO_SUBAGENT_EVENTS: MockEvent[] = [
  ...EVENTS.slice(0, 3),
  {
    seq: 20,
    ts: "2026-07-12T10:00:18Z",
    type: "todo",
    payload: {
      items: [
        { text: "Read middleware", done: true },
        { text: "Add JWT auth", done: false },
        { text: "Write tests", done: false },
      ],
    },
  },
  {
    seq: 21,
    ts: "2026-07-12T10:00:19Z",
    type: "subagent",
    payload: { status: "running", goal: "Audit auth helpers", summary: "scanning src/auth" },
  },
  ...EVENTS.slice(3),
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

  await page.route(`**/sessions/${MOCK_SESSION_ID}/reply`, (route: Route) => {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
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

/** When file_diff events arrive, SessionView auto-selects the first file,
 *  which opens the center-stage .ws-diff-overlay dialog. That overlay
 *  intercepts pointer events over the thread/composer, so dismiss it (click
 *  its back button) before interacting with anything underneath.
 *
 *  The SSE stream delivers file_diff events asynchronously after mount, so
 *  wait for the overlay to appear (or settle) before dismissing. */
async function dismissDiffOverlay(page: import("@playwright/test").Page) {
  const overlay = page.locator(".ws-diff-overlay");
  // Wait for the auto-select to open the overlay (file_diff events arrive via SSE).
  await overlay.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await overlay.isVisible().catch(() => false)) {
    await overlay.locator('[aria-label="Back to timeline"]').click();
    await expect(overlay).toHaveCount(0);
  }
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

test.describe("SessionView workspace — chat-first experience", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("renders the workspace shell with topbar and state chip", async ({ page }) => {
    await navigateToSessionView(page);

    // Topbar
    await expect(page.locator(".ws-topbar")).toBeVisible();
    await expect(page.locator('[aria-label="Back to sessions list"]')).toBeVisible();
    // Task title (in the topbar h1)
    await expect(page.locator(".ws-topbar h1")).toContainText("Add JWT authentication middleware");

    // Live dot for an active session
    await expect(page.locator(".ws-live-dot")).toBeVisible();

    // State chip in the composer statusline shows "running"
    await expect(page.locator(".ws-state-chip")).toBeVisible();
    await expect(page.locator(".ws-state-chip")).toHaveText("running");
  });

  test("topbar overflow menu has finish and cancel actions for active session", async ({ page }) => {
    await navigateToSessionView(page);

    await page.locator('[aria-label="Session actions menu"]').click();
    await expect(page.locator('[aria-label="Finish session: commit, push and shut down"]')).toBeVisible();
    await expect(page.locator('[aria-label="Cancel session"]')).toBeVisible();
  });

  test("chat thread renders assistant_text messages", async ({ page }) => {
    await navigateToSessionView(page);

    const thread = page.locator(".ws-thread");
    // First assistant message
    await expect(thread.getByText("I'll start by examining the existing middleware stack")).toBeVisible();
    // Second assistant message
    await expect(thread.getByText("I've added JWT authentication middleware and all tests pass")).toBeVisible();
  });

  test("tool_call renders a collapsible row that expands to show output", async ({ page }) => {
    await navigateToSessionView(page);

    // The auto-selected first file opens the diff overlay, which intercepts
    // pointer events over the thread — dismiss it first.
    await dismissDiffOverlay(page);

    const thread = page.locator(".ws-thread");

    // Both tool rows present.
    await expect(thread.locator(".ws-tool-name").filter({ hasText: "read_file" })).toBeVisible();
    await expect(thread.locator(".ws-tool-name").filter({ hasText: "run_tests" })).toBeVisible();

    // Collapsed by default (data-expanded=false).
    const readRow = thread.locator(".ws-tool").filter({ hasText: "read_file" });
    await expect(readRow).toHaveAttribute("data-expanded", "false");
    // No detail visible yet.
    await expect(readRow.locator(".ws-tool-detail")).toHaveCount(0);

    // Click the row header to expand — detail (summary) appears.
    await readRow.locator(".ws-tool-row").click();
    await expect(readRow.locator(".ws-tool-detail")).toBeVisible();
    await expect(readRow.locator(".ws-tool-detail")).toContainText("Read src/middleware/index.ts");

    // Click again collapses.
    await readRow.locator(".ws-tool-row").click();
    await expect(readRow.locator(".ws-tool-detail")).toHaveCount(0);
  });

  test("file_diff appears as a diff card in the thread and in the Files rail", async ({ page }) => {
    await navigateToSessionView(page);

    const thread = page.locator(".ws-thread");
    // Diff cards in the chat thread.
    await expect(thread.locator(".ws-diff-card").filter({ hasText: "auth.ts" })).toBeVisible();
    await expect(thread.locator(".ws-diff-card").filter({ hasText: "index.ts" })).toBeVisible();

    // Files rail lists both changed files.
    const rail = page.locator(".ws-rail");
    await expect(rail.locator(".ws-file-item").filter({ hasText: "auth.ts" })).toBeVisible();
    await expect(rail.locator(".ws-file-item").filter({ hasText: "index.ts" })).toBeVisible();
    // File count in the panel head.
    await expect(rail.locator(".ws-panel-count").first()).toHaveText("2");
  });

  test("commit event renders a PR bar with SHA and link", async ({ page }) => {
    await navigateToSessionView(page);

    const commitBar = page.locator(".ws-commit");
    await expect(commitBar).toBeVisible();
    await expect(commitBar).toContainText(/a1b2c3d/);
    await expect(commitBar).toContainText("Add JWT authentication middleware");
    const link = commitBar.locator('a[href*="github.com"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://github.com/acme/widget-factory/pull/42");
  });

  test("composer send posts to /sessions/:id/reply and clears input", async ({ page }) => {
    await navigateToSessionView(page);

    // Dismiss the auto-opened diff overlay so it doesn't intercept the send click.
    await dismissDiffOverlay(page);

    let replyBody: unknown = null;
    await page.route(`**/sessions/${MOCK_SESSION_ID}/reply`, (route) => {
      replyBody = JSON.parse(route.request().postData() ?? "null");
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const textarea = page.locator(".ws-textarea");
    const sendBtn = page.locator('.ws-send[type="submit"]');

    // Send disabled when empty.
    await expect(sendBtn).toBeDisabled();

    await textarea.fill("Ship it!");
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // Input cleared after sending.
    await expect(textarea).toHaveValue("");
    await expect.poll(() => replyBody).toEqual({ text: "Ship it!" });
  });

  test("state chip updates from state_change events and shows repo/model meta", async ({ page }) => {
    await navigateToSessionView(page);

    // The last state_change in EVENTS is "running" (seq 2)
    await expect(page.locator(".ws-state-chip")).toHaveText("running");
    // Statusline carries model + repo/branch.
    const statusline = page.locator(".ws-statusline");
    await expect(statusline).toContainText("claude-sonnet");
    await expect(statusline).toContainText("acme/widget-factory");
    await expect(statusline).toContainText("feature/auth");
  });
});

test.describe("SessionView — question & approval", () => {
  test("renders question event with quick-reply option chips", async ({ page }) => {
    await mockApi(page, QUESTION_EVENTS);
    await navigateToSessionView(page);

    const thread = page.locator(".ws-thread");
    await expect(thread.getByText("Should I also add token refresh logic?")).toBeVisible();

    // Quick reply option chips.
    await expect(thread.getByRole("button", { name: "Reply: Yes, add refresh" })).toBeVisible();
    await expect(thread.getByRole("button", { name: "Reply: No, keep it simple" })).toBeVisible();
    await expect(thread.getByRole("button", { name: "Let me decide later" })).toBeVisible();
  });

  test("clicking a quick-reply chip calls the reply endpoint", async ({ page }) => {
    await mockApi(page, QUESTION_EVENTS);
    await navigateToSessionView(page);

    let replyText = "";
    await page.route(`**/sessions/${MOCK_SESSION_ID}/reply`, (route) => {
      replyText = JSON.parse(route.request().postData() ?? "{}").text ?? "";
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    const chip = page.locator(".ws-thread").getByRole("button", { name: "Reply: Yes, add refresh" });
    await chip.click();

    // After clicking, the question cell shows as "answered".
    await expect(page.locator(".ws-question.answered")).toBeVisible();
    await expect.poll(() => replyText).toBe("Yes, add refresh");
  });

  test("approval question renders actionable Approve/Deny buttons", async ({ page }) => {
    await mockApi(page, APPROVAL_EVENTS);
    await navigateToSessionView(page);

    const thread = page.locator(".ws-thread");
    await expect(thread.getByText("Run this shell command?")).toBeVisible();

    const approve = thread.getByRole("button", { name: "Approve" });
    const deny = thread.getByRole("button", { name: "Deny" });
    await expect(approve).toBeVisible();
    await expect(deny).toBeVisible();

    let replyText = "";
    await page.route(`**/sessions/${MOCK_SESSION_ID}/reply`, (route) => {
      replyText = JSON.parse(route.request().postData() ?? "{}").text ?? "";
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await approve.click();
    await expect.poll(() => replyText).toBe("req-7:approve");
  });

  test("shows awaiting_user state and focuses the composer", async ({ page }) => {
    await mockApi(page, QUESTION_EVENTS);
    await navigateToSessionView(page);

    // State chip shows awaiting_user.
    await expect(page.locator(".ws-state-chip")).toHaveText("awaiting_user");

    // Composer placeholder changes and input is focused.
    const textarea = page.locator(".ws-textarea");
    await expect(textarea).toHaveAttribute("placeholder", "reply or steer…");
    await expect(textarea).toBeFocused();
  });
});

test.describe("SessionView — todos & subagents (right rail)", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, TODO_SUBAGENT_EVENTS);
  });

  test("todo event fills the Todos panel", async ({ page }) => {
    await navigateToSessionView(page);

    const rail = page.locator(".ws-rail");
    const todosPanel = rail.locator(".ws-panel").filter({ hasText: "Todos" });

    // Three todo items, one done.
    await expect(todosPanel.locator(".ws-todo-item")).toHaveCount(3);
    await expect(todosPanel.locator(".ws-todo-item.done")).toHaveCount(1);
    await expect(todosPanel.locator(".ws-todo-text").filter({ hasText: "Add JWT auth" })).toBeVisible();
    // Count badge.
    await expect(todosPanel.locator(".ws-panel-count")).toHaveText("3");
  });

  test("subagent event appears in the Activity panel", async ({ page }) => {
    await navigateToSessionView(page);

    const rail = page.locator(".ws-rail");
    const activityPanel = rail.locator(".ws-panel").filter({ hasText: "Activity" });

    await expect(activityPanel.locator(".ws-subagent")).toBeVisible();
    await expect(activityPanel.locator(".ws-subagent-goal")).toHaveText("Audit auth helpers");
    await expect(activityPanel.locator(".ws-subagent-status")).toContainText("running");
    await expect(activityPanel.locator(".ws-subagent-summary")).toContainText("scanning src/auth");

    // Tool call count in the activity footer (read_file + run_tests = 2).
    await expect(activityPanel.locator(".ws-activity-tools")).toContainText("2 tool calls");
  });
});

test.describe("SessionView — diff overlay", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("clicking a file in the Files rail opens the diff overlay", async ({ page }) => {
    await navigateToSessionView(page);

    const rail = page.locator(".ws-rail");
    // index.ts has both additions and deletions.
    await rail.locator(".ws-file-item").filter({ hasText: "index.ts" }).click();

    // Diff overlay appears with the file path.
    const overlay = page.locator(".ws-diff-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay.locator(".ide-diff-path")).toContainText("index.ts");

    // Diff stats (additions + deletions) visible.
    await expect(overlay.locator(".ide-diff-stats")).toBeVisible();
    await expect(overlay.locator(".ide-diff-stats .add")).toBeVisible();
    await expect(overlay.locator(".ide-diff-stats .del")).toBeVisible();

    // Added diff lines render.
    await expect(overlay.locator(".ide-diff-line.add").first()).toBeVisible();
  });

  test("diff overlay back button closes it", async ({ page }) => {
    await navigateToSessionView(page);

    const rail = page.locator(".ws-rail");
    await rail.locator(".ws-file-item").filter({ hasText: "auth.ts" }).click();
    const overlay = page.locator(".ws-diff-overlay");
    await expect(overlay).toBeVisible();

    await overlay.locator('[aria-label="Back to timeline"]').click();
    await expect(overlay).toHaveCount(0);
  });
});

test.describe("SessionView — empty states", () => {
  test("shows welcome prompt when no events arrive", async ({ page }) => {
    await mockApi(page, []);
    await navigateToSessionView(page);

    // Empty thread renders the welcome card.
    await expect(page.locator(".ws-welcome")).toBeVisible();
    await expect(page.getByRole("heading", { name: "What should we build?" })).toBeVisible();
    // Welcome prompt buttons send a reply.
    await expect(page.getByRole("button", { name: /Start with:/ })).toHaveCount(3);

    // Files rail shows the empty row.
    await expect(page.locator(".ws-rail")).toContainText("No files changed yet");
    // Todos + Activity empty rows.
    await expect(page.locator(".ws-rail")).toContainText("No todos yet");
    await expect(page.locator(".ws-rail")).toContainText("No subagents active");
  });
});

test.describe("SessionView — mobile tabs", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page);
  });

  test("mobile tabs switch between Chat, Files, and Activity", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("atelier:onboarded", "1"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByText("Add JWT authentication middleware").first()).toBeVisible({ timeout: 10_000 });
    await page.locator(".session-card").first().click();
    await expect(page.locator(".ws")).toBeVisible({ timeout: 10_000 });

    // Mobile tabs should be visible (.ws-mobile-tabs is itself the tablist).
    await expect(page.locator('.ws-mobile-tabs[role="tablist"]')).toBeVisible();

    const chatTab = page.locator(".ws-mobile-tab").filter({ hasText: "Chat" });
    const filesTab = page.locator(".ws-mobile-tab").filter({ hasText: "Files" });
    const activityTab = page.locator(".ws-mobile-tab").filter({ hasText: "Activity" });

    // Default tab is chat.
    await expect(chatTab).toHaveClass(/active/);

    // Switch to Files → center hidden, rail visible.
    await filesTab.click();
    await expect(page.locator(".ws-rail")).toHaveClass(/mobile-active/);

    // Switch to Activity → still rail.
    await activityTab.click();
    await expect(page.locator(".ws-rail")).toHaveClass(/mobile-active/);

    // Back to Chat → center visible.
    await chatTab.click();
    await expect(page.locator(".ws-center")).toHaveClass(/mobile-active/);
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

    // Mobile tablist (may be display:none on desktop, but should exist).
    await expect(page.locator('[role="tablist"][aria-label="Workspace panels"]')).toHaveCount(1);

    // Chat thread has role="log".
    await expect(page.locator('[role="log"][aria-label="Conversation"]')).toBeVisible();

    // Composer form has aria-label "Send a message".
    await expect(page.locator('[role="search"][aria-label="Send a message"], form[aria-label="Send a message"]')).toHaveCount(1);

    // Right rail is a labelled aside.
    await expect(page.locator('aside[aria-label="Workspace side panel"]')).toBeVisible();
  });

  test("file items have aria-labels with status (added/modified)", async ({ page }) => {
    await navigateToSessionView(page);

    const rail = page.locator(".ws-rail");
    // auth.ts is a new file (--- /dev/null) → added.
    await expect(rail.locator(".ws-file-item").filter({ hasText: "auth.ts" })).toHaveAttribute("aria-label", /added/);
    // index.ts has both + and - → modified.
    await expect(rail.locator(".ws-file-item").filter({ hasText: "index.ts" })).toHaveAttribute("aria-label", /modified/);
  });

  test("tool rows have descriptive aria-labels", async ({ page }) => {
    await navigateToSessionView(page);

    const thread = page.locator(".ws-thread");
    const readRow = thread.locator(".ws-tool").filter({ hasText: "read_file" });
    await expect(readRow.locator(".ws-tool-row")).toHaveAttribute("aria-label", /read_file/);
    await expect(readRow.locator(".ws-tool-row")).toHaveAttribute("aria-label", /ok/);

    const testsRow = thread.locator(".ws-tool").filter({ hasText: "run_tests" });
    await expect(testsRow.locator(".ws-tool-row")).toHaveAttribute("aria-label", /run_tests/);
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

    const thread = page.locator(".ws-thread");
    await expect(thread.getByText("Failed to connect to git remote")).toBeVisible();

    // Error cell should have role="alert"
    await expect(thread.locator('[role="alert"]')).toBeVisible();
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
