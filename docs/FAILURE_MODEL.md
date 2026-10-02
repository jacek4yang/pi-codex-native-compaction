# Failure model

## Transaction boundary

IDLE -> SCHEDULED -> SNAPSHOT -> REQUESTING -> VALIDATING -> COMMITTING -> IDLE.

Retries pass through BACKOFF. Errors pass through FAILED; cancellation through CANCELLED.
Consecutive transient failures open CIRCUIT_OPEN. A successful committed checkpoint
resets the breaker. Illegal state transitions throw and are tested.

The operation snapshots session/head, model, transcript and generation. Its stale key
also binds system prompt and active/available tool definitions. Only one transaction can
own a session-generation proposal; competitors receive a stale/in-flight rejection,
not a second checkpoint to commit.

No remote-call side effect writes session history. After remote validation, Pi owns
the append. A tiny Pi 1.0 compatibility adapter rechecks the snapshot and AbortSignal
when Pi reads firstKeptEntryId directly before its synchronous append. A later hook
that changes the head therefore cannot commit a stale checkpoint. The checkpoint's
parent/head relationship is validated again on replay.

## Failure matrix

| Failure                                                        | Retry                    | Commit                                   |
| -------------------------------------------------------------- | ------------------------ | ---------------------------------------- |
| DNS/reset/TLS/socket/timeout/early EOF                         | bounded                  | no                                       |
| item then EOF before terminal                                  | bounded                  | no                                       |
| HTTP 408/429/500/502/503/504                                   | bounded                  | no unless a later attempt fully succeeds |
| HTTP 400/401/403                                               | no                       | no                                       |
| malformed SSE/event, zero/duplicate item, empty opaque content | no (early EOF may retry) | no                                       |
| signal cancellation                                            | no                       | no                                       |
| stale head/session/model/tool configuration                    | no                       | no                                       |
| corrupted checkpoint/identity mismatch                         | no                       | outgoing replay blocked                  |
| artifact write error                                           | irrelevant               | does not influence transaction           |
| quota Retry-After beyond wait budget                           | no early retry           | no                                       |

Soft-zone failures preserve headroom and permit another ordinary turn; cooldown
prevents turn-by-turn hammering. At the hard threshold normal requests fail closed.
Deterministic failures latch the automatic scheduler until manual success/reinitialization.

## Crash and storage assumptions

- Process dies during request/backoff: only original Pi history exists.
- Remote succeeds but no append: original history remains; retry is safe.
- Pi append completes: restart discovers the checkpoint in the JSONL; no artifact needed.
- Compaction is append-only; old branch entries are not deleted.
- A cancelled boundary proposal is discarded when Pi settles.
- A partial/truncated JSONL record must be handled by Pi's own recovery semantics.

Pi updates its in-memory entry list and appends synchronously; it does not provide an
extension-facing fsync/atomic-write transaction. Consequently this extension cannot
guarantee atomic memory/disk behavior on disk-full/write failure or durability through
power loss. Stop and recover from the original JSONL on storage failure. No manual
rewriting of Pi storage internals is attempted.

Only one Pi process may write a session file. There is no distributed/file-lock protocol.

## Fail closed, never summarize

Every native session_before_compact failure returns cancellation, never an absent result
that would allow built-in LLM summary fallback. Provider replay validation runs inside
the provider, since ordinary Pi hook exceptions are reported but swallowed.

Opaque state is injected only into the bound Codex provider. Different identity,
forked session ID, unexpected marker, retained Pi tail, or unknown schema rejects replay.
Other providers are aborted and receive no opaque state. This is not multi-provider support.

Explicit legacy migration uses the same transaction and pre-append guard. Failure leaves
the original boundary intact. An old text summary may continue as text before consent,
but this extension never creates a new summary fallback. Known old native state is not
replayed in ordinary requests until a successful explicit migration. Details and provenance
are in MIGRATION.md.

Running another compaction owner or overriding this provider after it registers is
unsupported. Known pi-better-compaction command sources are detected, not deleted.
