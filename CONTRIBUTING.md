# Contributing

## Scope

This project is deliberately specific to Pi 1.0.x, openai-codex and Remote Compaction V2.
Do not add a parallel Responses serializer, text-summary fallback, another provider,
or a second credential configuration.

## Development

Use Node 24+ and npm with the committed lockfile.

```sh
git clone https://github.com/jacek4yang/pi-codex-native-compaction.git
cd pi-codex-native-compaction
npm ci
npm run check
npm run format:check
npm run smoke:install -- .
```

Tests are offline and use fake credentials except the explicitly invoked live harness.
See [TESTING.md](docs/TESTING.md) for bounded OAuth-based live testing.
Never run live tests in a user's production session.

## Changes

Create a branch, add focused regressions, update relevant documentation, and open a PR.
Keep authentication, session persistence, native protocol, replay and UI concerns separate.
Use Pi's public exports; if a loader adapter is required, test peerless Git installation.

Main is protected: PR required, strict `verify` CI, resolved conversations, linear
history and administrator enforcement. Force pushes and deletion are disabled.
The current single-maintainer setup requires **zero external approving reviews**:
this avoids an impossible self-approval gate, but is not a claim of independent review.
Squash merge after checks pass; do not use administrative bypass.

## Releases

See [RELEASING.md](docs/RELEASING.md). Version changes must update package.json,
package-lock.json, src/version.ts and CHANGELOG.md; tests enforce version consistency.
Do not publish to npm or imply Pi gallery availability without completing those gates.

## Privacy

Only artificial fixtures and sanitized metadata belong in Git.
Never commit credentials, private prompts, encrypted checkpoints, real session JSONL,
debug archives or machine-specific backup paths.
