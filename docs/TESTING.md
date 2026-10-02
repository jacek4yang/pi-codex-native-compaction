# Verification

## Reproduce

```sh
npm ci
npm run check
npm run format:check
npm pack
```

Exact baseline and latest available package versions checked: Pi coding-agent **1.0.0**,
Pi AI **1.0.0**. Node **24.21.0**, strict TypeScript, ESLint and formatted sources.
No live credentials needed by the offline suite.

The packed tarball was installed into an isolated directory with its own Pi 1.0.0
peer dependencies; **seven installed-package SDK scenarios passed**: normal replay,
text/native migration, failed/stale migration, actual migrate command and automatic
native compaction after migration. These include repeated generations, disk reopening,
HTTP400 preservation and corrupt-checkpoint rejection. Clean npm ci,
build, formatting, typecheck and lint all pass; npm audit reported zero vulnerabilities.
The local pi-lsp configuration has no TypeScript route, so compiler diagnostics
come from strict tsc rather than an LSP server.

## Offline result

**135 tests passed**, no skips:

- 36 core/config/state/retry/checkpoint/replay tests.
- 9 hardening tests, including **1,000 transaction generations** with injected
  interruptions/stale results; separate 100-generation replay/restart simulation.
- 18 actual Pi SDK scenarios against a localhost SSE provider: manual, automatic,
  late-head mutation after our hook, overflow recovery, soft-zone failure, hard-zone
  blocking, mixed normal/custom tools, compiled extension loading and corrupt-disk
  rejection, payload-policy preservation, input-rewrite rejection, legacy boundary,
  text/native migration, failed/stale migration, the actual migrate command and
  automatic native compaction after migration.
- 2 privacy tests including a provider error echoing fake credentials.
- 14 Pi-owned serialization parity fixtures.
- 7 human-status/inspect/JSON/version tests, one peerless source-entry SDK test,
  and an exact-function-identity check for the host public-export adapter.
- 16 migration tests: supported text/V2 schemas, strict native-window/identity checks,
  hidden native-state rejection, Pi-owned projection parity and honest provenance.
- 10 WebSocket transport tests using a fake socket boundary and the actual Pi
  WebSocket request/event implementation: all three modes, missing/duplicate/malformed
  output, partial-output disconnect, and pre-output SSE fallback safety.

All network fault tests exercise the **actual Pi Codex provider**, not a local serializer.
The local backend tests exercise Pi's session projection and JSONL append implementation.
One test changes the head in a later compaction hook: pre-append guarding rejects it.
HTTP400 assertions compare the original session file bytes and leaf identity.

Coverage includes refused/reset/DNS/TLS/timeout/socket failures, abort before/during/after
remote validation, EOF after a compaction item, malformed SSE/events, delayed terminal,
408/429/500/502/503/504, deterministic 400/401/403, exhausted retries and retry success.
No checkpoint is proposed/committed on terminal failure.

Serializer fixtures include user text, commentary/final text, rs_ reasoning, fc_ calls,
ctc_ grammar/custom calls and outputs, orphan ctc_ normalization, mixed calls, namespace
metadata, system/tool updates, images, aborted/errored turns, model changes and resumed
JSON transcripts. Each native input is compared to an ordinary request from the **same
Pi provider**, with only compaction_trigger appended. The permanent ctc_ invariant
forbids function_call.id starting with ctc_.

Tool-search/additional-tool internals not exposed by the tested Codex tool path are not
independently synthesized. Grammar/custom tools were also validated live.

## v0.3.2 provider/session isolation

Twenty additional actual-SDK scenarios cover other providers/APIs, ordinary Pi
compaction, active versus archived native boundaries, same-process new sessions,
tree/model changes and in-flight cancellation. CI reruns them against the installed
tarball. Status presentation distinguishes inactive versus blocked contexts.
See [isolation invariants and race evidence](PROVIDER_ISOLATION.md).
A fresh three-generation Codex run also verified replay, two tools, reconnect and
session reopen: 11 WebSocket requests, eight reuses, five deltas, no fallback/failure.
[Sanitized v0.3.2 evidence](validation-v0.3.2.json) separates live from fixture coverage.

## v0.3.1 request ownership and installation

The new SDK scenario exercises independent Luna and Astra requests before native
compaction, after three generations, and after disk reopening. Requests contain no
main checkpoint/continuation state; the main checkpoint remains intact. Genuine
main identity mismatches still fail before transport.

