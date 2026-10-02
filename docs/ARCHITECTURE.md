# Design

A clean implementation, not a derivative of pi-better-compaction.

Pi owns transcript serialization, tool declarations, OAuth, headers, HTTP/SSE/WebSocket
transport and session JSONL writes. A narrow wrapper around the public Codex provider
adds validated replay after Pi's request hooks. The native attempt calls the configured
model registry, with an onPayload callback appending compaction_trigger, and observes
raw events. No Responses message serializer exists here.

The transaction snapshots the branch head, session identity, model identity and transcript.
The remote response is only a proposal until completion, validation and a fresh head check.
Pi appends a self-retaining compaction entry; details contain a versioned checkpoint.
The deterministic structural summary is replaced as one whole Pi-serialized item,
never substring-edited. All pre-boundary history is replaced, so no retained Pi tail
can duplicate the checkpoint's native retained messages. New messages follow it once.

turn_end and agent_before_settle are safe boundary proposals. No artificial continuation
is injected. Manual and overflow use session_before_compact and Pi's own retry lifecycle.
Failures return cancellation, never an absent handler result that would enable text fallback.

Retained native messages are selected from Pi's own built request, not reconstructed:
user and developer messages, bounded conservatively to 64,000 UTF-8 bytes
(an intentional under-utilization, not a claim of tokenizer parity). Large text blocks
are truncated on UTF-8 boundaries. Images are omitted from retained visible history,
but included in the remote compaction input. Codex-only hooks/agent metadata are not guessed.
Legacy boundaries require an explicit migration command, never silent promotion to
lossless continuity. Text migration uses the Pi-visible summary/tail; audited old V2
migration uses its validated native window and post-boundary tail. Provenance records
that earlier information loss is not recovered and survives future generations.
See MIGRATION.md.

Durability uses Pi's JSONL commit mechanism. This protects process interruption during
network activity; Pi does not fsync every append, so power-loss durability is not claimed.
