import { test } from "node:test";
import assert from "node:assert/strict";
import { DaytonaProvider } from "./daytona.ts";

function fakeFetch(calls: { url: string; init: any }[]) {
  return async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "sandbox-123", state: "started" }), { status: 200 });
  };
}

test("create sends correct config and lifecycle verbs hit right paths", async () => {
  const calls: { url: string; init: any }[] = [];
  const daytona = new DaytonaProvider("key", "ws-1", fakeFetch(calls) as typeof fetch);

  const ref = await daytona.create({ name: "s1", image: "atelier-runner:hermes-v1", env: { TASK: "x" }, cpus: 2 });
  assert.equal(ref.id, "sandbox-123");
  assert.equal(ref.provider, "daytona");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.image, "atelier-runner:hermes-v1");
  assert.equal(body.resources.cpus, 2);
  assert.equal(calls[0].init.headers.Authorization, "Bearer key");

  await daytona.suspend(ref);
  await daytona.resume(ref);
  await daytona.stop(ref);
  await daytona.destroy(ref);
  assert.ok(calls[1].url.endsWith("/sandbox-123/suspend"));
  assert.ok(calls[2].url.endsWith("/sandbox-123/start"));
  assert.ok(calls[3].url.endsWith("/sandbox-123/stop"));
  assert.ok(calls[4].url.endsWith("/sandbox-123?force=true"));
  assert.equal(await daytona.status(ref), "started");
});

test("listMachines maps the Daytona list to MachineInfo", async () => {
  const daytona = new DaytonaProvider(
    "key", "ws-1",
    (async () => new Response(JSON.stringify([
      { id: "sb-a", state: "started", metadata: { atelier_session: "s1" } },
      { id: "sb-b", state: "destroyed", metadata: { atelier_session: "s2" } },
    ]), { status: 200 })) as typeof fetch,
  );
  const machines = await daytona.listMachines();
  assert.equal(machines.length, 2);
  assert.equal(machines[0].id, "sb-a");
  assert.equal(machines[0].provider, "daytona");
  assert.equal(machines[0].state, "started");
  assert.equal(machines[0].metadata.atelier_session, "s1");
  assert.equal(machines[1].state, "destroyed");
});
