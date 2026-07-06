import { test } from "node:test";
import assert from "node:assert";
import { canTransition } from "./index.ts";

test("graceful finish is legal from interactive states", () => {
  assert.equal(canTransition("awaiting_user", "finalizing"), true);
  assert.equal(canTransition("hibernated", "finalizing"), true);
});
