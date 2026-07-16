import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeApiError, parseBillingError } from "./humanize.ts";

test("parseBillingError extracts code, message and upgrade_url from 402 JSON", () => {
  const err = new Error('402 {"error":"Out of quota","code":"OUT_OF_QUOTA","upgrade_url":"https://up.example.com"}');
  const parsed = parseBillingError(err);
  assert.ok(parsed);
  assert.equal(parsed.message, "Out of quota");
  assert.equal(parsed.code, "OUT_OF_QUOTA");
  assert.equal(parsed.upgrade_url, "https://up.example.com");
});

test("parseBillingError returns null for non-402 errors", () => {
  const err = new Error('400 {"error":"bad request"}');
  assert.equal(parseBillingError(err), null);
});

test("parseBillingError returns null for malformed bodies", () => {
  const err = new Error('402 not-json');
  assert.equal(parseBillingError(err), null);
});

test("humanizeApiError falls back to generic message for 402", () => {
  const err = new Error('402 {"error":"Out of quota","code":"OUT_OF_QUOTA","upgrade_url":"https://up.example.com"}');
  const friendly = humanizeApiError(err);
  assert.equal(friendly.auth, false);
  assert.equal(friendly.message, "Something went wrong. Please try again.");
});
