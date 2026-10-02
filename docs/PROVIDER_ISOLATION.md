# Provider and session isolation (0.3.2)

Native compaction is an optional owner of Codex conversation state, not a global
replacement for Pi's compactor.

| Active context                                        | Request configuration                    | Behavior                                                                             |
| ----------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| No owned native checkpoint                            | Another provider or API                  | Pi inference, manual/automatic compaction, payload hooks and pruning remain Pi-owned |
| No owned checkpoint, native disabled                  | Codex                                    | Ordinary Pi inference and text compaction remain available                           |
| Owned checkpoint                                      | Compatible Codex identity                | Strict native replay; normal native compaction when enabled                          |
| Owned checkpoint, native paused                       | Compatible Codex identity                | Replay remains available; no new native generation or unsafe text replacement        |
| Owned checkpoint                                      | Incompatible provider/API/model/endpoint | Reject main continuation before transport; preserve checkpoint                       |
| Independent auxiliary request                         | Any supported auxiliary model            | Never inherit the main checkpoint                                                    |
| New session / another branch without owned checkpoint | Another provider                         | No inherited refusal, native pressure gate, migration warning or circuit state       |

## Ownership follows Pi's current projection

Only the latest typed compaction on the active branch determines the boundary.
Owned formats are codex-remote-compaction-v2, the explicitly audited
openai-native-compact-v2 migration format, and the reserved native marker (including
a corrupt marker missing its details). Merely having a strategy or compactedWindow
field does not make another extension's summary ours. Archived native entries
outside the current projection do not block another branch.

Recognizing a newer non-native summary is not a native-to-text conversion feature:
the producer of that summary remains responsible for its semantics. This extension
does not decrypt or silently discard checkpoint information.

Provider/API matching happens before endpoint parsing. Inactive providers do not
enter native compatibility checks, migration analysis, pressure thresholds or
compaction proposal code. Explicit native commands report that they are inactive;
status exposes active/inactive/blocked scope.

## Reject without damaging the session

For incompatible main requests, the request hook aborts Pi's active request and
returns a non-serializable rejection payload. Throwing an extension-handler error
alone is insufficient: Pi reports handler failures and can continue its pipeline.
An integration test confirms even a subsequent payload-rewriting extension cannot
cause a network request after the abort. Other-provider native compaction attempts
are rejected before Pi can replace the opaque state with a text summary.

Hash, identity, session provenance and transaction commit validation are unchanged.

## Lifecycle isolation

Session start, model selection and tree navigation cancel the old transaction and
reset system/policy capture, scheduler and circuit state. Async proposals and commit
guards retain their originating transaction. A failed obsolete request cannot
write cooldown/failure state into the new model/branch's scheduler.

Both automatic-boundary and manual-compaction races are tested with a held SSE
request: switch models while native compaction is in flight, cancel it, and then
successfully use Pi's own inference and compaction under another provider.
The automatic race was also run with the guard removed as a negative control:
the test caught a leaked nextProbe timestamp, and passed with the guard restored.

## Validation

Twenty real Pi SDK integration scenarios cover:

- normal and query-bearing endpoints on other providers;
- unrelated strategy metadata and superseded historical checkpoints;
- native, audited legacy and corrupt native boundaries;
- provider/API combinations, including the same provider with a different API;
- disabled native mode with/without an existing checkpoint;
- actual session creation and tree navigation in the same process;
- switching back to the compatible Codex model;
- Pi's automatic text compaction under low test thresholds;
- late payload rewriting and pre-transport rejection;
- both in-flight model-switch races.

Tests inspect actual HTTP counts/payloads, checkpoint preservation, successful
non-native compaction records, inactive status, and reset scheduler/circuit state.
CI repeats these tests against the independently installed tarball.

This is Pi 1.0.x integration coverage, not a promise that arbitrary external
extensions cannot themselves change behavior. No changes to official pruner or
other provider implementations are required.
