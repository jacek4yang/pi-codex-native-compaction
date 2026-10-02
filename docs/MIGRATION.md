# Old-session migration — 0.2.0

## User workflow

Reload/restart Pi with this extension installed and the old compaction owner removed.
Resume the original session (not a fork), with its original Codex provider/model/endpoint.

```text
/native-compact status
/native-compact migrate
/native-compact status
```

The command explicitly acknowledges that older information loss cannot be recovered.
On successful commit, status shows native continuity with a `migration` provenance
record. From then on ordinary `/compact`, proactive scheduling and Pi overflow recovery
all use Native V2 without another migration command.

Installation never migrates sessions automatically. Ordinary `/compact` and automatic
triggers refuse to cross an old boundary without the explicit migration command.

## Supported sources

### Pi textual summaries, including old text fallbacks

Pi's canonical **visible summary + retained/live tail** become input to a fresh V2
request. No new LLM text summary is generated. Text already discarded in the old
summarization process is not recovered; this is a new native continuity boundary.

Only ordinary summary entries with absent details or Pi's readFiles/modifiedFiles
metadata are accepted. Unknown details might conceal provider state and are rejected.
The old text session may continue ordinary inference before explicit migration,
subject to the hard context threshold, but cannot silently create another summary.

### Audited pi-better-compaction Codex Remote V2 format

Recognized strategy: `openai-native-compact-v2`, with flat provider/API/model/baseUrl
and inline `compactedWindow`. Its archived implementation was inspected, not imported:
its V2 input includes the visible history at the old boundary, and later V2 requests
use the old window plus post-boundary entries.

The adapter requires:

- exact current Codex provider/API/model/canonical endpoint;
- exactly one nonempty opaque compaction item at the end of the old window;
- only audited user/developer input_text retained items before it;
- Pi-resolvable boundary, current branch and system/tool transcript.

It uses the **old native window + post-boundary tail**, excluding the already-covered
pre-boundary Pi kept tail. Pi's public buildSessionProjection and provider serializer
perform all message conversion. A fresh Native V2 call must succeed before a new
checkpoint is committed. This is not relabeling the old encrypted state as a successful
new checkpoint, and there is no copied legacy serializer.

This is narrow format compatibility, not a universal importer for arbitrary versions
of pi-better-compaction. V1/other-provider/unknown/corrupt formats, out-of-line artifact
pointers, retained images/tool calls/assistant items, and identity mismatch are refused.
The adapter does not decrypt, edit or repair opaque content.

## Durable provenance and safety

Checkpoint `migration` contains kind, source entry ID/fingerprint, migration timestamp,
scope and `earlierLossNotRecovered:true`. It is integrity-covered and propagated through
future generations. No old provider headers, credentials or diagnostic artifacts are
copied into it.

Both paths use the normal single-flight transaction, complete-response validation,
cancellation and pre-append stale guard. Failure appends no new compaction checkpoint;
the old boundary remains authoritative. A damaged checkpoint belonging to this extension
cannot be laundered through the text-import path.

## Pi 1.0 constraints

Pi refuses compact when the head itself is a compaction entry or no eligible messages
can be summarized. The extension does not append dummy entries to bypass that safeguard.
For a text session, continue one real turn and retry migration. If opaque legacy state
has no eligible tail, direct migration is unavailable; do not send its placeholder as
ordinary context or manually rewrite JSONL to bypass checks.

Freshly resumed sessions also need a recorded system/tool transcript. Text sessions can
establish it with a real normal turn. Unknown opaque-only sessions remain blocked rather
than guessing tool declarations. Current public ToolInfo is insufficient to reconstruct
every grammar/custom-tool property, so no parallel tool serializer is introduced.

A very large old context may exceed the native endpoint's capacity. The operation then
fails without deleting history. Back up the JSONL before troubleshooting; do not edit
the encrypted content or suppress identity checks.
