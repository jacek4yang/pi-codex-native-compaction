import test from "node:test";
import assert from "node:assert/strict";
import { configure } from "../src/config.js";
import { StateMachine } from "../src/state-machine.js";
import { Diagnostics, redact } from "../src/diagnostics.js";
import { Transaction } from "../src/transaction.js";
import { Collector } from "../src/codex-v2.js";
import { NativeError } from "../src/errors.js";
import { identity, seal, validateCheckpoint } from "../src/checkpoint.js";
import { marker, replay, retained } from "../src/replay.js";
import { retryAfter, backoff, Circuit } from "../src/retry.js";
import {
  compactItem,
  events,
  model,
  response,
  sender,
  snapshot,
} from "./fixtures.js";
const cfg = configure({ retryBaseDelayMs: 0, retryMaxDelayMs: 100 });
const fresh = () => new Transaction(cfg, new Diagnostics(cfg));
test("configuration guards", () => {
  for (const c of [
    { maxRetries: 99 },
    { softThresholdRatio: 0.9 },
    { mode: "fallback" },
    { x: 1 },
  ])
    assert.throws(() => configure(c));
});
test("illegal state transitions detected", () => {
  const m = new StateMachine();
  assert.throws(() => m.move("COMMITTING"));
});
test("retry-after dates/seconds and capped jitter", () => {
  assert.equal(retryAfter("2"), 2000);
  assert.equal(retryAfter(new Date(2000).toUTCString(), 1000), 1000);
  assert.throws(() => backoff(cfg, 0, 200));
});
test("recursive redaction including strings", () => {
  const value = JSON.stringify(
    redact({
      Authorization: "abc",
      nested: { refresh_token: "abc", password: "abc" },
      text: "Bearer abc sk-foobar",
    }),
  );
  assert(!value.includes("abc"));
});
test("circuit opens only for transients and resets", () => {
  const c = new Circuit(cfg);
  for (let i = 0; i < 3; i++) c.fail(new NativeError("transient", "x"), 1);
  assert.throws(() => c.assertAvailable(2));
  c.success();
  c.assertAvailable(2);
});
for (const status of [400, 401, 403, 408, 429, 500, 502, 503, 504])
  test("HTTP " + status + " cannot commit", async () => {
    const tx = fresh();
    let calls = 0;
    await assert.rejects(
      tx.run(
        snapshot(),
        sender(async () => {
          calls++;
          return new Response('{"error":{"message":"rejected"}}', {
            status,
            headers: { "retry-after": "0" },
          });
        }),
        () => "key",
      ),
    );
    assert.equal(tx.proposal, undefined);
    assert.equal(calls, [400, 401, 403].includes(status) ? 1 : 3);
  });
for (const failure of [
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "TLS transport interruption",
  "timeout",
  "socket closed",
  "terminated",
  "UND_ERR_BODY_TIMEOUT",
])
  test(failure + " preserves old context", async () => {
    const tx = fresh();
    let calls = 0;
    await assert.rejects(
      tx.run(
        snapshot(),
        sender(async () => {
          calls++;
          throw new Error(failure);
        }),
        () => "key",
      ),
    );
    assert.equal(tx.proposal, undefined);
    assert.equal(calls, 3);
  });
for (const [name, data] of [
  ["EOF", []],
  ["item then EOF", events().slice(0, 1)],
  ["zero items", events([])],
  ["duplicate items", events([compactItem, compactItem])],
  ["empty encrypted", events([{ ...compactItem, encrypted_content: "" }])],
  ["malformed encrypted", events([{ ...compactItem, encrypted_content: 9 }])],
  ["malformed event", [{}]],
  [
    "incomplete",
    [
      {
        type: "response.incomplete",
        response: { id: "r", status: "incomplete" },
      },
    ],
  ],
] as const)
  test(name + " does not commit", async () => {
    const tx = fresh();
    await assert.rejects(
      tx.run(
        snapshot(),
        sender(async () => response([...data])),
        () => "key",
      ),
    );
    assert.equal(tx.proposal, undefined);
  });
