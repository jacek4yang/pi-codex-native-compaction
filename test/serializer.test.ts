import test from "node:test";
import assert from "node:assert/strict";
import { Type, type Message } from "@earendil-works/pi-ai";
import { sender, assistant, user, response, model } from "./fixtures.js";
import { configure } from "../src/config.js";
import { Transaction } from "../src/transaction.js";
import { Diagnostics } from "../src/diagnostics.js";
import { snapshot } from "./fixtures.js";
const system: Message = {
  role: "system",
  content: "Developer instructions",
  timestamp: 0,
  toolsAdded: [
    {
      name: "normal",
      description: "normal",
      parameters: Type.Object({ x: Type.String() }),
    },
    {
      name: "grammar",
      description: "grammar",
      parameters: Type.Object({ input: Type.String() }),
      constrainedSampling: {
        type: "grammar",
        variants: { openai_lark: 'start: "hello"' },
      },
    },
  ],
};
const normal = assistant([
  {
    type: "toolCall",
    name: "normal",
    id: "call_fn|fc_valid",
    arguments: { x: "a" },
    namespace: "functions",
  },
]);
const custom = assistant([
  {
    type: "toolCall",
    name: "grammar",
    id: "call_ct|ctc_valid",
    arguments: { input: "hello" },
  },
]);
const output = (id: string, name: string): Message => ({
  role: "toolResult",
  toolCallId: id,
  toolName: name,
  content: [{ type: "text", text: "done" }],
  isError: false,
  timestamp: 3,
});
const cases: Record<string, Message[]> = {
  text: [user],
  commentary: [
    user,
    assistant([
      {
        type: "text",
        text: "working",
        textSignature: JSON.stringify({
          id: "msg_comment",
          phase: "commentary",
        }),
      },
    ]),
  ],
  final: [
    user,
    assistant([
      {
        type: "text",
        text: "done",
        textSignature: JSON.stringify({
          id: "msg_final",
          phase: "final_answer",
        }),
      },
    ]),
  ],
  reasoning: [
    user,
    assistant([
      {
        type: "thinking",
        thinking: "hidden",
        thinkingSignature: JSON.stringify({
          type: "reasoning",
          id: "rs_valid",
          summary: [],
          encrypted_content: "opaque-reasoning",
        }),
      },
    ]),
  ],
  function: [user, normal, output("call_fn|fc_valid", "normal")],
  custom: [user, custom, output("call_ct|ctc_valid", "grammar")],
  mixed: [
    user,
    assistant([...normal.content, ...custom.content]),
    output("call_fn|fc_valid", "normal"),
    output("call_ct|ctc_valid", "grammar"),
  ],
  orphan_ctc: [
    user,
    assistant([
      {
        type: "toolCall",
        name: "normal",
        id: "call_orphan|ctc_old",
        arguments: { x: "a" },
      },
    ]),
    output("call_orphan|ctc_old", "normal"),
  ],
  update: [
    user,
    {
      role: "system",
      content: "Updated instructions",
      timestamp: 4,
      toolsRemoved: [{ name: "normal" }],
    },
  ],
  image: [
    {
      role: "user",
      content: [
        { type: "text", text: "image" },
        { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
      ],
      timestamp: 1,
    },
  ],
  aborted: [user, { ...normal, stopReason: "aborted" }],
  errored: [
    user,
    { ...normal, stopReason: "error", errorMessage: "interrupted" },
  ],
  model_change: [
    user,
    { ...custom, model: "other-model" },
    output("call_ct|ctc_valid", "grammar"),
  ],
  resumed: JSON.parse(
    JSON.stringify([
      user,
      normal,
      output("call_fn|fc_valid", "normal"),
      custom,
      output("call_ct|ctc_valid", "grammar"),
    ]),
  ),
};
for (const [name, messages] of Object.entries(cases))
  test("Pi-owned serializer parity: " + name, async () => {
    let ordinary: Record<string, unknown> = {};
    let native: Record<string, unknown> = {};
    const send = sender(
      async () => response(),
      (p) => {
        ordinary = p as Record<string, unknown>;
      },
    );
    const stream = send([system, ...messages], {});
    for await (const e of stream) void e;
    await stream.result();
    const cfg = configure({ maxRetries: 0 });
    const tx = new Transaction(cfg, new Diagnostics(cfg));
    await tx.run(
      { ...snapshot(), messages: [system, ...messages] },
      sender(
        async () => response(),
        (p) => {
          native = p as Record<string, unknown>;
        },
      ),
      () => "key",
    );
    const items = native.input as Record<string, unknown>[];
    assert.deepEqual(items.slice(0, -1), ordinary.input);
    assert.deepEqual(items.at(-1), { type: "compaction_trigger" });
    for (const key of Object.keys(ordinary).filter((k) => k !== "input"))
      assert.deepEqual(native[key], ordinary[key]);
    for (const item of items)
      assert(
        !(
          item.type === "function_call" &&
          typeof item.id === "string" &&
          item.id.startsWith("ctc_")
        ),
      );
    if (name === "custom") {
      assert(
        items.some(
          (i) => i.type === "custom_tool_call" && i.id === "ctc_valid",
        ),
      );
      assert(items.some((i) => i.type === "custom_tool_call_output"));
    }
    if (name === "function")
      assert(
        items.some((i) => i.type === "function_call" && i.id === "fc_valid"),
      );
    if (name === "reasoning")
      assert(items.some((i) => i.type === "reasoning" && i.id === "rs_valid"));
    assert.equal(model.api, "openai-codex-responses");
  });
