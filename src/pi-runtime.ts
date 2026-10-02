import type { Checkpoint } from "./checkpoint.js";
import { SENTINEL } from "./checkpoint.js";
/**
 * Pi 1.0 preserves draft/result property accessors until the synchronous append path.
 * This tiny adapter closes the async hook-chain -> commit race without patching Pi.
 * Covered against actual Pi SDK, including a later hook that changes the session.
 */
export function commitDraft(checkpoint: Checkpoint, guard: () => void) {
  return {
    type: "compaction" as const,
    summary: SENTINEL,
    get firstKeptEntryId(): null {
      guard();
      return null;
    },
    details: checkpoint,
  };
}
