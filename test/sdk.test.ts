import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { zstdDecompressSync } from "node:zlib";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createExtension } from "../src/index.js";
import { MIGRATE_REQUEST } from "../src/migration.js";
import { assistant } from "./fixtures.js";
import { Type, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { SENTINEL, validateCheckpoint } from "../src/checkpoint.js";
import { events, jwt, model, compactItem } from "./fixtures.js";
for (const scenario of [
  "manual",
  "automatic",
  "late-head",
  "overflow",
  "soft-fail",
  "hard-fail",
  "automatic-tools",
  "packaged",
  "policy",
  "input-rewrite",
  "legacy",
  "migrate-text",
  "migrate-native",
  "migrate-failed",
  "migrate-stale",
  "migrate-command",
  "migrate-auto",
] as const)
  test("real Pi 1.0 SDK: " + scenario, async () => {
    const automatic = scenario.startsWith("automatic");
    const packaged =
      scenario === "packaged" ||
      Boolean(
        process.env.PI_NATIVE_TEST_EXTENSION && scenario.startsWith("migrate-"),
      );
    let mutateLate = false;
    let overflowOnce = scenario === "overflow";
    let toolsOnce = scenario === "automatic-tools";
    let toolExecutions = 0;
    let migratedAuto = false;
    let migrationCommitted: (() => void) | undefined;
    const recovery: { reason: string; willRetry: boolean }[] = [];
    const dir = mkdtempSync(join(tmpdir(), "native-sdk-"));
    const payloads: Record<string, unknown>[] = [];
    let fail = false;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      let bytes = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "zstd")
        bytes = zstdDecompressSync(bytes);
      const body = JSON.parse(bytes.toString()) as {
        input: Record<string, unknown>[];
      };
      payloads.push(body);
      if (fail) {
        res.writeHead(400);
        res.end('{"error":{"message":"test invalid request"}}');
        return;
      }
      const compact = body.input.some((i) => i.type === "compaction_trigger");
      if (overflowOnce && !compact) {
        overflowOnce = false;
        res.writeHead(400);
        res.end(
          '{"error":{"code":"context_length_exceeded","message":"Your input exceeds the context window of this model"}}',
        );
        return;
      }
      if (compact && scenario.endsWith("-fail")) {
        res.writeHead(503);
        res.end('{"error":{"message":"temporary outage"}}');
        return;
      }
      const useTools = !compact && toolsOnce;
      if (useTools) toolsOnce = false;
      const output = useTools
        ? [
            {
              type: "function_call",
              id: "fc_sdk",
              call_id: "call_sdk",
              name: "normal",
              arguments: '{"x":"test"}',
            },
            {
              type: "custom_tool_call",
              id: "ctc_sdk",
              call_id: "call_custom",
              name: "grammar",
              input: "hello",
            },
          ]
        : compact
          ? [{ ...compactItem, id: "cmp_" + payloads.length }]
          : [
              {
                type: "message",
                id: "msg_" + payloads.length,
                role: "assistant",
                phase: "final_answer",
                content: [
                  { type: "output_text", text: "amber-42", annotations: [] },
                ],
              },
            ];
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Include added events so Pi creates the assistant's text block.
      if (!compact)
        for (const [index, item] of output.entries())
          res.write(
            "data: " +
              JSON.stringify({
                type: "response.output_item.added",
                output_index: index,
                item: useTools ? item : { ...item, content: [] },
              }) +
              "\n\n",
          );
      if (!compact && !useTools)
        res.write(
          "data: " +
            JSON.stringify({
              type: "response.content_part.added",
              output_index: 0,
              content_index: 0,
              part: { type: "output_text", text: "", annotations: [] },
            }) +
            "\n\n",
        );
      if (!compact && !useTools)
        res.write(
          "data: " +
            JSON.stringify({
              type: "response.output_text.delta",
              output_index: 0,
              content_index: 0,
              delta: "amber-42",
            }) +
            "\n\n",
        );
      for (const event of events(output)) {
        if (
          (scenario.endsWith("-fail") ||
            (scenario === "migrate-auto" && migratedAuto && !compact)) &&
          (event as { type: string }).type === "response.completed"
        ) {
          const e = event as { response: { usage: unknown } };
          const input = Math.floor(
            model.contextWindow *
              (scenario === "soft-fail" || scenario === "migrate-auto"
                ? 0.8
                : 0.9),
          );
          e.response.usage = {
            input_tokens: input,
            output_tokens: 1,
            total_tokens: input + 1,
          };
        }
        res.write("data: " + JSON.stringify(event) + "\n\n");
      }
      res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      assert(address && typeof address !== "string");
      const credentials = new InMemoryCredentialStore();
      await credentials.modify("openai-codex", async () => ({
        type: "oauth",
        access: jwt,
        refresh: "test",
        expires: Date.now() + 86400000,
      }));
      const local = {
        ...model,
        baseUrl: "http://127.0.0.1:" + address.port + "/backend-api",
      };
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          providers: { "openai-codex": { baseUrl: local.baseUrl } },
        }),
      );
      const runtime = await ModelRuntime.create({
        credentials,
        modelsPath: join(dir, "config.json"),
        modelsStorePath: join(dir, "models.json"),
      });
      const settings = SettingsManager.inMemory({
        compaction: {
          enabled: scenario === "overflow",
          keepRecentTokens: 0,
          reserveTokens: 1000,
        },
        transport: "sse",
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
          additionalExtensionPaths: packaged
            ? [
                process.env.PI_NATIVE_TEST_EXTENSION ??
                  join(process.cwd(), "dist/index.js"),
              ]
            : [],
          extensionFactories: [
            ...(packaged
              ? []
              : [
                  createExtension({
                    retryBaseDelayMs: 0,
                    ...(automatic ? { softThresholdRatio: 0.00000001 } : {}),
                  }),
                ]),
            (pi) => {
              pi.on("before_provider_request", (e, c) => {
                assert.equal(c.model?.baseUrl, local.baseUrl);
                const p = e.payload as Record<string, unknown>;
                if (scenario === "policy")
                  return {
                    ...p,
                    service_tier: "priority",
                    parallel_tool_calls: false,
                    reasoning: { effort: "low", summary: "auto" },
                  };
                if (scenario === "input-rewrite")
                  return {
                    ...p,
                    input: [
                      ...(p.input as unknown[]),
                      {
                        role: "user",
                        content: [
                          { type: "input_text", text: "untracked context" },
                        ],
                      },
                    ],
                  };
              });
              pi.on("session_compact", () => migrationCommitted?.());
              pi.on("session_before_compact", (e) => {
                recovery.push({ reason: e.reason, willRetry: e.willRetry });
                if (mutateLate) pi.appendEntry("late-writer", { test: true });
              });
              if (scenario === "automatic-tools") {
                const execute = async () => {
                  toolExecutions++;
                  return {
                    content: [{ type: "text" as const, text: "tool-ok" }],
                    details: {},
                  };
                };
                pi.registerTool({
                  name: "normal",
                  label: "normal",
                  description: "normal",
                  parameters: Type.Object({ x: Type.String() }),
                  execute,
                });
                pi.registerTool({
                  name: "grammar",
                  label: "grammar",
                  description: "grammar",
                  parameters: Type.Object({ input: Type.String() }),
                  constrainedSampling: {
                    type: "grammar",
                    variants: { openai_lark: 'start: "hello"' },
                  },
                  execute,
                });
              }
            },
          ],
          systemPrompt: "Remember the user code. Answer briefly.",
        });
        await loader.reload();
        const { session } = await createAgentSession({
          cwd: dir,
          agentDir: dir,
          modelRuntime: runtime,
          model: local,
          settingsManager: settings,
          sessionManager: manager,
          resourceLoader: loader,
          tools: scenario === "automatic-tools" ? ["normal", "grammar"] : [],
        });
        await session.bindExtensions({
          onError: (e) => {
            throw new Error(JSON.stringify(e));
          },
        });
        if (scenario === "automatic-tools")
          session.setActiveToolsByName(["normal", "grammar"]);
        return session;
      };
      let session = await make(SessionManager.create(dir, dir));
      await session.prompt("remember amber-42");
      const lastEntry = session.sessionManager
        .getBranch()
        .findLast(
          (e) => e.type === "message" && e.message.role === "assistant",
        );
      assert(lastEntry?.type === "message");
      const last = lastEntry.message;
      assert(last.role === "assistant");
      assert.equal(last.stopReason, "stop", last.errorMessage);
      assert(payloads.length > 0);
      let migrationSource: string | undefined;
      if (scenario.startsWith("migrate-")) {
        const userEntry = session.sessionManager
          .getBranch()
          .find((e) => e.type === "message" && e.message.role === "user");
        assert(userEntry);
        const native = scenario === "migrate-native";
        migrationSource = session.sessionManager.appendCompaction(
          native
            ? "[pi-better-compaction checkpoint]"
            : "## Goal\nRemember amber-42 from the old summary.",
          userEntry.id,
          100,
          native
            ? {
                strategy: "openai-native-compact-v2",
                provider: local.provider,
                api: local.api,
                model: local.id,
                baseUrl: local.baseUrl,
                compactedWindow: [
                  {
                    role: "user",
                    content: [
                      { type: "input_text", text: "legacy-native-retained" },
                    ],
                  },
                  compactItem,
                ],
                createdAt: new Date().toISOString(),
              }
            : undefined,
        );
        session.sessionManager.appendMessage({
          role: "user",
          content: "post-migration-boundary-tail",
          timestamp: Date.now(),
        });
        session.sessionManager.appendMessage(
          assistant([{ type: "text", text: "post-boundary reply" }]),
        );
        const file = session.sessionManager.getSessionFile();
        assert(file);
        session.dispose();
        session = await make(SessionManager.open(file, dir));
        const before = readFileSync(file, "utf8"),
          head = session.sessionManager.getLeafId();
        const count = payloads.length;
        await assert.rejects(session.compact());
        assert.equal(payloads.length, count);
        assert.equal(readFileSync(file, "utf8"), before);
        assert.equal(session.sessionManager.getLeafId(), head);
        fail = scenario === "migrate-failed";
        mutateLate = scenario === "migrate-stale";
        if (fail || mutateLate) {
          await assert.rejects(session.compact(MIGRATE_REQUEST));
          assert.equal(
            session.sessionManager
              .getBranch()
              .filter((e) => e.type === "compaction").length,
            1,
          );
          if (fail) {
            assert.equal(readFileSync(file, "utf8"), before);
            assert.equal(session.sessionManager.getLeafId(), head);
          }
          session.dispose();
          return;
        }
        if (scenario === "migrate-command") {
          const committed = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Migration command did not commit")),
              5000,
            );
            migrationCommitted = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          await session.prompt("/native-compact migrate");
          await committed;
          await yieldTurn(); // Pi finishes its async compaction handler after emitting session_compact.
          migrationCommitted = undefined;
        } else await session.compact(MIGRATE_REQUEST);
        const input = payloads.at(-1)?.input as Record<string, unknown>[];
        const serialized = JSON.stringify(input);
        assert.equal(
          input.filter((i) => i.type === "compaction").length,
          native ? 1 : 0,
        );
        assert.equal(
          serialized.split("post-migration-boundary-tail").length - 1,
          1,
        );
        if (native) {
          assert(!serialized.includes("[pi-better-compaction"));
          assert(!serialized.includes("remember amber-42"));
          assert(serialized.includes("legacy-native-retained"));
        } else {
          assert(serialized.includes("## Goal"));
          assert.equal(serialized.split("remember amber-42").length - 1, 1);
        }
        migratedAuto = scenario === "migrate-auto";
        await session.prompt("What is the code?");
        if (migratedAuto) {
          for (const generation of [2, 3]) {
            const cp = session.sessionManager
              .getBranch()
              .findLast((e) => e.type === "compaction");
            assert(cp?.type === "compaction");
            const details = validateCheckpoint(cp.details);
            assert.equal(details.generation, generation);
            assert.equal(details.migration?.sourceEntryId, migrationSource);
            if (generation === 2)
              await session.prompt("Continue automatically.");
          }
          session.dispose();
          return;
        }
      }
      if (scenario === "legacy") {
        session.sessionManager.appendCompaction(
          "## Goal\nOld lossy summary",
          null,
          1,
        );
        const head = session.sessionManager.getLeafId(),
          count = payloads.length;
        await assert.rejects(session.compact());
        assert.equal(session.sessionManager.getLeafId(), head);
        await session.prompt("Cannot promote a lossy boundary.");
        assert.equal(payloads.length, count + 1); // Existing text continuity may continue; no silent migration.
        session.dispose();
        return;
      }
      if (scenario === "input-rewrite") {
        const head = session.sessionManager.getLeafId();
        await assert.rejects(session.compact());
        assert.equal(session.sessionManager.getLeafId(), head);
        session.dispose();
        return;
      }
      if (scenario === "overflow") {
        assert(recovery.some((r) => r.reason === "overflow" && r.willRetry));
        assert.equal(
          session.sessionManager
            .getBranch()
            .filter((e) => e.type === "message" && e.message.role === "user")
            .length,
          1,
        );
      }
      if (scenario === "late-head") {
        mutateLate = true;
        const before = session.sessionManager
          .getBranch()
          .filter((e) => e.type === "compaction").length;
        await assert.rejects(session.compact());
        assert.equal(
          session.sessionManager
            .getBranch()
            .filter((e) => e.type === "compaction").length,
          before,
        );
        mutateLate = false;
      }
      if (scenario.endsWith("-fail")) {
        const requests = payloads.length;
        assert.equal(
          session.sessionManager
            .getBranch()
            .filter((e) => e.type === "compaction").length,
          0,
        );
        await session.prompt("continue");
        assert.equal(
          payloads.length,
          requests + (scenario === "soft-fail" ? 1 : 0),
        );
        session.dispose();
        return;
      }
      if (scenario === "automatic-tools") {
        assert.equal(
          toolExecutions,
          2,
          JSON.stringify(
            session.sessionManager
              .getBranch()
              .filter((e) => e.type === "message")
              .map((e) => (e.type === "message" ? e.message : null)),
          ),
        );
        assert(
          payloads.some((p) =>
            (p.input as Record<string, unknown>[]).some(
              (i) => i.type === "custom_tool_call_output",
            ),
          ),
        );
      }
      // A tool turn can compact before its final assistant turn, producing two safe generations.
      const initial = session.sessionManager
        .getBranch()
        .filter((e) => e.type === "compaction").length;
      for (let step = 1; step <= 3; step++) {
        const generation =
          step +
          (automatic ? Math.max(0, initial - 1) : 0) +
          (migrationSource ? 1 : 0);
        if (!automatic && !(scenario === "overflow" && step === 1)) {
          const result = await session.compact();
          assert.equal(result.summary, SENTINEL);
        }
        if (scenario === "policy") {
          const p = payloads.at(-1);
          assert.equal(p?.service_tier, "priority");
          assert.equal(p?.parallel_tool_calls, false);
          assert.deepEqual(p?.reasoning, { effort: "low", summary: "auto" });
        }
        const entry = session.sessionManager
          .getBranch()
          .findLast((e) => e.type === "compaction");
        assert(entry?.type === "compaction");
        assert.equal(entry.firstKeptEntryId, entry.id);
        const verified = validateCheckpoint(entry.details);
        assert.equal(verified.generation, generation);
        if (migrationSource) {
          assert.equal(verified.migration?.sourceEntryId, migrationSource);
          assert.equal(verified.migration?.earlierLossNotRecovered, true);
        }
        await session.prompt("What is the code?");
        const input = payloads.at(-1)?.input as Record<string, unknown>[];
        assert.equal(input.filter((i) => i.type === "compaction").length, 1);
        assert(!JSON.stringify(input).includes(SENTINEL));
      }
      const file = session.sessionManager.getSessionFile();
      assert(file);
      const disk = readFileSync(file, "utf8");
      assert(disk.includes('"strategy":"codex-remote-compaction-v2"'));
      session.dispose();
      session = await make(SessionManager.open(file, dir));
      await session.prompt("Repeat the code once.");
      assert.equal(
        (payloads.at(-1)?.input as Record<string, unknown>[]).filter(
          (i) => i.type === "compaction",
        ).length,
        1,
      );
      const head = session.sessionManager.getLeafId();
      const before = readFileSync(file, "utf8");
      fail = true;
      await assert.rejects(session.compact());
      assert.equal(session.sessionManager.getLeafId(), head);
      assert.equal(readFileSync(file, "utf8"), before);
      session.dispose();
      if (scenario === "packaged") {
        const entries = before
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        const checkpointEntry = entries.findLast(
          (e) => e.type === "compaction",
        );
        assert(checkpointEntry);
        (checkpointEntry.details as Record<string, unknown>).responseId =
          "corrupted";
        writeFileSync(
          file,
          entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
        );
        session = await make(SessionManager.open(file, dir));
        const count = payloads.length;
        await session.prompt("This must not reach the network.");
        assert.equal(payloads.length, count);
        const last = session.messages.at(-1);
        assert(last?.role === "assistant" && last.stopReason === "error");
        session.dispose();
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
