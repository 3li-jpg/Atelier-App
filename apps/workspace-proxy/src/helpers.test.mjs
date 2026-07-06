import { test } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";
import { signCookie, verifyCookie, verifyAttachToken, parseCookies, pingDue } from "./helpers.mjs";

test("cookie round-trip", () => {
  const c = signCookie("ses-1", "s3cret");
  assert.equal(verifyCookie(c, "s3cret"), "ses-1");
  assert.equal(verifyCookie(c, "wrong"), null);
  assert.equal(verifyCookie("garbage", "s3cret"), null);
});

test("attach token verification matches control-plane format", () => {
  const payload = Buffer.from(JSON.stringify({ sid: "s1", uid: "u1", exp: Date.now() + 60000 })).toString("base64url");
  const sig = createHmac("sha256", "k").update(payload).digest("base64url");
  assert.deepEqual(verifyAttachToken(`${payload}.${sig}`, "k"), { sid: "s1", uid: "u1" });
  const stale = Buffer.from(JSON.stringify({ sid: "s1", uid: "u1", exp: Date.now() - 1 })).toString("base64url");
  const sig2 = createHmac("sha256", "k").update(stale).digest("base64url");
  assert.equal(verifyAttachToken(`${stale}.${sig2}`, "k"), null);
});

test("parseCookies", () => {
  assert.equal(parseCookies("a=1; atelier_ws=x.y; b=2").atelier_ws, "x.y");
  assert.deepEqual(parseCookies(undefined), {});
});

test("pingDue throttles per sid", () => {
  const last = new Map();
  assert.equal(pingDue(last, "s1", 1000), true);
  assert.equal(pingDue(last, "s1", 30_000), false);
  assert.equal(pingDue(last, "s1", 62_000), true);
});
