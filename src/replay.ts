import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "./pi-ai.js";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { hash, SENTINEL, type Checkpoint, type Item } from "./checkpoint.js";
import { check, object } from "./errors.js";
export function marker(model: Model<Api>): Item {
  const messages = convertToLlm([
    {
      role: "compactionSummary",
      summary: SENTINEL,
      tokensBefore: 0,
      timestamp: 0,
    },
  ]);
  const input = convertResponsesMessages(
    model,
    normalizeContext({ messages }),
    new Set(["openai-codex"]),
    { includeSystemPrompt: false },
  );
  check(input.length === 1, "Unsupported Pi summary serialization");
  return object(input[0]);
}
export function inputOf(payload: unknown): { body: Item; input: Item[] } {
  const body = object(payload);
  check(Array.isArray(body.input), "Pi Codex payload lacks input array");
  return { body, input: body.input.map(object) };
}
export function replay(
  payload: unknown,
  checkpoint: Pick<Checkpoint, "retained" | "compaction"> | undefined,
  markerItem: Item,
): Item {
  const { body, input } = inputOf(payload);
  const markerHash = hash(markerItem);
  const markerText = object((markerItem.content as unknown[])[0]).text;
  const isMarker = (item: Item) =>
    item.role === markerItem.role &&
    Array.isArray(item.content) &&
    item.content.length === 1 &&
    object(item.content[0]).text === markerText &&
    hash(item) === markerHash;
  const matches = input.flatMap((item, i) => (isMarker(item) ? [i] : []));
  if (!checkpoint) {
    check(matches.length === 0, "Orphan native sentinel: checkpoint missing");
    return body;
  }
  check(
    matches.length === 1,
    "Native replay requires exactly one intact structural sentinel",
  );
  const index = matches[0]!;
  // Only current developer/system prompt updates may precede the structural marker.
  check(
    input
      .slice(0, index)
      .every((i) => i.role === "developer" || i.role === "system"),
    "Unexpected pre-checkpoint messages",
  );
  check(
    !input.some(
      (i) => i.type === "compaction" || i.type === "compaction_trigger",
    ),
    "Duplicate/injected native items",
  );
  const rewritten = [
    ...input.slice(0, index),
    ...checkpoint.retained,
    checkpoint.compaction,
    ...input.slice(index + 1),
  ];
  check(!rewritten.some(isMarker), "Sentinel leaked into native replay");
  return { ...body, input: rewritten };
}
/** Selection only, never a transcript serializer. UTF-8 byte budget conservatively overestimates tokens. */
export function retained(input: Item[], budget = 64000): Item[] {
  const result: Item[] = [];
  for (let i = input.length - 1; i >= 0 && budget > 0; i--) {
    const item = input[i]!;
    if (item.role !== "user" && item.role !== "developer") continue;
    if (item.type && item.type !== "message") continue;
    const content =
      typeof item.content === "string"
        ? [{ type: "input_text", text: item.content }]
        : item.content;
    if (!Array.isArray(content)) continue;
    const parts: Item[] = [];
    for (const raw of content) {
      const part = object(raw);
      if (part.type !== "input_text" || typeof part.text !== "string") continue;
      const available = Math.max(0, budget - 32);
      if (!available) break;
      let text = part.text;
      if (Buffer.byteLength(text) > available) {
        // Decode only complete code points, never emit replacement characters from a sliced UTF-8 sequence.
        let used = 0;
        const chars: string[] = [];
        for (const char of text) {
          const n = Buffer.byteLength(char);
          if (used + n > available) break;
          chars.push(char);
          used += n;
        }
        text = chars.join("");
      }
      budget -= Buffer.byteLength(text) + 32;
      if (text) parts.push({ ...part, text });
    }
    if (parts.length)
      result.unshift({ type: "message", role: item.role, content: parts });
  }
  return result;
}
