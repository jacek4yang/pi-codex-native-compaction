import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { zstdDecompressSync } from "node:zlib";
import {
  createAgentSession,
  AgentSessionRuntime,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import { createExtension } from "../src/index.js";
import { hash, identity, seal, SENTINEL, STRATEGY } from "../src/checkpoint.js";
import { assistant, compactItem, events, jwt, model } from "./fixtures.js";

for (const scenario of [
  "fresh",
  "query-endpoint",
  "foreign-summary",
  "own",
  "legacy",
  "superseded",
  "paused",
  "switch-back",
  "api-mismatch",
  "fresh-api",
  "noncodex-codexapi",
  "paused-codex",
  "paused-own",
  "corrupt-own",
  "late-rewrite",
  "new-session",
  "tree",
  "automatic",
  "inflight-switch",
  "inflight-manual",
] as const)
  test("provider isolation: " + scenario, async () => {
    const dir = mkdtempSync(join(tmpdir(), "native-provider-isolation-"));
    const previousConfig = process.env.PI_CODEX_NATIVE_COMPACTION;
    process.env.PI_CODEX_NATIVE_COMPACTION = JSON.stringify({
      enabled: !["paused", "paused-codex", "paused-own"].includes(scenario),
      softThresholdRatio: 0.01,
      hardThresholdRatio: 0.02,
    });
    const payloads: Record<string, unknown>[] = [];
    const notices: string[] = [],
      errors: string[] = [];
    let sawNative!: () => void;
    let releaseNative!: () => void;
    const nativeSeen = new Promise<void>((resolve) => {
      sawNative = resolve;
    });
    const nativeRelease = new Promise<void>((resolve) => {
      releaseNative = resolve;
    });
    const server = createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(426);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      let bytes = Buffer.concat(chunks);
      if (req.headers["content-encoding"] === "zstd")
        bytes = zstdDecompressSync(bytes);
      payloads.push(
        JSON.parse(bytes.toString("utf8")) as Record<string, unknown>,
      );
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (
        scenario.startsWith("inflight-") &&
        (payloads.at(-1)?.input as { type?: string }[]).some(
          (i) => i.type === "compaction_trigger",
        )
      ) {
        sawNative();
        await nativeRelease;
        for (const event of events())
          res.write("data: " + JSON.stringify(event) + "\n\n");
        res.end();
        return;
      }
      const tail = events([
        {
          type: "message",
          role: "assistant",
          id: "msg_fixture",
          content: [
            { type: "output_text", text: "Portable summary: amber-42" },
          ],
        },
      ]);
      if (
        ["automatic", "inflight-switch"].includes(scenario) &&
        payloads.length === 1
      )
        (tail.at(-1)! as { response: Record<string, unknown> }).response.usage =
          {
            input_tokens: scenario === "inflight-switch" ? 1000000 : 90,
            output_tokens: 10,
          };
      for (const event of [
        {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            type: "message",
            role: "assistant",
            id: "msg_fixture",
            content: [],
          },
        },
        {
          type: "response.content_part.added",
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "" },
        },
        {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 0,
          delta: "Portable summary: amber-42",
        },
        ...tail,
      ])
        res.write("data: " + JSON.stringify(event) + "\n\n");
      res.end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let dispose: (() => void) | undefined;
    try {
      const address = server.address();
      assert(address && typeof address !== "string");
      const baseUrl = "http://127.0.0.1:" + address.port;
      const codex = { ...model, baseUrl: baseUrl + "/backend-api" };
      const other: Model<"openai-responses" | "openai-codex-responses"> = {
        ...model,
        provider: ["api-mismatch", "fresh-api"].includes(scenario)
          ? "openai-codex"
          : "openai",
        api:
          scenario === "noncodex-codexapi"
            ? "openai-codex-responses"
            : "openai-responses",
        baseUrl:
          baseUrl +
          (scenario === "query-endpoint" ? "/v1?subscription=test" : "/v1"),
      };
      if (scenario === "automatic") other.contextWindow = 100;
      const credentials = new InMemoryCredentialStore();
      await credentials.modify("openai", async () => ({
        type: "api_key",
        key: jwt,
      }));
      await credentials.modify("openai-codex", async () => ({
        type: "oauth",
        access: jwt,
        refresh: "test",
        expires: Date.now() + 86400000,
      }));
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          providers: {
            openai: {
              baseUrl: other.baseUrl,
              models: [{ ...other, provider: "openai", name: other.id }],
            },
            "openai-codex": {
              baseUrl: codex.baseUrl,
              ...(["api-mismatch", "fresh-api"].includes(scenario)
                ? { models: [{ ...other, name: other.id }] }
                : {}),
            },
          },
        }),
      );
      const runtime = await ModelRuntime.create({
        credentials,
        modelsPath: join(dir, "config.json"),
        modelsStorePath: join(dir, "models.json"),
      });
      const manager = SessionManager.inMemory();
      manager.appendMessage({
        role: "user",
        content: "remember amber-42",
        timestamp: 1,
      });
      manager.appendMessage(assistant([{ type: "text", text: "amber-42" }]));
      const cleanHead = manager.getLeafId()!;
      if (
        [
          "tree",
          "own",
          "legacy",
          "superseded",
          "switch-back",
          "api-mismatch",
          "paused-own",
          "corrupt-own",
          "late-rewrite",
          "new-session",
        ].includes(scenario)
      ) {
        const cp = seal({
          schemaVersion: 1,
          strategy: STRATEGY,
          protocolVersion: 2,
          identity: identity(codex),
          sessionId: manager.getSessionId(),
          headId: manager.getLeafId(),
          generation: 1,
          createdAt: new Date().toISOString(),
          responseId: "fixture",
          requestFingerprint: hash("fixture"),
          retained: [],
          compaction: compactItem,
          window: { inputItems: 2, inputHash: hash("input") },
        });
        const details =
          scenario === "legacy"
            ? {
                strategy: "openai-native-compact-v2",
                ...cp.identity,
                compactedWindow: [compactItem],
              }
            : scenario === "corrupt-own"
              ? { ...cp, integrity: "tampered" }
              : cp;
        manager.appendCompaction(
          scenario === "legacy" ? "[legacy native]" : SENTINEL,
          null as unknown as string,
          1000,
          details,
        );
      }
      if (scenario === "foreign-summary" || scenario === "superseded")
        manager.appendCompaction(
          "Portable summary: amber-42",
          null as unknown as string,
          1000,
          {
            strategy: "another-extension-summary",
            compactedWindow: "not ours",
          },
        );
      const settings = SettingsManager.inMemory({
        transport: "sse",
        compaction: {
          enabled: scenario === "automatic",
          keepRecentTokens: 0,
          reserveTokens: scenario === "automatic" ? 20 : 1000,
        },
      });
      const observer: ExtensionFactory = (pi) => {
        pi.on("session_start", (_e, ctx) => {
          ctx.ui.notify = (message) => {
            notices.push(message);
          };
        });
        pi.on("before_provider_request", (event) => ({
          ...(event.payload as object),
          foreign_hook: "kept",
        }));
      };
      const loader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        settingsManager: settings,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: process.env.PI_NATIVE_TEST_EXTENSION
          ? [process.env.PI_NATIVE_TEST_EXTENSION]
          : [],
        extensionFactories: [
          observer,
          ...(process.env.PI_NATIVE_TEST_EXTENSION
            ? []
            : [
                createExtension({
                  enabled: !["paused", "paused-codex", "paused-own"].includes(
                    scenario,
                  ),
                  softThresholdRatio: 0.01,
                  hardThresholdRatio: 0.02,
                }),
              ]),
          ...(scenario === "late-rewrite"
            ? [
                ((pi) => {
                  pi.on("before_provider_request", () => ({
                    model: model.id,
                    input: [{ role: "user", content: "overwritten" }],
                    stream: true,
                  }));
                }) as ExtensionFactory,
              ]
            : []),
        ],
        systemPrompt: "Answer briefly.",
      });
      await loader.reload();
      const { session } = await createAgentSession({
        cwd: dir,
        agentDir: dir,
        modelRuntime: runtime,
        model: [
          "paused-codex",
          "paused-own",
          "inflight-switch",
          "inflight-manual",
        ].includes(scenario)
          ? codex
          : other,
        sessionManager: manager,
        settingsManager: settings,
        resourceLoader: loader,
        tools: [],
      });
      dispose = () => session.dispose();
      await session.bindExtensions({
        onError: (e) => {
          errors.push(e.error);
        },
      });
      const before = JSON.stringify(
        manager.getBranch().filter((e) => e.type === "compaction"),
      );
      if (scenario.startsWith("inflight-")) {
        if (scenario === "inflight-manual")
          await session.prompt("Capture main policy");
        const first =
          scenario === "inflight-manual"
            ? session.compact().then(
                () => false,
                () => true,
              )
            : session.prompt("Trigger a native boundary");
        const deadline = AbortSignal.timeout(10_000);
        await Promise.race([
          nativeSeen,
          new Promise<never>((_resolve, reject) => {
            deadline.addEventListener(
              "abort",
              () =>
                reject(
                  new Error(
                    "native request did not start: " +
                      JSON.stringify({
                        requests: payloads.map((p) => ({
                          model: p.model,
                          trigger: (p.input as { type?: string }[]).some(
                            (i) => i.type === "compaction_trigger",
                          ),
                        })),
                        notices,
                        errors,
                        usage: session.getContextUsage(),
                      }),
                  ),
                ),
              { once: true },
            );
          }),
        ]);
        await session.setModel(other);
        releaseNative();
        const outcome = await first;
        if (scenario === "inflight-manual")
          assert.equal(outcome, true, "obsolete manual compaction must reject");
        assert.equal(
          manager.getBranch().filter((e) => e.type === "compaction").length,
          0,
        );
        await session.prompt("/native-compact status --json");
        const status = JSON.parse(notices.at(-1)!);
        assert.equal(status.scope, "inactive");
        assert.equal(status.state, "IDLE");
        assert.equal(status.scheduler.nextProbe, 0);
        assert.equal(status.scheduler.compatibilityFailure, false);
        assert.equal(status.circuit.failures, 0);
        const count = payloads.length;
        await session.prompt("Now work with another subscription");
        assert.equal(payloads.length, count + 1);
        await session.compact();
        assert(payloads.length > count + 1);
        return;
      }
      await session.prompt("Repeat the code");
      const blocked = [
        "own",
        "legacy",
        "switch-back",
        "api-mismatch",
        "corrupt-own",
        "late-rewrite",
        "new-session",
        "tree",
      ].includes(scenario);
      if (blocked) {
        assert.equal(
          payloads.length,
          0,
          "opaque state must not cross provider boundary",
        );
        assert.equal(
          JSON.stringify(
            manager.getBranch().filter((e) => e.type === "compaction"),
          ),
          before,
        );
        await assert.rejects(session.compact());
        assert.equal(
          payloads.length,
          0,
          "wrong-provider compaction must also be refused",
        );
        if (scenario === "tree") {
          const nativeId = manager
            .getBranch()
            .findLast((e) => e.type === "compaction")!.id;
          await session.navigateTree(cleanHead, { summarize: false });
          notices.length = 0;
          errors.length = 0;
          await session.prompt(
            "Continue another branch before native compaction",
          );
          assert.equal(payloads.length, 1);
          await session.compact();
          assert(payloads.length > 1);
          assert.equal(errors.length, 0, errors.join("\n"));
          assert.equal(notices.length, 0, notices.join("\n"));
          await session.navigateTree(nativeId, { summarize: false });
          const count = payloads.length;
          await session.prompt("Back on the opaque branch");
          assert.equal(payloads.length, count);
        }
        if (scenario === "new-session") {
          const services = {
            cwd: dir,
            agentDir: dir,
            modelRuntime: runtime,
            settingsManager: settings,
            resourceLoader: loader,
            diagnostics: [],
          };
          const host = new AgentSessionRuntime(
            session,
            services,
            async (options) => {
              await loader.reload();
              const next = await createAgentSession({
                ...options,
                modelRuntime: runtime,
                settingsManager: settings,
                resourceLoader: loader,
                model: other,
                tools: [],
              });
              return { ...next, services, diagnostics: [] };
            },
          );
          host.setRebindSession(async (next) => {
            await next.bindExtensions({ onError: (e) => errors.push(e.error) });
          });
          const previous = manager.getSessionId();
          await host.newSession();
          assert.notEqual(host.session.sessionManager.getSessionId(), previous);
          notices.length = 0;
          errors.length = 0;
          await host.session.prompt("An unrelated new session");
          assert.equal(payloads.length, 1);
          await host.session.compact();
          assert(payloads.length > 1);
          assert.equal(errors.length, 0, errors.join("\n"));
          assert.equal(notices.length, 0, notices.join("\n"));
          await host.dispose();
          dispose = undefined;
        }
        if (scenario === "switch-back") {
          await session.setModel(codex);
          await session.prompt("Now continue with Codex");
          assert.equal(
            payloads.length,
            1,
            JSON.stringify({
              notices,
              errors,
              last: session.state.messages.at(-1),
            }),
          );
          assert.equal(
            (payloads[0]!.input as { type: string }[]).filter(
              (i) => i.type === "compaction",
            ).length,
            1,
          );
        }
      } else if (scenario === "paused-own") {
        assert.equal(payloads.length, 1);
        assert.equal(
          (payloads[0]!.input as { type: string }[]).filter(
            (i) => i.type === "compaction",
          ).length,
          1,
        );
        await assert.rejects(session.compact());
        assert.equal(payloads.length, 1);
        assert.equal(
          JSON.stringify(
            manager.getBranch().filter((e) => e.type === "compaction"),
          ),
          before,
        );
      } else {
        if (scenario === "automatic")
          assert(payloads.length >= 2, "Pi auto compaction must run");
        else assert.equal(payloads.length, 1);
        assert.equal(payloads[0]!.foreign_hook, "kept");
        assert(
          !JSON.stringify(payloads[0]!.input).includes("encrypted_content"),
        );
        if (scenario !== "automatic") await session.compact();
        assert(payloads.length > 1, "Pi's ordinary summarizer must run");
        const latest = manager
          .getBranch()
          .findLast((e) => e.type === "compaction");
        assert(latest?.type === "compaction");
        assert.notEqual(
          (latest.details as { strategy?: string })?.strategy,
          STRATEGY,
        );
        await session.prompt("Continue after Pi compaction");
        assert.equal(errors.length, 0, errors.join("\n"));
        assert.equal(notices.length, 0, notices.join("\n"));
        const count = payloads.length;
        await session.prompt("/native-compact now");
        assert.equal(payloads.length, count);
        assert(notices.at(-1)?.includes("inactive"));
        await session.prompt("/native-compact status --json");
        const status = JSON.parse(notices.at(-1)!);
        assert.equal(status.scope, "inactive");
        assert.equal(status.replay, "not applicable");
      }
    } finally {
      if (previousConfig === undefined)
        delete process.env.PI_CODEX_NATIVE_COMPACTION;
      else process.env.PI_CODEX_NATIVE_COMPACTION = previousConfig;
      releaseNative();
      dispose?.();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