test("stalled response body has an end-to-end deadline and bounded retries", async () => {
  const c = configure({
    requestTimeoutMs: 30,
    maxRetries: 1,
    retryBaseDelayMs: 0,
  });
  const tx = new Transaction(c, new Diagnostics(c));
  let calls = 0;
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  try {
    await assert.rejects(
      tx.run(
        snapshot(),
        sender(async () => {
          calls++;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controllers.push(controller);
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"response.created","response":{"id":"resp_stalled","status":"in_progress"}}\n\n',
                  ),
                );
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }),
        () => "key",
      ),
      /deadline exceeded/,
    );
    assert.equal(calls, 2);
    assert.equal(tx.lastFailure?.kind, "transient");
    assert.equal(tx.proposal, undefined);
  } finally {
    for (const c of controllers) {
      try {
        c.close();
      } catch {
        /* stream already aborted */
      }
    }
  }
});
test("duplicate completion collector rejects", () => {
  const c = new Collector();
  for (const e of [...events(), events().at(-1)]) c.observe(e);
  assert.throws(() => c.finish());
});
test("pre-aborted request does not commit", async () => {
  const tx = fresh();
  await assert.rejects(
    tx.run(
      snapshot(),
      sender(async () => response()),
      () => "key",
      AbortSignal.abort(),
    ),
  );
  assert.equal(tx.proposal, undefined);
});
test("success after transient retry, commit exactly once", async () => {
  const tx = fresh();
  let calls = 0;
  const cp = await tx.run(
    snapshot(),
    sender(async () =>
      ++calls === 1 ? new Response("", { status: 503 }) : response(),
    ),
    () => "key",
  );
  assert.equal(calls, 2);
  assert.equal(tx.machine.phase, "COMMITTING");
  tx.acknowledge(cp);
  tx.acknowledge(cp);
  assert.equal(tx.machine.phase, "IDLE");
});
test("stale remote response rejected", async () => {
  const tx = fresh();
  await assert.rejects(
    tx.run(
      snapshot(),
      sender(async () => response()),
      () => "changed",
    ),
  );
  assert.equal(tx.proposal, undefined);
});
test("concurrent manual/automatic requests cannot double commit", async () => {
  const tx = fresh();
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  const a = tx.run(
    snapshot(),
    sender(async () => {
      calls++;
      await wait;
      return response();
    }),
    () => "key",
  );
  await assert.rejects(
    tx.run(
      snapshot(),
      sender(async () => response()),
      () => "key",
    ),
  );
  release();
  const cp = await a;
  assert.equal(calls, 1);
  tx.acknowledge(cp);
});
test("checkpoint corruption and identity rejection", async () => {
  const tx = fresh();
  const cp = await tx.run(
    snapshot(),
    sender(async () => response()),
    () => "key",
  );
  validateCheckpoint(
    JSON.parse(JSON.stringify(cp)),
    identity(model),
    "session",
  );
  assert.throws(() => validateCheckpoint({ ...cp, responseId: "wrong" }));
  for (const key of ["provider", "api", "model", "baseUrl"] as const)
    assert.throws(() =>
      validateCheckpoint(cp, { ...identity(model), [key]: "wrong" }),
    );
  assert.throws(() => validateCheckpoint(cp, identity(model), "fork"));
});
test("exact replay, restart and 100 repeated generations", async () => {
  const tx = fresh();
  let cp = await tx.run(
    snapshot(),
    sender(async () => response()),
    () => "key",
  );
  const m = marker(model),
    tail = { role: "user", content: [{ type: "input_text", text: "tail" }] };
  for (let generation = 1; generation <= 100; generation++) {
    cp = validateCheckpoint(JSON.parse(JSON.stringify(cp)));
    const body = replay({ input: [m, tail] }, cp, m);
    assert.deepEqual(body.input, [...cp.retained, cp.compaction, tail]);
    const { integrity: _, ...base } = cp;
    void _;
    cp = seal({
      ...base,
      generation: generation + 1,
      retained: retained(body.input as Record<string, unknown>[]),
    });
  }
  assert.throws(() => replay({ input: [m, m] }, cp, m));
  assert.throws(() => replay({ input: [] }, cp, m));
  assert.throws(() => replay({ input: [m] }, undefined, m));
});
test("retained history bounded, images omitted, no tool partials", () => {
  const result = retained(
    [
      {
        role: "user",
        content: [
          { type: "input_text", text: "中".repeat(1000) },
          { type: "input_image", image_url: "data:x" },
        ],
      },
      { type: "function_call", call_id: "x" },
    ],
    100,
  );
  assert(Buffer.byteLength(JSON.stringify(result)) < 250);
  assert(!JSON.stringify(result).includes("image"));
  assert(!JSON.stringify(result).includes("�"));
});