CI also installs the tarball, reruns eight packaged SDK scenarios (including the
independent-request regression), and loads the published upstream
pi-context-prune 2.1.0 alongside it for a real-SDK coupled test. No local fork is
required for this compatibility test. A separate local pruner patch has the
boundary/retry long-session coverage documented in [ownership notes](PRUNER_OWNERSHIP.md).

The plain-Node RPC source-entry smoke proves Git/source loading without package-local
Pi peers; a TSX-only loader test would not catch the original host-resolution issue.
A terminal startup check confirms a root entry displays a package name rather than
a standalone dist directory.

A fresh existing-OAuth v0.3.1 run completed three native generations, two real tool
executions, reconnect and session reopen. All 11 requests used WebSocket, with eight
connection reuses, five deltas and no SSE fallback or WebSocket failure.
See [sanitized v0.3.1 evidence](validation-v0.3.1.json). Live Luna pruning is not claimed.

## Live evidence

Existing Pi Codex OAuth only; isolated temporary sessions; no user configuration changes.

- Initial validation: three successful native generations, every replay coherent,
  real encrypted checkpoint JSONL entries, restart recovery.
- Tool-enabled soak: **six consecutive generations**, both normal and grammar/custom
  tools actually executed, every replay recovered the exact marker, restart recovered it.
- Final revision smoke: three further tool-enabled generations and restart.

The six-generation soak returned encrypted-content lengths of
**1996, 1828, 1996, 1996, 2060, 2104 bytes**. Only lengths and response IDs are retained
in release evidence, never encrypted content or credentials.
See [validation-live.json](validation-live.json).

Commands:

```sh
npm run live
PI_NATIVE_LIVE_TOOLS=1 PI_NATIVE_LIVE_GENERATIONS=6 npm run live
```

For standalone Node environments where global fetch does not honor proxies by default,
set NODE_USE_ENV_PROXY=1 and use the existing authenticated-route proxy environment.
The first unconfigured SDK attempt failed network connectivity; the configured route
succeeded. That failure did not modify the test session with a compaction entry.

## WebSocket verification

Separate real AgentSession runs with existing Codex OAuth passed:

| Transport                             | Native generations | Actual WS requests | Socket reuses | SSE fallbacks |
| ------------------------------------- | -----------------: | -----------------: | ------------: | ------------: |
| websocket                             |                  3 |                 11 |             8 |             0 |
| auto (cached WebSocket)               |                  3 |                 11 |             8 |             0 |
| websocket-cached                      |                  3 |                 11 |             8 |             0 |
| auto: independent-process disk resume |                  — |                  1 |             0 |             0 |

Total: **34 actual WebSocket requests, 9 native generations**, zero WebSocket
failures. Both normal and grammar/custom tools executed in each three-generation run.
Replay prompts did not call tools to recover the marker.

Pi may fall back to SSE even when transport is explicitly websocket. The test-only
transport proof therefore **blocks HTTP POST /responses** and asserts Pi's public
WebSocket diagnostic counters, rather than inferring transport from configuration.

Cached compaction used a one-item delta (the trigger). Every subsequent checkpoint
replay switched back to full context, without a stale previous_response_id. Connection
reuse, explicitly closed/recreated sockets, and SDK session disposal/reopening succeeded.
A separate Node process reopened the auto test's actual JSONL at generation 3 and
recovered the marker over a new WebSocket without calling tools.

Reports: [validation-websocket.json](validation-websocket.json).
No production code or normal Pi settings were changed for this validation.

```sh
PI_NATIVE_LIVE_TRANSPORT=websocket PI_NATIVE_LIVE_TOOLS=1 npm run live
PI_NATIVE_LIVE_TRANSPORT=auto PI_NATIVE_LIVE_TOOLS=1 npm run live
PI_NATIVE_LIVE_TRANSPORT=websocket-cached PI_NATIVE_LIVE_TOOLS=1 npm run live
PI_NATIVE_LIVE_TRANSPORT=auto PI_NATIVE_LIVE_TOOLS=1 \
  PI_NATIVE_LIVE_RESUME_FILE=/absolute/test-session.jsonl npm run live
```

Use the same existing authenticated proxy environment where needed. Each run is bounded
to three generations by default. Production fallback remains Pi-owned; the fallback
blocker is only in the test harness.

## GitHub/source-entry verification (0.3.0)

