# Independent pruning and native checkpoint ownership (0.3.1)

## Failure mechanism and invariants

The provider registration is shared, not a main-agent-only hook. Pi-context-prune
calls the registered provider with a new, single-user tool-summary transcript and
no main-session routing ID. The old wrapper nevertheless read the active main
session checkpoint, validated it against the summarizer model, and prepared
native replay. After an Astra checkpoint, Luna failed before transport with
`Checkpoint provider/API/model/endpoint mismatch`. Even a same-model auxiliary
request could inherit main history and overwrite captured main system/policy state.

The wrapper now distinguishes the owning main request using Pi's session routing
ID (the same distinction used by Pi's agent stream function). Native transactions
remain identified by their private registered callback. Other requests go straight
to the host Codex provider, without reading/replaying a checkpoint or touching
main request policy, system context or pressure gates. A session switch before
primary serialization fails closed. Auxiliary callers must not borrow the main
session routing ID for unrelated work.

Identity comparison, integrity checks, native replay rules and transaction commit
validation are unchanged. A genuine main continuation with an incompatible model,
provider, API or endpoint is still rejected.

```text
main Astra checkpoint ──────────────── retained, identity-bound, opaque
       │
       └─ typed Pi compaction boundary
                  │
           eligible post-boundary tool outputs
                  │ separate Luna request, no main continuation state
                  ▼
             local prune summary + recent context
                  │
main Astra continuation = checkpoint + summary + recent context
```

## Companion pruner correction

A local patch to pi-context-prune 2.1.0 additionally:

- selects candidates using the latest typed compaction and firstKeptEntryId,
  preserving Pi text-compaction kept tails and global assistant-turn numbering;
- keeps old raw JSONL and query aliases, without resubmitting pre-boundary output;
- rejects results after branch/boundary/session changes or cancellation;
- fingerprints failed ranges using identifiers and hashed scope, not tool content;
- suppresses identical checkpoint incompatibilities until state changes or reload,
  and gives transient failures a 60-second retry cooldown;
- publishes its in-memory raw-output index only after durable index append succeeds.

No checkpoint text matching or ciphertext parsing is used. Empty candidate ranges
make no provider request. A UI preview is not treated as authoritative after a
concurrent compaction. This is a companion local patch, not an upstream/npm release.

## Regression evidence

- The initial real-SDK regression failed at the first post-checkpoint Luna call
  with the original mismatch before an HTTP request was observed.
- Native SDK coverage exercises auxiliary Luna and Astra requests before native
  compaction, after three successive checkpoints and after disk reopening. It
  checks exact request content, policy isolation, foreign cache-scope IDs,
  unchanged session state and rejected main identity mismatches with zero requests.
- A plain-Node CLI smoke covers source-only installs without local Pi peers.
  It catches host resolution failures which a TSX-only test could hide.
- The companion's actual extension/tool/context hooks run through 24 compactions
  and 72 pruning cycles. Frontiers increase; each eligible range is summarized
  once; all 96 original tool results remain recoverable. Active context is bounded
  (at most 12 fixture messages), not the archival append-only JSONL file.
- Additional companion tests cover automatic pruning, kept text tails, no-op
  ranges, deterministic/transient failures, cancellation, stale in-flight results,
  disk reload, copied JSONL, tree forks and failed index persistence.
- Cross-extension SDK integration loads both real extensions, invokes /pruner now
  using Luna before/after native checkpoints and after disk reopening, and checks
  the next Astra request still contains exactly one native compaction item.

Run the optional cross-package integration against the built companion checkout:

```sh
PI_NATIVE_PRUNER_EXTENSION=/path/to/pi-context-prune/dist/index.js \
  npx tsx --test --test-name-pattern='SDK: coupled' test/sdk.test.ts
```

The endpoint in deterministic tests is a local SSE fixture. This validates real
Pi serialization/routing, not remote model summary quality or an unlimited live soak.

## Compatibility and operation

No checkpoint migration or session-file rewrite is needed for existing V2 sessions.
Reload each running Pi to load the installed code; an on-disk update cannot replace
already running JavaScript closures. Main Astra + Codex API + Luna pruning remains
supported without changing either model or increasing context limits.

Same-session tree navigation and JSONL copies preserving session identity are covered.
The existing native restriction on rebinding a checkpoint to a **new session UUID**
remains: cross-session native checkpoint migration is unsupported and fails closed.

The change reduces pruning input after compaction. It does not replay historical
tools into Luna. Summary generation remains lossy by design, while raw historical
tool output remains retrievable. No production transcripts or credentials are
included in test fixtures or diagnostics.
