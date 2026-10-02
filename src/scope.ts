import type {
  CompactionEntry,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { SENTINEL, STRATEGY } from "./checkpoint.js";
import { LEGACY_STRATEGY } from "./migration.js";

/** Pi projects only the newest compaction on the active branch. Never scan
 * historical strategies to decide ownership of the current request. */
export function activeCompaction(
  branch: readonly SessionEntry[],
): CompactionEntry | undefined {
  return branch.findLast(
    (entry): entry is CompactionEntry => entry.type === "compaction",
  );
}

export function ownsCompaction(entry: CompactionEntry | undefined): boolean {
  if (!entry) return false;
  const strategy =
    entry.details && typeof entry.details === "object"
      ? (entry.details as { strategy?: unknown }).strategy
      : undefined;
  // The reserved marker without details is corrupt owned state, not portable text.
  return (
    strategy === STRATEGY ||
    strategy === LEGACY_STRATEGY ||
    entry.summary === SENTINEL
  );
}

export const INCOMPATIBLE_CONTEXT =
  "This context depends on a Codex native checkpoint. Switch back to its compatible openai-codex model/API/endpoint, or start a new session for this provider.";
