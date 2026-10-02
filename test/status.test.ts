import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatStatus, statusJson, type Status } from "../src/status.js";
import { VERSION } from "../src/version.js";
const status: Status = {
  enabled: true,
  mode: "native-only",
  model: {
    provider: "openai-codex",
    api: "openai-codex-responses",
    model: "gpt-6-astra",
    baseUrl: "https://chatgpt.com/backend-api",
  },
  transport: "auto",
  usage: { tokens: 8200, contextWindow: 1048576, percent: 0.782 },
  thresholds: { soft: 0.75, hard: 0.88 },
  state: "IDLE",
  generation: 3,
  continuity: "codex-remote-compaction-v2",
  retryCount: 0,
  lastOutcome: "committed",
  scheduler: { nextProbe: 0, compatibilityFailure: false },
  circuit: { failures: 0, openUntil: 0 },
  replay: "ok",
  diagnosticWriteFailures: 0,
  responseId: "resp_test",
  createdAt: "2026-01-01T00:00:00Z",
};
test("human status is compact and not JSON", () => {
  const text = formatStatus(status, { now: 0 });
  assert(text.startsWith("Codex Native Compaction v" + VERSION));
  assert(text.includes("Context: 8,200 / 1,048,576 tokens (0.8%)"));
  assert(text.includes("native V2 · generation 3"));
  assert(text.includes("Replay: healthy"));
  assert(!text.includes('"enabled"'));
  assert(!text.includes("resp_test"));
});
test("inspect adds safe checkpoint metadata", () => {
  const text = formatStatus(status, { detailed: true, now: 0 });
  assert(text.includes("Native response: resp_test"));
  assert(text.includes("API: openai-codex-responses"));
});
test("JSON is explicit, versioned and round-trippable", () => {
  const json = JSON.parse(statusJson(status));
  assert.equal(json.version, VERSION);
  assert.equal(json.name, "pi-codex-native-compaction");
  assert.equal(json.usage.tokens, 8200);
});
test("unknown context and disabled operation remain explicit", () => {
  const text = formatStatus({
    ...status,
    usage: undefined,
    disabled: "Unsupported API",
  });
  assert(text.includes("Context: unknown"));
  assert(text.includes("Disabled: Unsupported API"));
});
test("legacy migration and circuit cooldown are actionable", () => {
  const text = formatStatus(
    {
      ...status,
      continuity: "legacy-text",
      generation: 0,
      migration: {
        available: true,
        kind: "legacy-text",
        requiresExplicitCommand: true,
      },
      circuit: { failures: 3, openUntil: 3000 },
    },
    { now: 1000 },
  );
  assert(text.includes("Action: /native-compact migrate"));
  assert(text.includes("Circuit: open · 2s remaining"));
});
test("untrusted diagnostic text cannot inject terminal controls or extra lines", () => {
  const text = formatStatus({ ...status, replay: "broken\nFORGED\x1b[31m" });
  assert(text.includes("Replay: broken FORGED"));
  assert(!text.includes("\x1b"));
  assert(!text.includes("\nFORGED"));
});
test("runtime version and root Pi entry match package metadata", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(pkg.version, VERSION);
  assert.deepEqual(pkg.pi.extensions, ["./index.ts"]);
  assert(pkg.keywords.includes("pi-package"));
});
