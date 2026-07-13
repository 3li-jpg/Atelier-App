import type { Page, Route } from "@playwright/test";

// ponytail: one shared mock installer so every spec gets the auth gate right.
// Add view-specific fixtures (sessions, providers, account) via the options.
// Skipped a full mock-server abstraction — page.route is already the stdlib here.

export const AUTHED_USER = { login: "testuser@example.com" };

export const AUTHED_STATUS = {
  oauth: true,
  authed: true,
  owner: true,
  user: AUTHED_USER,
};

export const GUEST_STATUS = {
  oauth: false,
  authed: false,
  owner: false,
  user: null,
};

// Default /account payload — no BYOC compute configured, Free plan.
export const DEFAULT_ACCOUNT = {
  user: {
    id: "u-1",
    login: "testuser@example.com",
    name: "Test User",
    avatar_url: null,
    github_connected: true,
  },
  plan: { id: "free", name: "Free", byok: true, compute: "byoc" },
  usage: { sessions: 3, billed_seconds: 7200 },
  compute: { byoc_provider: null },
};

/** Mark the browser as onboarded so App.tsx skips the Onboarding view. */
export async function markOnboarded(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("atelier:onboarded", "1");
  });
}

export type MockOptions = {
  /** /auth/status payload. Defaults to the authed owner (oauth connected). */
  auth?: object;
  /** /sessions GET body. Default: empty list. */
  sessions?: object;
  /** /providers GET body. Default: empty list. */
  providers?: object;
  /** /repos GET body. Default: empty list. */
  repos?: object;
  /** /account GET body. Default: DEFAULT_ACCOUNT. */
  account?: object;
};

/**
 * Install the standard route mocks. Call after addInitScript, before goto.
 * Routes are unmocked by default to keep behavior obvious; add per-test
 * overrides with page.route() — later routes take precedence.
 */
export async function mockApi(page: Page, opts: MockOptions = {}) {
  await page.route("**/auth/status", (route: Route) =>
    route.fulfill(json(opts.auth ?? AUTHED_STATUS)),
  );
  await page.route("**/auth/logout", (route: Route) =>
    route.fulfill(json({ ok: true })),
  );
  await page.route("**/sessions", (route: Route) => {
    if (route.request().method() === "GET") {
      route.fulfill(json(opts.sessions ?? []));
    } else {
      route.fulfill(json({ id: "sess-new", state: "queued" }));
    }
  });
  // DELETE on a specific session (delete-workspace flow). 200 by default.
  // Non-DELETE (e.g. GET /sessions/:id detail) is left unmocked so tests that
  // rely on per-session route overrides or network pass-through aren't shadowed.
  await page.route("**/sessions/*", (route: Route) => {
    if (route.request().method() === "DELETE") route.fulfill(json({ ok: true }));
    else route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) });
  });
  await page.route("**/providers", (route: Route) =>
    route.fulfill(json(opts.providers ?? [])),
  );
  // PATCH/DELETE on a specific provider — record nothing by default, just 200.
  await page.route("**/providers/*", (route: Route) => {
    const m = route.request().method();
    if (m === "PATCH" || m === "DELETE") route.fulfill(json({ ok: true }));
    else route.fulfill(json(opts.providers ?? []));
  });
  await page.route("**/repos", (route: Route) =>
    route.fulfill(json(opts.repos ?? [])),
  );
  // Branch listing for a selected repo (Repos sheet).
  await page.route("**/repos/*/*/branches", (route: Route) =>
    route.fulfill(json([{ name: "main" }, { name: "develop" }])),
  );
  await page.route("**/account", (route: Route) =>
    route.fulfill(json(opts.account ?? DEFAULT_ACCOUNT)),
  );
  await page.route("**/account/compute", (route: Route) =>
    route.fulfill(json({ ok: true })),
  );
}

/** Mock /auth/login + /auth/signup to succeed and land the user on the dashboard. */
export async function mockSuccessfulLogin(page: Page) {
  await page.route("**/auth/login", (route: Route) =>
    route.fulfill(json({ ok: true, user: { login: "ali@studioatelier.ca" }, session_token: "tok-123" })),
  );
  await page.route("**/auth/signup", (route: Route) =>
    route.fulfill(json({ ok: true, user: { login: "ali@studioatelier.ca" }, session_token: "tok-123" })),
  );
}

function json(body: unknown) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(body) };
}
