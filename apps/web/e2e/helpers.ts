import type { Page, Route } from "@playwright/test";

// ponytail: one shared mock installer so every spec gets the auth gate right.
// Add view-specific fixtures (sessions, providers list) via the options.
// Skipped a full mock-server abstraction — page.route is already the stdlib here.

export const AUTHED_USER = { login: "testuser@example.com" };

export const AUTHED_STATUS = {
  oauth: false,
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

/** Mark the browser as onboarded so App.tsx skips the Onboarding view. */
export async function markOnboarded(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("atelier:onboarded", "1");
  });
}

export type MockOptions = {
  /** /auth/status payload. Defaults to the authed owner. */
  auth?: object;
  /** /sessions GET body. Default: empty list. */
  sessions?: object;
  /** /providers GET body. Default: empty list. */
  providers?: object;
  /** /repos GET body. Default: empty list. */
  repos?: object;
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
  await page.route("**/sessions", (route: Route) => {
    if (route.request().method() === "GET") {
      route.fulfill(json(opts.sessions ?? []));
    } else {
      route.fulfill(json({ id: "sess-new", state: "queued" }));
    }
  });
  await page.route("**/providers", (route: Route) =>
    route.fulfill(json(opts.providers ?? [])),
  );
  await page.route("**/repos**", (route: Route) =>
    route.fulfill(json(opts.repos ?? [])),
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
