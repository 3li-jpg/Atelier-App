import { test } from "node:test";
import assert from "node:assert/strict";
import { FlyMachinesProvider } from "./fly.ts";

function fakeFetch(calls: { url: string; init: any }[]) {
  return async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "m-123", state: "started" }), { status: 200 });
  };
}

test("create sends correct machine config and lifecycle verbs hit right paths", async () => {
  const calls: { url: string; init: any }[] = [];
  const fly = new FlyMachinesProvider("atelier-sandboxes", "tok", fakeFetch(calls) as typeof fetch);

  const ref = await fly.create({ name: "s1", image: "registry.fly.io/atelier-sandboxes:runner-v0", env: { TASK: "x" } });
  assert.equal(ref.id, "m-123");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.config.guest.cpus, 2);
  assert.equal(body.config.auto_destroy, true);
  assert.equal(calls[0].init.headers.Authorization, "Bearer tok");

  await fly.suspend(ref);
  await fly.resume(ref);
  await fly.stop(ref);
  await fly.destroy(ref);
  assert.ok(calls[1].url.endsWith("/m-123/suspend"));
  assert.ok(calls[2].url.endsWith("/m-123/start"));
  assert.ok(calls[3].url.endsWith("/m-123/stop"));
  assert.ok(calls[4].url.endsWith("/m-123?force=true"));
  assert.equal(await fly.status(ref), "started");
});
