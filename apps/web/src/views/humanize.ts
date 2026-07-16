// Humanize raw API errors before they reach the UI.
// api.ts throws `new Error(`${status} ${body}`)`, so String(e) leaks strings like
// `401 {"error":"unauthorized"}` or `500 Internal Server Error`. We never want
// status codes, JSON, or stack traces shown to users.
//
// Onboarding imports this via "../views/humanize.ts".

export type FriendlyError = {
  /** user-visible line */
  message: string;
  /** true when the cause is an auth problem (401/403) — caller may hide/reauth */
  auth: boolean;
};

const AUTH_MESSAGES = new Set([
  "401", "403",
]);

// ponytail: a regex + small map beats a full error-class hierarchy. If the API
// later returns structured error codes, switch on a `code` field instead.
export function humanizeApiError(e: unknown): FriendlyError {
  const raw = e instanceof Error ? e.message : String(e);
  // api.ts format: "<status> <body>". Status is the leading 3 digits.
  const status = /^(\d{3})\b/.exec(raw)?.[1] ?? "";

  if (AUTH_MESSAGES.has(status)) {
    return { message: "You're signed out — log in to view this.", auth: true };
  }
  if (status === "404") {
    return { message: "We couldn't find that. It may have been removed.", auth: false };
  }
  if (status === "429") {
    return { message: "Too many requests — wait a moment and try again.", auth: false };
  }
  if (status >= "500" && status <= "599") {
    return { message: "The server hit a problem. Try again in a moment.", auth: false };
  }

  // Network / CORS / aborted fetch — no status code, usually TypeError.
  if (
    !status &&
    (/network|failed to fetch|load failed|networkerror|abort/i.test(raw) ||
      e instanceof TypeError)
  ) {
    return { message: "Couldn't reach the server.", auth: false };
  }

  // Fallback: strip any leading "NNN " status + scrub JSON-ish fragments so
  // nothing structured leaks. Keep it generic rather than surfacing server text.
  return { message: "Something went wrong. Please try again.", auth: false };
}

/** Convenience for the common inline toast pattern: `humanizeToast(e)`. */
export function humanizeToast(e: unknown): string {
  return humanizeApiError(e).message;
}

export type BillingError = {
  message: string;
  code: "OUT_OF_QUOTA" | "PLAN_REQUIRED" | string;
  upgrade_url: string | null;
};

/**
 * Parse a 402 Payment Required response from the API.
 * Returns null when the error is not a structured billing error.
 */
export function parseBillingError(e: unknown): BillingError | null {
  const raw = e instanceof Error ? e.message : String(e);
  const status = /^(\d{3})\b/.exec(raw)?.[1] ?? "";
  if (status !== "402") return null;

  const body = raw.replace(/^\d{3}\s*/, "").trim();
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.error !== "string") return null;
    return {
      message: parsed.error,
      code: typeof parsed.code === "string" ? parsed.code : "",
      upgrade_url: typeof parsed.upgrade_url === "string" ? parsed.upgrade_url : null,
    };
  } catch {
    return null;
  }
}
