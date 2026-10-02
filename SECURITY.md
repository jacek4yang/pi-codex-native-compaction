# Security policy

## Supported version

Security fixes target the latest tagged release on the Pi **1.0.x** compatibility line.
Older extension releases may require an update. Compatibility beyond Pi 1.0.x is not claimed.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/jacek4yang/pi-codex-native-compaction/security/advisories/new).
Do not file a public issue containing credentials or sensitive session history.
This is a volunteer-maintained project; no response-time SLA is promised.

Include versions, a minimal redacted reproduction, transport, and the affected invariant.
Never include OAuth access/refresh tokens, cookies, auth.json, raw session JSONL,
encrypted_content, full provider payloads, or private repository content.

## Boundaries

The extension handles provider-native state with the same trust as Pi session history.
Opaque does not mean safe to publish. Protect session files and diagnostic directories.
The integrity digest detects corruption, not malicious edits by a writer of the JSONL.

No telemetry or independent authentication service is added. Requests use Pi's existing
Codex credentials and transport. Diagnostic artifacts are opt-in and redacted.
Storage durability, other extensions, and concurrent processes remain documented limits;
see [FAILURE_MODEL.md](docs/FAILURE_MODEL.md).

## Supply chain

GitHub CI uses pinned action commits and read-only permissions. Main requires a PR and
passing checks; force pushes/deletion are disabled. Runtime Pi peers are resolved from
the host rather than bundled into Git installations. A small import resolver handles
Pi 1.0's public-subpath loader limitation.

No npm publishing workflow is enabled in this GitHub-first release.
