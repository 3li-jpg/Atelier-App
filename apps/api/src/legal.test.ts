process.env.NODE_ENV = "test";
process.env.MASTER_KEY = "test-master-key";
process.env.DB_PATH = ":memory:";

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "./store.ts";
import { LEGAL_DOCS, SUBPROCESSORS, getDocBody, currentVersion, requireAcceptances } from "./legal.ts";

test("LEGAL_DOCS has version + effective + file for every doc", () => {
  for (const [id, meta] of Object.entries(LEGAL_DOCS)) {
    assert.ok(meta.version, `${id} missing version`);
    assert.ok(meta.effective, `${id} missing effective`);
    assert.ok(meta.file, `${id} missing file`);
    assert.ok(meta.title, `${id} missing title`);
  }
});

test("getDocBody reads the markdown file", () => {
  const body = getDocBody("terms");
  assert.ok(body.length > 0);
  assert.ok(body.includes("Terms of Use"));
});

test("requireAcceptances returns missing docs for a fresh user", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  const missing = await requireAcceptances(store, uid, ["terms", "privacy"]);
  assert.equal(missing.length, 2);
  assert.ok(missing.find((m) => m.docId === "terms"));
  assert.ok(missing.find((m) => m.docId === "privacy"));
});

test("requireAcceptances is empty after accepting current versions", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", currentVersion("terms"), "127.0.0.1", "ua");
  await store.recordAcceptance(uid, "privacy", currentVersion("privacy"), "127.0.0.1", "ua");
  const missing = await requireAcceptances(store, uid, ["terms", "privacy"]);
  assert.equal(missing.length, 0);
});

test("requireAcceptances flags a version bump", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  // accepted an OLD version
  await store.recordAcceptance(uid, "terms", "0.9", "127.0.0.1", "ua");
  const missing = await requireAcceptances(store, uid, ["terms"]);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].version, currentVersion("terms"));
});

test("SUBPROCESSORS has the expected providers", () => {
  const names = SUBPROCESSORS.map((s) => s.name);
  for (const expected of ["Stripe", "Supabase", "GitHub", "Vercel"]) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
});

test("recordAcceptance + currentAcceptances round-trip", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "Mozilla");
  const acc = await store.currentAcceptances(uid);
  assert.equal(acc.terms, "1.0");
});

test("currentAcceptances returns latest version per doc", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "ua");
  await store.recordAcceptance(uid, "terms", "1.1", "127.0.0.1", "ua");
  const acc = await store.currentAcceptances(uid);
  assert.equal(acc.terms, "1.1");
});

test("deleteAcceptances clears a user's records", async () => {
  const store = new Store(":memory:");
  const uid = store.createEmailUser("a@b.co", "hashhashhash");
  await store.recordAcceptance(uid, "terms", "1.0", "127.0.0.1", "ua");
  await store.deleteAcceptances(uid);
  const acc = await store.currentAcceptances(uid);
  assert.equal(Object.keys(acc).length, 0);
});
