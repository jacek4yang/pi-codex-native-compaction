import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { configure } from "../src/config.js";
import { Diagnostics } from "../src/diagnostics.js";
import { Transaction } from "../src/transaction.js";
import { Collector } from "../src/codex-v2.js";
import { Scheduler } from "../src/scheduler.js";
import { NativeError } from "../src/errors.js";
import { snapshot, sender, response, events } from "./fixtures.js";
const cfg = configure({ maxRetries: 0, retryBaseDelayMs: 0 });
const fresh = () => new Transaction(cfg, new Diagnostics(cfg));
test("cancel during stream after compaction output: no proposal", async () => {
  const tx = fresh();
  const controller = new AbortController();
  const send = sender(
    async (_url, options) =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(
              new TextEncoder().encode(
                "data: " + JSON.stringify(events()[0]) + "\n\n",
              ),
            );
            options?.signal?.addEventListener(
              "abort",
              () => stream.error(new Error("AbortError")),
              { once: true },
            );
            setTimeout(() => controller.abort(), 5);
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  await assert.rejects(
    tx.run(snapshot(), send, () => "key", controller.signal),
  );
  assert.equal(tx.proposal, undefined);
});
test("delayed completion only creates proposal after terminal", async () => {
  const tx = fresh();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const send = sender(
    async () =>
      new Response(
        new ReadableStream({
          async start(stream) {
            stream.enqueue(
              new TextEncoder().encode(
                "data: " + JSON.stringify(events()[0]) + "\n\n",
              ),
            );
            await gate;
            stream.enqueue(
              new TextEncoder().encode(
                "data: " + JSON.stringify(events()[1]) + "\n\n",
              ),
            );
            stream.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const pending = tx.run(snapshot(), send, () => "key");
  await delay(5);
  assert.equal(tx.proposal, undefined);
  release();
  await pending;
  assert(tx.proposal);
});
test("session lifecycle cancels the in-flight request without an external signal", async () => {
  const tx = fresh();
  let started!: () => void;
  const start = new Promise<void>((r) => {
    started = r;
  });
  const send = sender(
    async (_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new Error("AbortError")),
          { once: true },
        );
        started();
      }),
  );
  const pending = tx.run(snapshot(), send, () => "key");
  await start;
  tx.cancel();
  await assert.rejects(pending);
  assert.equal(tx.proposal, undefined);
  assert.equal(tx.machine.phase, "IDLE");
});
test("malformed SSE JSON never commits", async () => {
  const tx = fresh();
  await assert.rejects(
    tx.run(
      snapshot(),
      sender(
        async () =>
          new Response("data: {broken\n\n", {
            headers: { "content-type": "text/event-stream" },
          }),
      ),
      () => "key",
    ),
  );
  assert.equal(tx.proposal, undefined);
});
test("response.done terminal equivalent", () => {
  const c = new Collector();
  c.observe(events()[0]);
  const e = events()[1] as Record<string, unknown>;
  c.observe({ ...e, type: "response.done" });
  assert(c.finish());
});
test("scheduler preserves soft headroom and latches deterministic failure", () => {
  const s = new Scheduler(cfg);
  assert(!s.due(74));
  assert(s.due(75));
  s.failed(new NativeError("transient", "network"), 0);
  assert(!s.due(80, 1));
  assert(s.due(80, 60001));
  s.failed(new NativeError("protocol", "400"), 60002);
  assert(!s.due(80, 999999999));
  s.success();
  assert(s.due(80, 999999999));
});
test("long Retry-After blocks manual and automatic requests until server cooldown", async () => {
  const c = configure({ retryBaseDelayMs: 0, retryMaxDelayMs: 100 });
  const tx = new Transaction(c, new Diagnostics(c));
  let calls = 0;
  await assert.rejects(
    tx.run(
      snapshot(),
      sender(async () => {
        calls++;
        return new Response("", {
          status: 429,
          headers: { "retry-after": "3600" },
        });
      }),
      () => "key",
    ),
  );
  assert.equal(calls, 1);
  assert.equal(tx.proposal, undefined);
  assert.equal(tx.machine.phase, "CIRCUIT_OPEN");
  await assert.rejects(
    tx.run(
      snapshot(),
      sender(async () => {
        calls++;
        return response();
      }),
      () => "key",
    ),
  );
  assert.equal(calls, 1);
  const s = new Scheduler(c);
  s.failed(new NativeError("transient", "limited", 429, 3600000), 0);
  assert(!s.due(80, 60001));
  assert(s.due(80, 3600001));
});
test("cancellation after validation prevents append", async () => {
  const tx = fresh();
  const c = new AbortController();
  await tx.run(
    snapshot(),
    sender(async () => response()),
    () => "key",
    c.signal,
  );
  tx.guard("key");
  c.abort();
  assert.throws(() => tx.guard("key"));
  tx.discard();
  assert.equal(tx.proposal, undefined);
});
test("1000 complete transaction generations with interruption and stale fault injection", async () => {
  for (let generation = 1; generation <= 1000; generation++) {
    const tx = fresh();
    const s = { ...snapshot(), generation };
    if (generation % 10 === 0) {
      await assert.rejects(
        tx.run(
          s,
          sender(async () => response()),
          () => "different",
        ),
      );
      assert.equal(tx.proposal, undefined);
    } else {
      const cp = await tx.run(
        s,
        sender(async () => response()),
        () => "key",
      );
      if (generation % 7 === 0) tx.discard();
      else tx.acknowledge(cp);
      assert.equal(tx.machine.phase, "IDLE");
      assert.equal(tx.proposal, undefined);
    }
  }
});