The new root source entry loads with no compiled dist or local Pi peer copies. CLI RPC
smoke tests validate human status, expanded inspect and explicit JSON output. An exact
function-identity regression ensures the adapter shares host provider/serializer modules.

After the loader change, real auto/WebSocket validation passed three native generations,
11 requests, 8 socket reuses, 5 deltas, reconnect and session reopening; two tools ran,
with zero SSE fallback or WebSocket failures. See [validation-v0.3.0.json](validation-v0.3.0.json).

An initial require(ESM) adapter produced separate module-state observations under the
TypeScript loader and was rejected before release. Native ESM import fixed this; the
identity test and the successful live run guard against its recurrence.

## Migration verification (0.2.0)

Two isolated live runs over **auto/cached WebSocket** passed migration followed by
three native generations, per-generation replay, reconnect and session reopening:

- Text fixture: old summary plus Pi-retained and post-boundary history; **11 WS requests**.
- Old native-format fixture: a **real encrypted V2 response** wrapped in the audited old
  schema, then freshly compacted; **12 WS requests**, including the seed native request.

Both exercised normal/custom grammar tools; zero SSE fallbacks or WebSocket failures.
This validates the migration adapter against real provider state, **not** a claim that
an arbitrary historical user session has been migrated. No real user histories were edited.
Source provenance survived subsequent generations and reloads. Full JSONL checkpoint
validation ran at every generation. Evidence: [validation-migration.json](validation-migration.json).

```sh
PI_NATIVE_LIVE_TRANSPORT=auto PI_NATIVE_LIVE_TOOLS=1 PI_NATIVE_LIVE_MIGRATE=text npm run live
PI_NATIVE_LIVE_TRANSPORT=auto PI_NATIVE_LIVE_TOOLS=1 PI_NATIVE_LIVE_MIGRATE=native npm run live
```

Offline real-SDK migration tests assert failed remote requests leave identical file bytes,
stale late-hook writes cannot commit a checkpoint, ordinary compact requires explicit
migration, and automatic compaction takes over after migration without another command.

## Coverage limits / release discipline

This is bounded validation, not proof of unlimited-duration behavior. Large-context
real quota exhaustion, live image-heavy sessions and server-side TLS failures were not
deliberately induced. SSE and WebSocket failure cases are deterministic injected
transport-boundary tests; live WebSocket reconnects close idle sockets rather than
interrupting an active backend response. Production transport remains Pi-owned.
The WebSocket live harness uses isolated SDK AgentSessions, not the user's full set
of third-party extensions or a TUI interaction test.

Pi stops at its first terminal event: the collector detects duplicate terminal events
when observable, not bytes arriving after Pi has already ended the stream.
Process interruption is simulated at transaction/commit boundaries; this is not a
power-loss, fsync or real disk-full test.

The pre-append accessor and self-retaining null result are explicitly tested 1.0.0
contracts. Future Pi releases require this SDK suite before expanding compatibility.

## Audit answers

| Question                                    | Evidence / answer                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Duplicate Responses serializer?             | No. Public Pi provider + serializer parity fixtures.                                         |
| Network/partial output can compact history? | No proposal without successful terminal + exactly one validated item.                        |
| Concurrent/stale commit?                    | Single owner, snapshot checks, pre-append accessor and late-hook SDK test.                   |
| ctc_ becomes invalid function_call?         | Pi owns mapping; permanent ordinary/native parity assertions.                                |
| Text fallback reachable?                    | Native failures cancel; legacy migration requires explicit consent, with provenance.         |
| Restart loses native state?                 | JSONL-only recovery tested locally and live.                                                 |
| Replay duplicates/omits calls?              | Self-retaining boundary; one marker replaced; mixed tools exercised before/after boundaries. |
| Other provider receives opaque data?        | Only Codex wrapper injects it; identity validation and non-Codex abort.                      |
| Secrets in artifacts?                       | No payload/header dumps; recursive redaction + credential-echo tests.                        |
| Provider hammered during outage?            | Bounded retries, boundary cooldown, circuit breaker, deterministic latch.                    |
| Retry headroom?                             | Ratio-based soft/hard thresholds tested through real SDK usage.                              |
| Artificial continuation?                    | None; boundary and overflow use Pi's own lifecycle.                                          |
| Multiple generations?                       | 1,000 deterministic transactions, real SDK generations, six-generation live soak.            |
| Storage/power loss?                         | Limited by Pi synchronous JSONL append; no fsync guarantee.                                  |
