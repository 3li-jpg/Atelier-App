import { test } from "node:test";
import assert from "node:assert/strict";
import { SANDBOX_TIERS, VPS_SIZES, getTier, getVpsSize, computeCostPerHour } from "./plans.ts";

test("plans catalog has exact values", () => {
  assert.equal(SANDBOX_TIERS.free.price, 0);
  assert.equal(SANDBOX_TIERS.free.included_hours, 0);
  assert.equal(SANDBOX_TIERS.free.overage_mode, "hard_cap");

  assert.equal(SANDBOX_TIERS.plus.price, 6);
  assert.equal(SANDBOX_TIERS.plus.included_hours, 20);
  assert.equal(SANDBOX_TIERS.plus.cpus, 1);
  assert.equal(SANDBOX_TIERS.plus.memory_mb, 2048);
  assert.equal(SANDBOX_TIERS.plus.overage_rate, 0.2);
  assert.equal(SANDBOX_TIERS.plus.overage_mode, "meter");

  assert.equal(SANDBOX_TIERS.pro.price, 10);
  assert.equal(SANDBOX_TIERS.pro.included_hours, 40);
  assert.equal(SANDBOX_TIERS.pro.cpus, 2);
  assert.equal(SANDBOX_TIERS.pro.memory_mb, 2048);
  assert.equal(SANDBOX_TIERS.pro.overage_rate, 0.2);
  assert.equal(SANDBOX_TIERS.pro.recommended, true);

  assert.equal(SANDBOX_TIERS.max.price, 25);
  assert.equal(SANDBOX_TIERS.max.included_hours, 140);
  assert.equal(SANDBOX_TIERS.max.cpus, 2);
  assert.equal(SANDBOX_TIERS.max.memory_mb, 4096);
  assert.equal(SANDBOX_TIERS.max.overage_rate, 0.25);

  assert.equal(VPS_SIZES.small.price, 10);
  assert.equal(VPS_SIZES.small.cpus, 2);
  assert.equal(VPS_SIZES.small.memory_mb, 4096);
  assert.equal(VPS_SIZES.small.disk_gb, 40);

  assert.equal(VPS_SIZES.medium.price, 20);
  assert.equal(VPS_SIZES.medium.cpus, 4);
  assert.equal(VPS_SIZES.medium.memory_mb, 8192);
  assert.equal(VPS_SIZES.medium.disk_gb, 80);
  assert.equal(VPS_SIZES.medium.recommended, true);

  assert.equal(VPS_SIZES.large.price, 40);
  assert.equal(VPS_SIZES.large.cpus, 8);
  assert.equal(VPS_SIZES.large.memory_mb, 16384);
  assert.equal(VPS_SIZES.large.disk_gb, 160);
});

test("getTier and getVpsSize helpers", () => {
  assert.equal(getTier("plus")?.title, "Plus");
  assert.equal(getTier("nope"), undefined);
  assert.equal(getVpsSize("medium")?.title, "Medium");
  assert.equal(getVpsSize("nope"), undefined);
});

test("computeCostPerHour matches expected safety margins", () => {
  // plus: 1 vCPU + 2 GB -> 0.0504 + 0.0324 = 0.0828
  assert.equal(computeCostPerHour(1, 2048), 0.0504 + 2 * 0.0162);
  // pro: 2 vCPU + 2 GB -> 0.1008 + 0.0324 = 0.1332
  assert.equal(computeCostPerHour(2, 2048), 2 * 0.0504 + 2 * 0.0162);
  // max: 2 vCPU + 4 GB -> 0.1008 + 0.0648 = 0.1656
  assert.equal(computeCostPerHour(2, 4096), 2 * 0.0504 + 4 * 0.0162);
});

test("every metered tier overage_rate exceeds compute cost per hour", () => {
  for (const tier of Object.values(SANDBOX_TIERS)) {
    if (tier.overage_mode !== "meter") continue;
    const cost = computeCostPerHour(tier.cpus, tier.memory_mb);
    assert.ok(
      tier.overage_rate > cost,
      `${tier.id}: overage ${tier.overage_rate} must exceed cost ${cost.toFixed(4)}`,
    );
  }
});
