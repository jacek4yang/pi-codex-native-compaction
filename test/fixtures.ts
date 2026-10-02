import {
  normalizeContext,
  type AssistantMessage,
  type Message,
  type Model,
} from "@earendil-works/pi-ai";
import { getModel } from "@earendil-works/pi-ai/compat";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import type { Sender, Snapshot } from "../src/codex-v2.js";
export const model: Model<"openai-codex-responses"> = {
  ...getModel("openai-codex", "gpt-6-astra"),
  baseUrl: "https://chatgpt.com/backend-api",
  compat: {
    ...getModel("openai-codex", "gpt-6-astra").compat,
    supportsOpenAIGrammarTools: true,
  },
};
export const jwt =
  "x." +
  Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
    }),
  ).toString("base64url") +
  ".x";
export const user: Extract<Message, { role: "user" }> = {
  role: "user",
  content: "remember amber-42",
  timestamp: 1,
};
export function assistant(
  content: AssistantMessage["content"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: "stop",
    timestamp: 2,
    usage: {
      input: 10,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 11,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}
export function snapshot(): Snapshot {
  return {
    sessionId: "session",
    headId: "head",
    model,
    messages: [user],
    generation: 1,
    key: "key",
  };
}
export const compactItem = {
  type: "compaction",
  id: "cmp_test",
  encrypted_content: "opaque-test-not-real",
};
export function events(items: unknown[] = [compactItem]): unknown[] {
  return [
    ...items.map((item, index) => ({
      type: "response.output_item.done",
      output_index: index,
      item,
    })),
    {
      type: "response.completed",
      response: {
        id: "resp_test",
        status: "completed",
        output: items,
        usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
      },
    },
  ];
}
export function response(data: unknown[] = events()): Response {
  return new Response(
    data.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
export function sender(
  fetcher: typeof fetch,
  onPayload?: (body: unknown) => void,
): Sender {
  return (messages, options) =>
    streamSimple(model, normalizeContext({ messages }), {
      ...options,
      apiKey: jwt,
      transport: "sse",
      fetch: fetcher,
      async onPayload(p, m) {
        const body = (await options.onPayload?.(p, m)) ?? p;
        onPayload?.(body);
        return body;
      },
    });
}
