import {
  buildSessionProjection,
  convertToLlm,
  type CompactionEntry,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import {
  hash,
  SENTINEL,
  STRATEGY,
  validateCompaction,
  type Identity,
  type Item,
} from "./checkpoint.js";
import { check, NativeError, object } from "./errors.js";

export const MIGRATE_REQUEST = "pi-codex-native-compaction:explicit-migration";
export const LEGACY_STRATEGY = "openai-native-compact-v2";
import type { Migration } from "./provenance.js";
export interface LegacyBoundary {
  entry: CompactionEntry;
  kind: Migration["kind"];
  window?: { retained: Item[]; compaction: Item };
}
export interface MigrationPlan {
  provenance: Migration;
  messages: Message[];
  window?: LegacyBoundary["window"];
}
/** Only audited legacy schemas are accepted; never interpret a damaged own checkpoint as text. */
export function legacyBoundary(
  entry: CompactionEntry | undefined,
  expected?: Identity,
): LegacyBoundary | undefined {
  if (!entry) return;
  const d =
    entry.details && typeof entry.details === "object"
      ? (entry.details as Record<string, unknown>)
      : {};
  if (entry.summary === SENTINEL || d.strategy === STRATEGY) return;
  check(typeof entry.summary === "string", "Invalid legacy summary");
  if (d.strategy === LEGACY_STRATEGY) {
    check(
      expected,
      "Current model identity required to migrate a native checkpoint",
    );
    const url = new URL(String(d.baseUrl));
    check(
      !url.username && !url.password && !url.search && !url.hash,
      "Unsafe legacy endpoint",
    );
    const oldIdentity = {
      provider: d.provider,
      api: d.api,
      model: d.model,
      baseUrl: url.href.replace(/\/$/, ""),
    };
    check(
      hash(oldIdentity) === hash(expected),
      "Legacy native provider/API/model/endpoint mismatch",
    );
    check(
      expected.provider === "openai-codex" &&
        expected.api === "openai-codex-responses",
      "Only Codex V2 legacy state is supported",
    );
    check(
      Array.isArray(d.compactedWindow) && d.compactedWindow.length > 0,
      "Missing legacy native window",
    );
    const window = structuredClone(d.compactedWindow).map(object);
    const compactions = window.filter((i) => i.type === "compaction");
    check(
      compactions.length === 1 && window.at(-1) === compactions[0],
      "Legacy V2 must end in exactly one compaction item",
    );
    const compaction = validateCompaction(compactions[0]);
    const retained = window.slice(0, -1);
    for (const i of retained) {
      check(
        (i.type === undefined || i.type === "message") &&
          (i.role === "user" || i.role === "developer"),
        "Unsupported legacy retained item",
      );
      check(
        Object.keys(i).every((k) => ["type", "role", "content"].includes(k)),
        "Unknown legacy retained fields",
      );
      check(
        Array.isArray(i.content) && i.content.length > 0,
        "Unsupported legacy retained content",
      );
      for (const raw of i.content) {
        const p = object(raw);
        check(
          p.type === "input_text" &&
            typeof p.text === "string" &&
            Object.keys(p).every((k) => ["type", "text"].includes(k)),
          "Only validated legacy text retention is supported",
        );
      }
    }
    return { entry, kind: "legacy-codex-v2", window: { retained, compaction } };
  }
  // Unknown native formats (including V1/other providers) must not become lossy text imports.
  check(
    !d.strategy &&
      !("compactedWindow" in d) &&
      !("encrypted_content" in d) &&
      !("compaction" in d),
    "Unknown legacy checkpoint strategy; migration refused",
  );
  check(
    Object.keys(d).every((k) => k === "readFiles" || k === "modifiedFiles"),
    "Unrecognized legacy text details; refusing to discard possible native state",
  );
  for (const field of ["readFiles", "modifiedFiles"]) {
    if (field in d)
      check(
        Array.isArray(d[field]) &&
          d[field].every((v: unknown) => typeof v === "string"),
        "Invalid legacy file metadata",
      );
  }
  check(
    entry.summary.trim().length > 0 &&
      !/^\[[\s\S]*checkpoint[\s\S]*\]$/i.test(entry.summary.trim()),
    "Placeholder is not a migratable text summary",
  );
  return { entry, kind: "legacy-text" };
}
export function prepareMigration(
  branch: SessionEntry[],
  legacy: LegacyBoundary,
): MigrationPlan {
  check(
    branch.some((e) => e.id === legacy.entry.id),
    "Legacy boundary missing from branch",
  );
  // Pi performs projection, omissions, summary wrapping and tail selection. No serializer copy.
  const entries = legacy.window
    ? branch.map((e) =>
        e.id === legacy.entry.id
          ? { ...legacy.entry, summary: SENTINEL, firstKeptEntryId: e.id }
          : e,
      )
    : branch;
  const projection = buildSessionProjection(entries);
  const summary = projection.messages.filter(
    (m) => m.role === "compactionSummary",
  );
  check(
    summary.length === 1 &&
      summary[0]?.summary === (legacy.window ? SENTINEL : legacy.entry.summary),
    "Legacy summary was modified/omitted; migration parity cannot be established",
  );
  return {
    provenance: {
      kind: legacy.kind,
      sourceEntryId: legacy.entry.id,
      sourceFingerprint: hash(legacy.entry),
      migratedAt: new Date().toISOString(),
      scope: legacy.window
        ? "native-window-and-post-tail"
        : "visible-summary-and-tail",
      earlierLossNotRecovered: true,
    },
    messages: convertToLlm(projection.messages),
    ...(legacy.window ? { window: legacy.window } : {}),
  };
}
export function migrationRequired(): never {
  throw new NativeError(
    "compatibility",
    "Legacy continuity boundary: run /native-compact migrate explicitly; earlier lost information cannot be recovered",
  );
}
