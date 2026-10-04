# Changelog

## 0.3.4

- Pi 1.0.2 tested floor; accept stable ~1.0.2 patches, preserving API/state guards.
- Route local hard-limit failures through Pi compact-and-retry; do not checkpoint failed turns before Pi classifies them.
- Retry terminated/UND_ERR transport failures; bound the whole native attempt (including response body) to configurable requestTimeoutMs (default 300000, max 900000). Existing maxRetries/circuit limits remain.
- Two-line phase/elapsed/attempt/retry/quiet/input/event widget and bounded whitelist-only last-attempt sidecar. /native-compact inspect exposes safe metadata across restart.

## 0.3.3 — Pi 1.0.1 baseline

- Require Pi 1.0.1; align public version guard, SDK peers and development lockfile.
- Reverify all 135 regressions and isolated package loading without changing compaction policy.

## 0.3.2 — Provider and session isolation

- Let unrelated providers/APIs use Pi's own inference and manual/automatic compaction.
- Identify only the active owned native boundary, not arbitrary or historical strategy metadata.
- Abort incompatible native-context continuation before transport without weakening replay validation.
- Reset runtime state on model/tree/session changes; prevent stale async compaction failures from poisoning the new scheduler.
- Keep native replay when generation is paused, but allow normal Pi compaction when no owned checkpoint exists.
- Add explicit inactive/blocked status and twenty real-SDK isolation scenarios, repeated against installed packages.

## 0.3.1 — Checkpoint ownership and GitHub release

- Isolate independent provider requests from the main session's checkpoint, policy,
  system transcript and pressure gates; retain strict main replay identity checks.
- Add hashed request-scope diagnostics and real SDK mixed-model/pruner regressions.
- Fix source-only CLI host resolution through Pi's public package-root API.
- Document the companion pruner boundary/retry patch and bounded long-session evidence.
- Follow Pi’s external host-peer convention and verify interoperability with upstream pi-context-prune 2.1.0 in CI.
- Provide pinned Git installation and checksummed GitHub release artifacts. npm publication remains deferred.

## 0.3.0 — GitHub-first release

- Compact human-readable status and expanded inspect output; explicit `--json` for automation.
- Root TypeScript package entry fixes the misleading `dist` startup label.
- Git installs work without a compiler/build or package-local Pi peer copies.
- Small public-export adapter handles Pi 1.0's Jiti subpath-alias limitation.
- GitHub metadata, protected-main/PR workflow, CI, issue templates, contributor/security
  guidance and future npm/Pi gallery release checklist.
- Existing Native V2 protocol, transactional checkpoints, migration and replay retained.

## 0.2.0 — Local migration release

- Explicit legacy text and audited Codex V2 migration, with durable provenance.
- Migration failure/stale-result safeguards and automatic native continuation afterward.
- Local and live WebSocket migration validation. Not published to npm.

## 0.1.0 — Local initial release

- Pi-owned Codex transport/serialization, strict V2 collection, transactional checkpoint,
  replay, retry/circuit policy, proactive boundaries and diagnostics.
- SSE and WebSocket validation, including repeated checkpoints and resumed sessions.
- Local release only; not an npm/gallery publication.
