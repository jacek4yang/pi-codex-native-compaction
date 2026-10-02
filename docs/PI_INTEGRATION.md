# Pi 1.0 integration

## Public API surface

- Extension registerProvider for openai-codex with a narrow streamSimple wrapper.
- Public pi-ai/api/openai-codex-responses and openai-responses-shared exports.
- ModelRegistry.streamSimple for current provider credentials/environment/headers.
- ReadonlySessionManager branch/projection/identity methods.
- Public convertToLlm, boundary previews, context usage and extension commands.

No private source imports, absolute installation paths or serializer clones.

### Git/source entry and host module resolution (0.3.0)

The manifest points at root index.ts, not dist/index.js. Pi's startup label therefore
uses the package name; Git installs need no compiler or devDependencies.

Pi 1.0's Jiti alias maps the pi-ai package root to compat.js. In a peerless Git install,
appending public /api subpaths to that alias fails. A small adapter resolves those
**public exports** relative to the host's public coding-agent entry, using
import-meta-resolve for ESM export conditions and native ESM import to share the
host module instance and WebSocket cache/lifecycle. Version 0.3.1 obtains the host root
through public getPackageDir: import.meta.resolve inside Jiti otherwise resolves from
the extension instead of the host alias. No node_modules layout or private source path is assumed.

Tests cover source-only loading with just the resolver dependency and no dist/Pi peers,
plus actual CLI status/inspect/JSON behavior and packaged native SDK flows.
Package version is resolved by walking from the public ESM entry to its package
manifest; no node_modules layout is assumed. Runtime is restricted to 1.0.x and
required methods checked. Static public export failure prevents extension loading;
Pi reports that loading error.

## Hook map

[Provider/session isolation](PROVIDER_ISOLATION.md) defines when these hooks participate.
On unrelated providers without an active owned checkpoint, native hooks leave Pi’s
inference and compactor untouched. Model selection and tree navigation reset the
per-scope transaction, scheduler and captured policy; stale callbacks cannot mutate
the new scope.

| Hook                    | Role                                                            |
| ----------------------- | --------------------------------------------------------------- |
| session_start           | scoped capability/identity checks and per-session reset         |
| turn_end                | proactive proposal after safe turn/tool boundary                |
| agent_before_settle     | final safe-boundary opportunity                                 |
| agent_settled           | acknowledge committed proposal or discard cancelled draft       |
| session_before_compact  | scoped manual, threshold and overflow native compaction         |
| session_compact         | acknowledge Pi commit                                           |
| session_compact_failed  | discard proposal                                                |
| before_provider_request | refresh runtime context; block non-Codex use of native sessions |
| session_shutdown        | cancel requests and release proposal/context                    |

Boundary handlers refuse to snapshot other extensions' uncommitted drafts/pending
messages. They do not append user continuations. Overflow willRetry stays Pi-owned;
a real SDK test verifies one original user message and Pi's fresh retry.

## Replay and commit

Pi 1.0's manual CompactionResult declaration says string firstKeptEntryId, while the
runtime append accepts null and stores the new compaction entry's own ID. Boundary
draft types already permit null. This mismatch is isolated in one adapter.

The result/draft keeps a guarded getter for firstKeptEntryId. Actual 1.0.0 tests verify
Pi preserves it through its asynchronous hook chain and reads it before append.
Upgrading Pi requires rerunning the packaged SDK tests; do not assume this contract
for 1.1+.

Self-retention means no old Pi tail is appended behind the summary. Replayed input is:
current leading system/developer updates + retained native user/developer messages +
opaque compaction item + post-checkpoint live tail. The exact Pi-serialized sentinel
must occur once. Unexpected prefix items, orphan markers and duplicate native items
are rejected. Marker rendering is obtained through Pi's public serializer.

## Payload policy and other extensions

Only main-session-owned requests and explicit native transactions inherit checkpoint
state. Independent summarizers (including a different Codex model) bypass that state.
See [checkpoint/pruner ownership](PRUNER_OWNERSHIP.md) for routing, companion fixes,
regression evidence and resume limitations.

Normal Pi payload hooks run before final native replay validation. Non-input changes
(e.g. service-tier or tool policy) are captured as an in-memory delta for the next
native request. Input rewrites by other payload hooks are detected and native compaction
is refused rather than silently losing those changes. Current system/tool transcript
still comes from Pi, not a local schema reconstruction.

The extension is not a universal composition engine for arbitrary context-rewriting
plugins. Only one compaction/provider owner is supported. On resume, run an ordinary
turn before manual compaction if Pi has not established the current system/tool context.

## Performance

No per-token session scan and no polling. Branch/checkpoint validation occurs once per
request/boundary. Remote attempts copy an immutable snapshot. Ordinary turns hash input
for payload-hook parity but avoid cloning the full conversation a second time; the
small non-input policy envelope is copied. Diagnostic writes occur only when opted in.
