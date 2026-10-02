import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createExtension } from "../src/index.js";
import { Type, type Transport } from "@earendil-works/pi-ai";
import { transportProof } from "./transport-proof.js";
import { validateCheckpoint } from "../src/checkpoint.js";
import { MIGRATE_REQUEST } from "../src/migration.js";
// Existing Pi credentials only. No credential values are printed or copied.
const runtime = await ModelRuntime.create();
const auth = await runtime.checkAuth("openai-codex");
assert(
  auth?.type === "oauth",
  "Existing Pi Codex OAuth authentication unavailable",
);
const model = runtime.getModel("openai-codex", "gpt-6-astra");
assert(model, "gpt-6-astra missing");
const dir = mkdtempSync(join(tmpdir(), "pi-native-live-"));
const transport = (process.env.PI_NATIVE_LIVE_TRANSPORT ?? "sse") as Transport;
assert(["sse", "websocket", "websocket-cached", "auto"].includes(transport));
const proof = transportProof(transport);
const withTools = process.env.PI_NATIVE_LIVE_TOOLS === "1";
const migrate = process.env.PI_NATIVE_LIVE_MIGRATE;
assert(migrate === undefined || migrate === "text" || migrate === "native");
let toolExecutions = 0;
const generations = Number(process.env.PI_NATIVE_LIVE_GENERATIONS ?? 3);
assert(Number.isInteger(generations) && generations >= 3 && generations <= 6);
const settings = SettingsManager.inMemory({
  compaction: { enabled: false, keepRecentTokens: 0 },
  transport,
});
const make = async (manager: SessionManager) => {
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [
      createExtension({
        mode: "strict-debug",
        artifactRoot: join(dir, "diagnostics"),
      }),
      (pi) => {
        if (!withTools) return;
        const execute = async () => {
          toolExecutions++;
          return {
            content: [{ type: "text" as const, text: "amber-orchid-7349" }],
            details: {},
          };
        };
        pi.registerTool({
          name: "recall_marker",
          label: "recall_marker",
          description: "Returns the marker",
          parameters: Type.Object({}),
          execute,
        });
        pi.registerTool({
          name: "grammar_marker",
          label: "grammar_marker",
          description: "Accepts hello and returns the marker",
          parameters: Type.Object({ input: Type.String() }),
          constrainedSampling: {
            type: "grammar",
            variants: { openai_lark: 'start: "hello"' },
          },
          execute,
        });
      },
    ],
    systemPrompt:
      "You are a compact validation assistant. Remember the user's exact marker. Answer briefly. Use tools only when explicitly asked.",
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: runtime,
    model,
    thinkingLevel: "minimal",
    tools: withTools ? ["recall_marker", "grammar_marker"] : [],
    settingsManager: settings,
    sessionManager: manager,
    resourceLoader: loader,
  });
  await session.bindExtensions({});
  return session;
};
const resumeFile = process.env.PI_NATIVE_LIVE_RESUME_FILE;
let session = await make(
  resumeFile
    ? SessionManager.open(resumeFile, dir)
    : SessionManager.create(dir, dir),
);
const report: {
  directory: string;
  generations: unknown[];
  restart?: boolean;
  toolExecutions?: number;
  failure?: string;
  transportProof?: ReturnType<typeof proof.finish>;
  reconnect?: boolean;
  processResume?: boolean;
  resumedGeneration?: number;
  migration?: {
    kind: string;
    sourceEntryId: string;
    earlierLossNotRecovered: boolean;
  };
} = { directory: dir, generations: [] };
async function prompt(text: string) {
  await session.prompt(text);
  const last = session.messages.at(-1);
  assert(last?.role === "assistant");
  assert(last.stopReason === "stop", "Inference failed: " + last.stopReason);
  proof.check(session.sessionManager.getSessionId(), "inference");
  assert(
    last.content.some(
      (c) => c.type === "text" && c.text.includes("amber-orchid-7349"),
    ),
    "Marker not recovered",
  );
}
try {
  if (resumeFile) {
    const entry = session.sessionManager
      .getBranch()
      .findLast((e) => e.type === "compaction");
    assert(entry?.type === "compaction");
    report.resumedGeneration = validateCheckpoint(entry.details).generation;
    await prompt(
      "Without calling any tools, after this process restart, give the original exact marker.",
    );
    assert.equal(
      toolExecutions,
      0,
      "Process resume must recover state without marker tools",
    );
    report.processResume = true;
    report.restart = true;
  } else {
    await prompt(
      "Remember the exact marker amber-orchid-7349. " +
        (withTools
          ? "First call BOTH recall_marker and grammar_marker (input hello), then reply with just the marker."
          : "Reply with just the marker."),
    );
    if (withTools) assert(toolExecutions >= 2, "Both tools must execute");
    if (migrate) {
      const initialReply = session.messages.at(-1);
      assert(initialReply?.role === "assistant");
      const firstUser = session.sessionManager
        .getBranch()
        .find((e) => e.type === "message" && e.message.role === "user");
      assert(firstUser);
      let oldDetails: unknown;
      if (migrate === "native") {
        // A test-only legacy-shaped fixture backed by a REAL encrypted V2 response, not a fabricated blob.
        await session.compact();
        proof.check(session.sessionManager.getSessionId(), "seed-real-native");
        const entry = session.sessionManager
          .getBranch()
          .findLast((e) => e.type === "compaction");
        assert(entry?.type === "compaction");
        const c = validateCheckpoint(entry.details);
        oldDetails = {
          strategy: "openai-native-compact-v2",
          ...c.identity,
          compactedWindow: [...c.retained, c.compaction],
          createdAt: c.createdAt,
        };
      }
      const sourceEntryId = session.sessionManager.appendCompaction(
        migrate === "text"
          ? "## Goal\nRemember amber-orchid-7349 from the previous summarized context."
          : "[pi-better-compaction checkpoint]",
        firstUser.id,
        100,
        oldDetails,
      );
      session.sessionManager.appendMessage({
        role: "user",
        content: "Migration fixture tail: preserve the same exact marker.",
        timestamp: Date.now(),
      });
      session.sessionManager.appendMessage(structuredClone(initialReply));
      const file = session.sessionManager.getSessionFile();
      assert(file);
      session.dispose();
      session = await make(SessionManager.open(file, dir));
      report.migration = {
        kind: migrate === "text" ? "legacy-text" : "legacy-codex-v2",
        sourceEntryId,
        earlierLossNotRecovered: true,
      };
    }
    for (let generation = 1; generation <= generations; generation++) {
      const beforeCompact = proof.check(
        session.sessionManager.getSessionId(),
        "before-compaction-" + generation,
      );
      await session.compact(
        migrate && generation === 1 ? MIGRATE_REQUEST : undefined,
      );
      const afterCompact = proof.check(
        session.sessionManager.getSessionId(),
        "compaction-" + generation,
      );
      if (
        (transport === "auto" || transport === "websocket-cached") &&
        beforeCompact &&
        afterCompact &&
        !(migrate && generation === 1)
      ) {
        assert.equal(
          afterCompact.deltaRequests,
          beforeCompact.deltaRequests + 1,
          "Cached compaction must exercise a delta request",
        );
        assert.equal(
          afterCompact.lastDeltaInputItems,
          1,
          "Native delta must append only the compaction trigger",
        );
      }
      const entry = session.sessionManager
        .getBranch()
        .findLast((e) => e.type === "compaction");
      assert(entry?.type === "compaction");
      const checkpoint = validateCheckpoint(entry.details);
      assert.equal(checkpoint.generation, generation);
      if (report.migration) {
        assert.equal(
          checkpoint.migration?.sourceEntryId,
          report.migration.sourceEntryId,
        );
        assert.equal(checkpoint.migration?.kind, report.migration.kind);
        assert.equal(checkpoint.migration?.earlierLossNotRecovered, true);
      }
      const file = session.sessionManager.getSessionFile();
      assert(file);
      const disk = readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      assert(disk.some((e) => e.id === entry.id && e.type === "compaction"));
      const beforeTools = toolExecutions;
      await prompt(
        "What exact marker did I ask you to remember? Reply only with that marker.",
      );
      assert.equal(
        toolExecutions,
        beforeTools,
        "Replay must recover memory, not call the marker tool",
      );
      if (afterCompact) {
        const afterReplay = proof.check(
          session.sessionManager.getSessionId(),
          "after-replay-" + generation,
        )!;
        assert.equal(
          afterReplay.fullContextRequests,
          afterCompact.fullContextRequests + 1,
          "Changed checkpoint must reset to full context, not stale previous_response_id",
        );
      }
      report.generations.push({
        generation,
        responseId: checkpoint.responseId,
        encryptedBytes: Buffer.byteLength(
          String(checkpoint.compaction.encrypted_content),
        ),
        replay: true,
      });
      console.log(JSON.stringify({ generation, ok: true }));
    }
    if (transport !== "sse") {
      const before = proof.check(
        session.sessionManager.getSessionId(),
        "before-reconnect",
      )!;
      assert(
        before.connectionsReused > 0,
        "Connection reuse was not exercised",
      );
      proof.reconnect(session.sessionManager.getSessionId());
      await prompt("Without calling tools, repeat the original exact marker.");
      const after = proof.check(
        session.sessionManager.getSessionId(),
        "after-reconnect",
      )!;
      assert(
        after.connectionsCreated > before.connectionsCreated,
        "Fresh connection was not exercised",
      );
      report.reconnect = true;
    }
    const file = session.sessionManager.getSessionFile();
    assert(file);
    session.dispose();
    session = await make(SessionManager.open(file, dir));
    await prompt("After restart, give the same exact marker.");
    report.restart = true;
  }
} catch (error) {
  // Do not echo arbitrary provider bodies in public output.
  report.failure = error instanceof Error ? error.name : "unknown";
  throw error;
} finally {
  session.dispose();
  report.toolExecutions = toolExecutions;
  report.transportProof = proof.finish(session.sessionManager.getSessionId());
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(report));
}
