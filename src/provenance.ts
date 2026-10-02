import { check, object } from "./errors.js";
export interface Migration {
  kind: "legacy-text" | "legacy-codex-v2";
  sourceEntryId: string;
  sourceFingerprint: string;
  migratedAt: string;
  scope: "visible-summary-and-tail" | "native-window-and-post-tail";
  earlierLossNotRecovered: true;
}
export function validateMigration(value: unknown): void {
  const m = object(value);
  check(
    m.kind === "legacy-text" || m.kind === "legacy-codex-v2",
    "Invalid migration kind",
  );
  check(
    m.scope ===
      (m.kind === "legacy-text"
        ? "visible-summary-and-tail"
        : "native-window-and-post-tail"),
    "Invalid migration scope",
  );
  check(
    typeof m.sourceEntryId === "string" &&
      m.sourceEntryId.length > 0 &&
      typeof m.sourceFingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(m.sourceFingerprint),
    "Invalid migration source",
  );
  check(
    typeof m.migratedAt === "string" &&
      Number.isFinite(Date.parse(m.migratedAt)) &&
      m.earlierLossNotRecovered === true,
    "Invalid migration provenance",
  );
  check(
    Object.keys(m).every((k) =>
      [
        "kind",
        "sourceEntryId",
        "sourceFingerprint",
        "migratedAt",
        "scope",
        "earlierLossNotRecovered",
      ].includes(k),
    ),
    "Unknown migration metadata",
  );
}
