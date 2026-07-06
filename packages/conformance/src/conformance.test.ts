import { test } from "node:test";
import assert from "node:assert/strict";
import { runConformance, scoreToolCallFidelity, scoreEditReliability, scoreStreamingStability } from "./index.ts";

const provider = {
  base_url: "https://x.test/v1",
  headers: { "Content-Type": "application/json", Authorization: "Bearer k" },
};

function fakeFetch(opts: { toolCalls: number; editPass: boolean; streamOk: boolean }): typeof fetch {
  let toolCallSeen = 0;
  return (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    if (body.stream) {
      if (!opts.streamOk) return new Response("stream unavailable", { status: 500 });
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    if (body.tools) {
      toolCallSeen++;
      const makeCall = toolCallSeen <= opts.toolCalls;
      const message = makeCall
        ? { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "bash", arguments: "{\"command\":\"ls\"}" } }] }
        : { role: "assistant", content: "I cannot run that." };
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const content = opts.editPass
      ? "def sum_range(a, b):\n    total = 0\n    for i in range(a, b + 1):\n        total += i\n    return total"
      : "I cannot edit that.";
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("scoreToolCallFidelity returns the fraction of prompts that emit tool_calls", async () => {
  const score = await scoreToolCallFidelity(provider, "m", fakeFetch({ toolCalls: 6, editPass: true, streamOk: true }));
  assert.equal(score, 0.75);
});

test("scoreEditReliability passes when the fix substring is present", async () => {
  assert.equal(await scoreEditReliability(provider, "m", fakeFetch({ toolCalls: 8, editPass: true, streamOk: true })), true);
  assert.equal(await scoreEditReliability(provider, "m", fakeFetch({ toolCalls: 8, editPass: false, streamOk: true })), false);
});

test("scoreStreamingStability is stable when SSE chunks arrive and the stream completes", async () => {
  assert.equal(await scoreStreamingStability(provider, "m", fakeFetch({ toolCalls: 8, editPass: true, streamOk: true })), true);
});

test("runConformance passes when all dimensions meet the bar", async () => {
  const r = await runConformance("https://x.test/v1", "k", "m", fakeFetch({ toolCalls: 6, editPass: true, streamOk: true }));
  assert.equal(r.tool_call_fidelity, 0.75);
  assert.equal(r.edit_reliability, true);
  assert.equal(r.streaming_stable, true);
  assert.equal(r.pass, true);
  assert.deepEqual(r.quirks, {});
});

test("runConformance fails when tool_call_fidelity is below 0.5", async () => {
  const r = await runConformance("https://x.test/v1", "k", "m", fakeFetch({ toolCalls: 3, editPass: true, streamOk: true }));
  assert.equal(r.tool_call_fidelity, 0.375);
  assert.equal(r.pass, false);
});

test("runConformance records a quirk and fails when streaming errors", async () => {
  const r = await runConformance("https://x.test/v1", "k", "m", fakeFetch({ toolCalls: 8, editPass: true, streamOk: false }));
  assert.equal(r.streaming_stable, false);
  assert.equal(r.pass, false);
  assert.ok("streaming_error" in r.quirks);
});
