# Remote V2 protocol

## Reference

OpenAI Codex commit `ca466061d64f0b44f416135c7fd06aa7af850bbc`:

- `codex-rs/core/src/compact_remote_v2.rs`
- `compact_remote_v2_attempt.rs`, `compact_remote_history.rs`
- `compact_remote_v2_images.rs`, `responses_retry.rs`
- normal request construction in core client/session and codex-api Responses routes.

Inspected Pi upstream: `b271b0a524b29e13c0c9e748aea0d34e1597f2db`.
Runtime baseline: published Pi AI / coding-agent 1.0.0.

## Request and ownership

The public Codex provider builds instructions, messages and tools. The extension uses
the configured ModelRegistry with fresh authentication, preserves current reasoning,
transport/session/cache settings, and adds exactly one final input item:

```json
{ "type": "compaction_trigger" }
```

Same Codex Responses route as inference. No V1 compact endpoint or public OpenAI API.
Current input includes any prior native retained messages + opaque checkpoint + live tail.
No assistant/function/tool-result serializer is implemented here.

Pi's public `convertResponsesMessages` is used only to derive the exact structural
marker for replay matching. The remote request uses `openai-codex-responses.streamSimple`
itself. Pi owns fc_/ctc_/rs_ namespaces, tools and namespaces, signatures, images,
OAuth, headers, compression, SSE/WebSocket selection and transport fallback.

## Successful response

The Pi stream must succeed, observe terminal `response.completed` (or its
`response.done` equivalent), and expose exactly one completed compaction item with
a nonempty string `encrypted_content`. Unexpected item fields are rejected.
The item is never decrypted, synthesized, normalized or repaired.

The raw observer sees events before Pi normalizes them. Pi 1.0 ends its stream at the
first terminal event: events physically sent after that terminal are not exposed.
The collector rejects duplicate terminals when observable; detecting data beyond Pi's
terminal boundary would require replacing transport, which this project deliberately
does not do. Failed/missing/incomplete terminal responses do not commit.

## Checkpoint

Compaction entry `details` contains:

- schemaVersion 1, protocolVersion 2, strategy codex-remote-compaction-v2;
- provider/API/model/canonical base URL and session/head binding;
- generation, timestamp, response ID and request fingerprint;
- native input-window count/hash;
- retained native text messages, opaque compaction item;
- optional numeric usage; integrity digest.

No live authentication material is persisted. URL credentials/query parameters are
rejected rather than recorded. Integrity hashes detect accidental corruption, not
malicious edits by someone who can rewrite the session file.

## Retained history: deliberate differences

The reference uses a **64,000-token** retained-message budget and a 10,000-token
agent-message ceiling, selective user/hook/developer retention, image-token policies,
and feature-dependent client-developer history. It also trims older function-call
history under its own request/tool ownership rules.

Pi does not expose Codex's hook provenance, agent-message categories, client-authored
developer ownership, image stash, or exact tokenizer. This extension:

- selects existing Pi-serialized user/developer messages, never reconstructs them;
- uses a conservative **64,000 UTF-8-byte** content budget with per-part overhead;
- preserves newest text messages within that budget, truncating oversized text on
  code-point boundaries;
- omits images from the _visible retained prefix_, but sends them in compaction input;
- retains no visible assistant/tool/reasoning fragments: those are represented by the
  encrypted state, avoiding orphaned call/output pairs;
- does not port Codex's ownership-dependent tool-history trimming or agent metadata;
- requires explicit migration for preexisting textual compaction and records the
  inherited information-loss boundary instead of claiming it was recovered.

These choices under-use the reference token budget and do not promise identical
history retention. Opaque state plus retained history is replayed on every generation.

## Retries

Two extension retries after the initial attempt match Codex's small dedicated budget.
Pi's internal generic request retries are disabled for this attempt to avoid multiplying
budgets. Pi still owns transport negotiation/fallback. Unlike Codex, the extension
does not replenish its application-level retry budget after transport fallback.
Backoff has bounded jitter and honors Retry-After when it fits the local wait budget.
