import { test } from "node:test";
import assert from "node:assert/strict";
import { E2BProvider } from "./e2b.ts";

function fakeFetch(calls: { url: string; init: any }[]) {
  return async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ sandboxID: "sandbox-123", state: "running" }), { status: 200 });
  };
}

test("create sends correct config and lifecycle verbs hit right paths", async () => {
  const calls: { url: string; init: any }[] = [];
  const e2b = new E2BProvider("key", fakeFetch(calls) as typeof fetch);

  const ref = await e2b.create({ name: "s1", image: "atelier-runner:opencode-v1", env: { TASK: "x" }, cpus: 2 });
  assert.equal(ref.id, "sandbox-123");
  assert.equal(ref.provider, "e2b");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.image, "atelier-runner:opencode-v1");
  assert.equal(body.resources.cpus, 2);
  assert.equal(calls[0].init.headers.Authorization, "Bearer key");

  await e2b.suspend(ref);
  await e2b.resume(ref);
  await e2b.stop(ref);
  await e2b.destroy(ref);
  assert.ok(calls[1].url.endsWith("/sandboxes/sandbox-123/pause"));
  assert.ok(calls[2].url.endsWith("/sandboxes/sandbox-123/resume"));
  assert.ok(calls[3].url.endsWith("/sandboxes/sandbox-123/kill"));
  assert.ok(calls[4].url.endsWith("/sandboxes/sandbox-123"));
  assert.equal(await e2b.status(ref), "started");
});

test("listMachines maps the E2B list to MachineInfo", async () => {
  const e2b = new E2BProvider(
    "key",
    (async () => new Response(JSON.stringify([
      { sandboxID: "sb-a", state: "running", metadata: { atelier_session: "s1" } },
      { sandboxID: "sb-b", state: "killed", metadata: { atelier_session: "s2" } },
    ]), { status: 200 })) as typeof fetch,
  );
  const machines = await e2b.listMachines();
  assert.equal(machines.length, 2);
  assert.equal(machines[0].id, "sb-a");
  assert.equal(machines[0].provider, "e2b");
  assert.equal(machines[0].state, "started");
  assert.equal(machines[0].metadata.atelier_session, "s1");
  assert.equal(machines[1].state, "stopped");
});
