import test from "node:test";
import assert from "node:assert/strict";
import {
  SessionManager,
  type CompactionEntry,
} from "@earendil-works/pi-coding-agent";
import { legacyBoundary, prepareMigration } from "../src/migration.js";
import { validateMigration } from "../src/provenance.js";
import { identity, SENTINEL, STRATEGY } from "../src/checkpoint.js";
import { compactItem, model, user } from "./fixtures.js";
const base: CompactionEntry = {
  type: "compaction",
  id: "old",
  parentId: null,
  timestamp: new Date().toISOString(),
  summary: "## Goal\nKeep context",
  firstKeptEntryId: "old",
  tokensBefore: 100,
};
const details = {
  strategy: "openai-native-compact-v2",
  ...identity(model),
  compactedWindow: [compactItem],
};
const native = (): CompactionEntry<typeof details> & {
  details: typeof details;
} => ({
  ...base,
  details: { ...details, model: model.id },
});
test("plain Pi and old text-fallback summaries are recognized explicitly", () => {
  assert.equal(legacyBoundary(base)?.kind, "legacy-text");
  assert.equal(
    legacyBoundary({ ...base, details: { readFiles: [], modifiedFiles: [] } })
      ?.kind,
    "legacy-text",
  );
});
test("damaged own checkpoints cannot be laundered as text", () => {
  assert.equal(
    legacyBoundary({ ...base, summary: SENTINEL, details: { broken: true } }),
    undefined,
  );
  assert.equal(
    legacyBoundary({ ...base, details: { strategy: STRATEGY } }),
    undefined,
  );
});
for (const [field, value] of [
  ["provider", "other"],
  ["api", "other"],
  ["model", "other"],
  ["baseUrl", "https://example.invalid"],
] as const)
  test("legacy native rejects " + field + " mismatch", () => {
    assert.throws(() =>
      legacyBoundary(
        { ...native(), details: { ...native().details, [field]: value } },
        identity(model),
      ),
    );
  });
for (const [name, window] of [
  ["empty", []],
  ["two compactions", [compactItem, compactItem]],
  ["trailing item", [compactItem, { role: "user", content: [] }]],
  ["tool-call", [{ type: "function_call", id: "ctc_bad" }, compactItem]],
  [
    "image",
    [
      { role: "user", content: [{ type: "input_image", image_url: "x" }] },
      compactItem,
    ],
  ],
  ["invalid opaque", [{ ...compactItem, encrypted_content: "" }]],
] as const)
  test("legacy native rejects " + name, () =>
    assert.throws(() =>
      legacyBoundary(
        {
          ...native(),
          details: { ...native().details, compactedWindow: window },
        },
        identity(model),
      ),
    ),
  );
test("unknown native and hidden details never become text imports", () => {
  for (const d of [
    { strategy: "openai-native-compact" },
    { strategy: "other" },
    { compactedWindow: [] },
    { hidden: { encrypted_content: "opaque" } },
    { readFiles: { encrypted_content: "opaque" } },
  ])
    assert.throws(() =>
      legacyBoundary({ ...base, details: d }, identity(model)),
    );
  assert.throws(() =>
    legacyBoundary({ ...base, summary: "[Native checkpoint]" }),
  );
});
test("text migration is exactly Pi-visible summary and retained/live tail", () => {
  const s = SessionManager.inMemory();
  const kept = s.appendMessage({ ...user, content: "retained-only-once" });
  const cpId = s.appendCompaction(base.summary, kept, 100);
  s.appendMessage({ ...user, content: "post-only-once" });
  const cp = s.getEntry(cpId);
  assert(cp?.type === "compaction");
  const plan = prepareMigration(s.getBranch(), legacyBoundary(cp)!);
  const text = JSON.stringify(plan.messages);
  assert(text.includes("## Goal"));
  assert.equal(text.split("retained-only-once").length - 1, 1);
  assert.equal(text.split("post-only-once").length - 1, 1);
  validateMigration(plan.provenance);
  assert.equal(plan.provenance.earlierLossNotRecovered, true);
});
test("old native migration excludes covered Pi kept tail and replaces only marker", () => {
  const s = SessionManager.inMemory();
  const kept = s.appendMessage({ ...user, content: "already-covered" });
  const id = s.appendCompaction("old-native", kept, 100, native().details);
  s.appendMessage({ ...user, content: "post-only-once" });
  const entry = s.getEntry(id);
  assert(entry?.type === "compaction");
  const plan = prepareMigration(
    s.getBranch(),
    legacyBoundary(entry, identity(model))!,
  );
  assert(!JSON.stringify(plan.messages).includes("already-covered"));
  assert(JSON.stringify(plan.messages).includes(SENTINEL));
  assert.equal(
    plan.window?.compaction.encrypted_content,
    compactItem.encrypted_content,
  );
});
test("migration provenance refuses claims that earlier information loss was recovered", () => {
  assert.throws(() =>
    validateMigration({
      kind: "legacy-text",
      sourceEntryId: "x",
      sourceFingerprint: "a".repeat(64),
      migratedAt: new Date().toISOString(),
      scope: "visible-summary-and-tail",
      earlierLossNotRecovered: false,
    }),
  );
});
