import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
/** A Git installation has no dist/devDependencies; Pi must load its TS source entry itself. */
test("source-only root entry loads without a build or package-local Pi peers", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-git-entry-"));
  const pkg = join(root, "pi-codex-native-compaction");
  try {
    for (const path of ["index.ts", "src", "package.json"])
      cpSync(join(process.cwd(), path), join(pkg, path), { recursive: true });
    assert(!existsSync(join(pkg, "dist")));
    // Git installation runs npm --omit=dev: only our small resolver dependency is needed.
    cpSync(
      join(process.cwd(), "node_modules/import-meta-resolve"),
      join(pkg, "node_modules/import-meta-resolve"),
      { recursive: true },
    );
    assert(!existsSync(join(pkg, "node_modules/@earendil-works")));
    const settings = SettingsManager.inMemory();
    const resources = new DefaultResourceLoader({
      cwd: root,
      agentDir: join(root, "agent"),
      settingsManager: settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [pkg],
    });
    await resources.reload();
    const loaded = resources.getExtensions();
    assert.equal(loaded.errors.length, 0, JSON.stringify(loaded.errors));
    assert.equal(loaded.extensions.length, 1);
    assert.equal(loaded.extensions[0]?.path, join(pkg, "index.ts"));
    const { session } = await createAgentSession({
      cwd: root,
      agentDir: join(root, "agent"),
      resourceLoader: resources,
      settingsManager: settings,
      sessionManager: SessionManager.inMemory(),
      tools: [],
    });
    const notices: string[] = [];
    const errors: unknown[] = [];
    await session.bindExtensions({
      onError(error) {
        errors.push(error);
      },
      // Only notify is exercised by this extension; no production UI is replaced.
      uiContext: {
        notify(message: string) {
          notices.push(message);
        },
      } as ExtensionUIContext,
    });
    await session.prompt("/native-compact status");
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert(
      notices.some((n) => n.startsWith("Codex Native Compaction v")),
      JSON.stringify({
        notices,
        commands: [...loaded.extensions[0]!.commands.keys()],
      }),
    );
    assert(
      !notices.some((n) => n.includes("Unsupported Pi API shape")),
      "Host capability lookup must work without package-local peers",
    );
    await session.prompt("/native-compact status --json");
    const json = notices
      .map((n) => {
        try {
          return JSON.parse(n);
        } catch {
          return undefined;
        }
      })
      .find((n) => n?.name === "pi-codex-native-compaction");
    assert(json && json.enabled && !json.disabled);
    session.dispose();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
