import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContext, type Transport } from "@earendil-works/pi-ai";
import {
  streamSimple,
  closeOpenAICodexWebSocketSessions,
  getOpenAICodexWebSocketDebugStats,
} from "@earendil-works/pi-ai/api/openai-codex-responses";
import { configure } from "../src/config.js";
import { Diagnostics } from "../src/diagnostics.js";
import { Transaction } from "../src/transaction.js";
import type { Sender } from "../src/codex-v2.js";
import {
  compactItem,
  events,
  jwt,
  model,
  response,
  snapshot,
} from "./fixtures.js";

type Frame = unknown | { disconnect: true };
let sequence = 0;
/** Fake socket boundary only: the request builder, cached transport and event parser are Pi's. */
async function withSocket(
  frames: Frame[],
  body: (
    tx: Transaction,
    send: Sender,
    id: string,
    httpCalls: () => number,
  ) => Promise<void>,
  {
    transport = "auto",
    allowSse = false,
  }: { transport?: Transport; allowSse?: boolean } = {},
) {
  const original = globalThis.WebSocket;
  const id = "ws-fault-" + ++sequence;
  let httpCalls = 0;
  class Socket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = 0;
    binaryType = "arraybuffer";
    constructor() {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }
    send(data: string) {
      const request = JSON.parse(data) as {
        type: string;
        input: Record<string, unknown>[];
      };
      assert.equal(request.type, "response.create");
      assert.deepEqual(request.input.at(-1), { type: "compaction_trigger" });
      queueMicrotask(() => {
        for (const frame of frames) {
          if (frame && typeof frame === "object" && "disconnect" in frame) {
            this.close();
            break;
          }
          this.dispatchEvent(
            new MessageEvent("message", {
              data: typeof frame === "string" ? frame : JSON.stringify(frame),
            }),
          );
        }
      });
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.dispatchEvent(
        Object.assign(new Event("close"), {
          code: 1006,
          reason: "injected disconnect",
        }),
      );
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const c = configure({ maxRetries: 0 });
  const tx = new Transaction(c, new Diagnostics(c));
  const send: Sender = (messages, options) =>
    streamSimple(model, normalizeContext({ messages }), {
      ...options,
      apiKey: jwt,
      transport,
      sessionId: id,
      fetch: async () => {
        httpCalls++;
        if (!allowSse) throw new Error("SSE forbidden in this fault test");
        return response();
      },
    });
  try {
    await body(tx, send, id, () => httpCalls);
  } finally {
    closeOpenAICodexWebSocketSessions(id);
    globalThis.WebSocket = original;
  }
}
for (const transport of ["websocket", "websocket-cached", "auto"] as const)
  test("Pi WebSocket terminal native success: " + transport, async () => {
    await withSocket(
      events(),
      async (tx, send, id, http) => {
        const cp = await tx.run(snapshot(), send, () => "key");
        tx.acknowledge(cp);
        assert.equal(http(), 0);
        assert.equal(getOpenAICodexWebSocketDebugStats(id)?.requests, 1);
        assert.equal(getOpenAICodexWebSocketDebugStats(id)?.sseFallbacks, 0);
      },
      { transport },
    );
  });
for (const [name, frames] of [
  ["compaction item then close", [events()[0], { disconnect: true }]],
  ["zero compaction items", events([])],
  ["duplicate compaction items", events([compactItem, compactItem])],
  [
    "malformed encrypted content",
    events([{ ...compactItem, encrypted_content: "" }]),
  ],
  ["malformed JSON then close", ["{broken", { disconnect: true }]],
] as [string, Frame[]][])
  test("Pi WebSocket " + name + " never commits", async () => {
    await withSocket(frames, async (tx, send) => {
      await assert.rejects(tx.run(snapshot(), send, () => "key"));
      assert.equal(tx.proposal, undefined);
    });
  });
test("Pi WebSocket failure before first event may safely fall back to full SSE V2", async () => {
  await withSocket(
    [{ disconnect: true }],
    async (tx, send, id, http) => {
      const cp = await tx.run(snapshot(), send, () => "key");
      assert.equal(http(), 1);
      assert.equal(getOpenAICodexWebSocketDebugStats(id)?.sseFallbacks, 1);
      tx.acknowledge(cp);
      assert.equal(tx.lastOutcome, "committed");
    },
    { allowSse: true },
  );
});
test("Pi cannot fall back after receiving partial native output", async () => {
  await withSocket(
    [events()[0], { disconnect: true }],
    async (tx, send, id, http) => {
      await assert.rejects(tx.run(snapshot(), send, () => "key"));
      assert.equal(tx.proposal, undefined);
      assert.equal(http(), 0);
      assert.equal(getOpenAICodexWebSocketDebugStats(id)?.sseFallbacks, 0);
    },
    { allowSse: true },
  );
});
