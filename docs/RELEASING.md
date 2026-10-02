# Release process

## Stage 1: GitHub (current)

1. Work on a branch; update version/lockfile/runtime version/changelog together.
2. Run `npm ci && npm run check && npm run format:check`.
3. Validate peerless source loading, packaged installation and RPC status rendering.
4. If protocol/runtime integration changed, run bounded existing-OAuth live validation;
   record sanitized metadata and explicitly disclose remaining limitations.
5. Review Git and tarball contents for private data.
6. Open a PR. Wait for protected-main `verify` checks; squash merge without bypass.
7. Tag the merged commit, publish GitHub release notes and attach the npm tarball plus SHA-256.
8. Verify the public tag, downloadable artifact and the documented Git installation.

```sh
pi install git:github.com/jacek4yang/pi-codex-native-compaction
# Reproducible release installation:
pi install git:github.com/jacek4yang/pi-codex-native-compaction@v0.3.1
```

Root index.ts loads source through Pi; Git installation needs no devDependencies or build.
Only normal production dependencies are installed. The compiled dist export remains
available in npm tarballs for programmatic consumers.

## Stage 2: npm (not published yet)

- Confirm ownership/name availability, account security and the intended npm package scope.
- Configure npm trusted publishing from the exact GitHub repository/workflow/environment,
  or an appropriately protected interactive publish process.
- Require reviewed release changes, validate provenance, and inspect `npm pack --dry-run`.
- Verify the resulting package version, integrity, repository/author/license/files and
  clean installation before calling npm publication complete.
- Do not introduce a stored publish token or enable publication on arbitrary PRs.

Prefer GitHub Actions OIDC trusted publishing on a supported GitHub-hosted runner.
Use an exact repository/workflow mapping and a protected publishing environment.
Keep package ownership/account 2FA and main-branch protections enabled. Recheck npm's
current first-publication bootstrap requirements: creating a GitHub release does
not reserve an npm name or automatically configure a trusted publisher.

For the later publication task, provide only the intended npm username/package scope
and confirm package ownership. Do not paste passwords, recovery codes or npm tokens
into chat. If an initial interactive publish is required, authenticate locally.

After publication the intended installation will be:

```sh
# Future only: this npm package has NOT been published.
pi install npm:pi-codex-native-compaction
```

The manifest is prepared with repository, bugs, homepage, author, types, keywords,
public access and provenance metadata. These fields do not themselves publish anything.

## Stage 3: Pi package gallery (not published yet)

Pi's current [authoring guidance](https://github.com/earendil-works/pi) says the gallery at
https://pi.dev/packages discovers npm packages with the `pi-package` keyword. The manifest
also has `pi.extensions` and optional `pi.image` preview metadata.

After npm publication, verify actual discovery/listing and displayed install instructions.
Do not claim gallery publication merely because the keyword exists. Recheck current
official guidance at release time; discovery is external and may not be immediate.
