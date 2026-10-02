# Changelog

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
