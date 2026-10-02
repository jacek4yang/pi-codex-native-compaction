import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { codexStream, resolvePiEntry } from "./pi-ai.js";
import type {
  Api,
  Model,
  Message,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  convertToLlm,
  type ExtensionAPI,
  type ExtensionContext,
  type CompactionResult,
  type BoundaryState,
} from "@earendil-works/pi-coding-agent";
import { configure, type Config } from "./config.js";
import {
  Checkpoint,
  SENTINEL,
  STRATEGY,
  hash,
  identity,
  supported,
  validateCheckpoint,
} from "./checkpoint.js";
import { check, classify, NativeError } from "./errors.js";
import { marker, replay, inputOf } from "./replay.js";
import { Scheduler } from "./scheduler.js";
import { Diagnostics } from "./diagnostics.js";
import { Transaction } from "./transaction.js";
import { commitDraft } from "./pi-runtime.js";
import { formatStatus, statusJson, type Status } from "./status.js";
import {
  legacyBoundary,
  prepareMigration,
  migrationRequired,
  MIGRATE_REQUEST,
  type MigrationPlan,
} from "./migration.js";

export function createExtension(settings?: Partial<Config>) {
  return (pi: ExtensionAPI) => {
    const config = configure(
      settings ?? JSON.parse(process.env.PI_CODEX_NATIVE_COMPACTION ?? "{}"),
    );
    const log = new Diagnostics(config);
    const tx = new Transaction(config, log);
    const scheduler = new Scheduler(config);
    let ctx: ExtensionContext | undefined;
    let disabled: string | undefined;
    let lastOptions: SimpleStreamOptions = {};
    let lastSystem: Message | undefined;
    let policy: Record<string, unknown> = {};
    let removed: string[] = [];
    let inputTransformed = false;
    const nativeCallbacks = new WeakSet<object>();
    const nativeMigrations = new WeakMap<object, MigrationPlan>();
    function legacy(context: ExtensionContext) {
      const entry = context.sessionManager
        .getBranch()
        .findLast((e) => e.type === "compaction");
      if (!entry) return;
      return legacyBoundary(
        entry,
        context.model ? identity(context.model) : undefined,
      );
    }
    function checkpoint(
      context: ExtensionContext,
      allowLegacyNative = false,
    ): Checkpoint | undefined {
      const entry = context.sessionManager
        .getBranch()
        .findLast((e) => e.type === "compaction");
      if (!entry) return;
      const old = legacy(context);
      if (old) {
        if (old.kind === "legacy-codex-v2" && !allowLegacyNative)
          migrationRequired();
        return;
      }
      check(
        entry.summary === SENTINEL,
        "Native checkpoint summary marker mismatch",
      );
      check(
        entry.firstKeptEntryId === entry.id,
        "Native checkpoint unexpectedly retains Pi tail",
      );
      const cp = validateCheckpoint(
        entry.details,
        context.model ? identity(context.model) : undefined,
        context.sessionManager.getSessionId(),
      );
      check(
        entry.parentId === cp.headId,
        "Checkpoint parent does not match its snapshot",
      );
      tx.acknowledge(cp);
      return cp;
    }
    function key(context: ExtensionContext) {
      return hash({
        session: context.sessionManager.getSessionId(),
        head: context.sessionManager.getLeafId(),
        model: context.model ?? null,
        system: context.getSystemPrompt(),
        tools: pi.getAllTools(),
        activeTools: pi.getActiveTools(),
      });
    }
    function announce(context: ExtensionContext, error: unknown) {
      const e = classify(error);
      log.emit("failure", {
        kind: e.kind,
        status: e.status,
        reason: e.message,
      });
      // Avoid printing arbitrary provider text: it may echo prompt data or credentials.
      context.ui.notify(
        "Native compaction did not commit (" +
          e.kind +
          (e.status ? " HTTP " + e.status : "") +
          "). Existing context preserved." +
          (e.kind === "compatibility" &&
          e.message.includes("/native-compact migrate")
            ? " Run /native-compact migrate explicitly."
            : ""),
        "warning",
      );
    }
    function refresh(context: ExtensionContext) {
      ctx = context;
      return context;
    }
    pi.registerProvider("openai-codex", {
      api: "openai-codex-responses",
      streamSimple(model, context, options = {}) {
        const native =
          options.onPayload && nativeCallbacks.has(options.onPayload);
        if (!native) {
          lastOptions = {
            reasoning: options.reasoning,
            transport: options.transport,
            cacheRetention: options.cacheRetention,
            sessionId: options.sessionId,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
          };
          lastSystem = context.messages.find((m) => m.role === "system");
        }
        return codexStream(model as Model<"openai-codex-responses">, context, {
          ...options,
          async onPayload(payload, m) {
            check(!disabled, disabled ?? "Unsupported Pi API shape");
            check(
              ctx,
              "Pi session_start has not initialized native compaction",
            );
            const migration = options.onPayload
              ? nativeMigrations.get(options.onPayload)
              : undefined;
            const cp = checkpoint(ctx, Boolean(migration));
            if (migration) {
              const old = legacy(ctx);
              check(
                old &&
                  hash(old.entry) === migration.provenance.sourceFingerprint,
                "Migration source changed before request",
              );
            }
            if (cp)
              validateCheckpoint(
                cp,
                identity(m),
                ctx.sessionManager.getSessionId(),
              );
            const rewrite = (p: unknown) =>
              replay(p, migration?.window ?? cp, marker(m));
            if (!native && config.enabled) {
              const ratio = (ctx.getContextUsage()?.percent ?? 0) / 100;
              if (ratio >= config.hardThresholdRatio && !tx.proposal)
                throw new NativeError(
                  "circuit",
                  "Native compaction required before another provider request",
                );
            }
            // For normal requests, our final validation runs AFTER Pi extension payload hooks.
            // For compaction, replay must run BEFORE the internal callback appends its trigger.
            let body: unknown;
            if (native) {
              check(
                !inputTransformed,
                "Another extension rewrites native input; compaction cannot reproduce that transformation safely",
              );
              const base = { ...inputOf(payload).body, ...policy };
              for (const key of removed) delete base[key];
              body = rewrite(base);
            } else {
              const { input, ...envelope } = inputOf(payload).body;
              const original = structuredClone(envelope);
              const originalInputHash = hash(input);
              body = (await options.onPayload?.(payload, m)) ?? payload;
              const final = inputOf(body).body;
              inputTransformed = originalInputHash !== hash(final.input);
              policy = Object.fromEntries(
                Object.entries(final).filter(
                  ([k, v]) =>
                    k !== "input" && hash(v) !== hash(original[k] ?? null),
                ),
              );
              removed = Object.keys(original).filter(
                (k) => k !== "input" && !(k in final),
              );
            }
            const result = native
              ? ((await options.onPayload?.(body, m)) ?? body)
              : rewrite(body);
            log.emit("replay", {
              native: Boolean(native),
              generation: cp?.generation ?? 0,
            });
            return result;
          },
        });
      },
    });
    async function propose(
      context: ExtensionContext,
      messages: Message[],
      signal?: AbortSignal,
      migration?: MigrationPlan,
    ) {
      refresh(context);
      check(!disabled, disabled ?? "Unsupported Pi API shape");
      check(config.enabled, "Native compaction disabled");
      check(
        context.model && supported(identity(context.model)),
        "Native compaction requires openai-codex/openai-codex-responses",
      );
      const old = legacy(context);
      if (old && !migration) migrationRequired();
      if (migration)
        check(
          old && hash(old.entry) === migration.provenance.sourceFingerprint,
          "Migration source mismatch",
        );
      const cp = checkpoint(context, Boolean(migration));
      const branch = context.sessionManager.getBranch();
      const latest = branch.findLast((e) => e.type === "compaction");
      if (latest && latest.id === context.sessionManager.getLeafId())
        throw new NativeError(
          "stale",
          "Session already compacted at this generation",
        );
      const initialKey = key(context);
      const snapshot = {
        sessionId: context.sessionManager.getSessionId(),
        headId: context.sessionManager.getLeafId(),
        model: structuredClone(context.model as Model<Api>),
        messages: structuredClone(messages),
        generation: (cp?.generation ?? 0) + 1,
        key: initialKey,
        migration: migration?.provenance ?? cp?.migration,
      };
      return tx.run(
        snapshot,
        (items, options) => {
          check(options.onPayload, "Native payload hook missing");
          nativeCallbacks.add(options.onPayload);
          if (migration) nativeMigrations.set(options.onPayload, migration);
          return context.modelRegistry.streamSimple(
            snapshot.model,
            { messages: items },
            {
              ...lastOptions,
              transport: lastOptions.transport ?? pi.getSettings().transport,
              ...options,
              reasoning:
                context.thinkingLevel === "off"
                  ? undefined
                  : context.thinkingLevel,
              sessionId: snapshot.sessionId,
            },
          );
        },
        () => key(context),
        signal,
      );
    }
    function projected(
      context: ExtensionContext,
      prepared?: Message[],
    ): Message[] {
      const messages =
        prepared ??
        convertToLlm(context.sessionManager.buildSessionProjection().messages);
      if (!messages.some((m) => m.role === "system")) {
        check(
          lastSystem,
          "Run one ordinary Codex turn first to establish Pi's tool/system transcript",
        );
        messages.unshift(structuredClone(lastSystem));
      }
      return messages;
    }
    async function boundary(event: BoundaryState, context: ExtensionContext) {
      refresh(context);
      if (
        !config.enabled ||
        !context.model ||
        !supported(identity(context.model))
      )
        return;
      // Other extensions' drafts are not durable yet; never snapshot them.
      if (event.entries.length || event.context.pendingMessages.length) return;
      try {
        if (legacy(context)) return; // Never silently cross an existing continuity boundary.
        checkpoint(context);
        const ratio = (context.getContextUsage()?.percent ?? 0) / 100;
        if (!scheduler.due(ratio * 100)) return;
        const cp = await propose(
          context,
          event.context.llmMessages,
          context.signal,
        );
        return { entries: [commitDraft(cp, () => tx.guard(key(context)))] };
      } catch (error) {
        scheduler.failed(classify(error));
        announce(context, error);
      }
    }
    function initialize(context: ExtensionContext) {
      refresh(context);
      disabled = undefined;
      tx.cancel();
      scheduler.success();
      lastSystem = undefined;
      lastOptions = {};
      policy = {};
      removed = [];
      inputTransformed = false;
      try {
        for (const name of [
          "@earendil-works/pi-ai",
          "@earendil-works/pi-coding-agent",
        ]) {
          let dir = dirname(resolvePiEntry(name));
          let version: string | undefined;
          for (;;) {
            try {
              const pkg = JSON.parse(
                readFileSync(join(dir, "package.json"), "utf8"),
              ) as { name?: string; version?: string };
              if (pkg.name === name) {
                version = pkg.version;
                break;
              }
            } catch {
              /* Walk from the public entry, no assumed node_modules layout. */
            }
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
          }
          check(version, "Cannot establish Pi version");
          check(/^1\.0\./.test(version), "Unsupported Pi version " + version);
        }
        check(
          typeof context.modelRegistry.streamSimple === "function" &&
            typeof context.sessionManager.buildSessionProjection === "function",
          "Unsupported Pi API shape",
        );
        check(
          !pi
            .getCommands()
            .some((c) =>
              JSON.stringify(c.sourceInfo).includes("pi-better-compaction"),
            ),
          "pi-better-compaction detected: two compaction owners are unsupported; disable it first",
        );
        checkpoint(context, true);
        const old = legacy(context);
        if (old)
          context.ui.notify(
            "Legacy " +
              old.kind +
              " continuity active. Run /native-compact migrate to establish Native V2; previously lost information is not recovered.",
            "warning",
          );
        log.emit("startup", { mode: config.mode });
      } catch (error) {
        disabled = classify(error).message;
        context.ui.notify(
          "Unsupported Pi API shape or checkpoint; native compaction disabled to protect session integrity. " +
            disabled,
          "error",
        );
      }
    }
    pi.on("session_start", (_event, context) => initialize(context));
    pi.on("turn_end", boundary);
    pi.on("agent_before_settle", boundary);
    pi.on("session_before_compact", async (event, context) => {
      refresh(context);
      try {
        const old = legacy(context);
        const migration =
          old && event.customInstructions?.trim() === MIGRATE_REQUEST
            ? prepareMigration(context.sessionManager.getBranch(), old)
            : undefined;
        if (old && !migration) migrationRequired();
        const cp = await propose(
          context,
          projected(context, migration?.messages),
          event.signal,
          migration,
        );
        scheduler.success();
        // Pi 1.0 runtime supports null/self-retaining; CompactionResult's type still says string.
        // Kept in this one compatibility adapter and covered by real SDK integration tests.
        const draft = commitDraft(cp, () => tx.guard(key(context)));
        return {
          compaction: Object.defineProperty(
            {
              summary: draft.summary,
              tokensBefore: event.preparation.tokensBefore,
              details: cp,
            },
            "firstKeptEntryId",
            Object.getOwnPropertyDescriptor(draft, "firstKeptEntryId")!,
          ) as unknown as CompactionResult,
        };
      } catch (error) {
        scheduler.failed(classify(error));
        announce(context, error);
        return { cancel: true };
      }
    });
    pi.on("session_compact", (_event, context) => {
      refresh(context);
      try {
        checkpoint(context);
      } catch (e) {
        announce(context, e);
      }
    });
    pi.on("session_compact_failed", () => tx.discard());
    pi.on("agent_settled", (_event, context) => {
      if (!tx.proposal) return;
      const latest = context.sessionManager
        .getBranch()
        .findLast((e) => e.type === "compaction");
      if (
        latest?.type === "compaction" &&
        hash(latest.details) === hash(tx.proposal)
      )
        tx.acknowledge(tx.proposal);
      else {
        tx.discard();
        log.emit("proposal_discarded", {
          reason: "Pi boundary did not commit",
        });
      }
    });
    pi.on("session_shutdown", () => {
      tx.cancel();
      ctx = undefined;
    });
    pi.on("before_provider_request", (_event, context) => {
      refresh(context);
      // Never inject opaque state into a different provider. Abort before network as well.
      if (
        context.model &&
        (context.model.provider !== "openai-codex" ||
          context.model.api !== "openai-codex-responses") &&
        context.sessionManager
          .getBranch()
          .some(
            (e) =>
              e.type === "compaction" &&
              (e.summary === SENTINEL ||
                (e.details &&
                  typeof e.details === "object" &&
                  ("strategy" in e.details || "compactedWindow" in e.details))),
          )
      ) {
        context.abort();
        return {
          toJSON() {
            throw new NativeError(
              "identity",
              "Codex native checkpoint cannot be sent to another provider",
            );
          },
        };
      }
    });
    pi.registerCommand("native-compact", {
      description: "Codex native V2: status | inspect | now | retry | migrate",
      handler: async (args, context) => {
        refresh(context);
        const [command = "status", ...flags] = args.trim()
          ? args.trim().split(/\s+/)
          : [];
        if (
          !["status", "inspect", "now", "retry", "migrate"].includes(command) ||
          flags.some((f) => f !== "--json") ||
          (flags.length && !["status", "inspect"].includes(command))
        ) {
          context.ui.notify(
            "Usage: /native-compact status|inspect [--json], now, retry, migrate",
            "warning",
          );
          return;
        }
        if (command === "migrate") {
          await context.waitForIdle();
          try {
            check(!disabled, disabled ?? "Unsupported Pi API shape");
            const old = legacy(context);
            check(
              old,
              "No legacy boundary to migrate; use /native-compact now",
            );
            check(
              old.entry.id !== context.sessionManager.getLeafId(),
              "Pi requires a post-boundary entry before compaction; for text sessions, continue one real turn first",
            );
            context.ui.notify(
              "Migrating " +
                old.kind +
                " via fresh Native V2. Earlier information loss is not recovered; old history remains until successful commit.",
              "warning",
            );
            context.compact({
              customInstructions: MIGRATE_REQUEST,
              onComplete: () =>
                context.ui.notify(
                  "Native V2 migration committed. Future /compact and automatic compactions are native.",
                  "info",
                ),
            });
          } catch (error) {
            announce(context, error);
            if (error instanceof NativeError)
              context.ui.notify(
                "Migration unavailable: " + error.message,
                "warning",
              );
          }
          return;
        }
        if (command === "now" || command === "retry") {
          await context.waitForIdle();
          context.compact();
          return;
        }
        let cp: Checkpoint | undefined;
        let old: ReturnType<typeof legacy>;
        let health = "ok";
        try {
          old = legacy(context);
          cp = checkpoint(context, true);
        } catch (e) {
          health = classify(e).message;
        }
        let modelIdentity: Status["model"] = null;
        try {
          modelIdentity = context.model ? identity(context.model) : null;
        } catch {
          health = "model/endpoint unavailable";
        }
        const status: Status = {
          enabled: config.enabled,
          disabled,
          mode: config.mode,
          model: modelIdentity,
          transport:
            lastOptions.transport ?? pi.getSettings().transport ?? "default",
          usage: context.getContextUsage(),
          thresholds: {
            soft: config.softThresholdRatio,
            hard: config.hardThresholdRatio,
          },
          state: tx.machine.phase,
          generation: cp?.generation ?? 0,
          createdAt: cp?.createdAt,
          responseId: cp?.responseId,
          migration:
            cp?.migration ??
            (old
              ? {
                  available: true,
                  kind: old.kind,
                  requiresExplicitCommand: true,
                }
              : undefined),
          continuity: cp
            ? STRATEGY
            : old
              ? old.kind
              : health === "ok"
                ? "uncompacted"
                : "legacy-or-invalid",
          lastFailure: tx.lastFailure?.kind,
          retryCount: Math.max(0, tx.attemptCount - 1),
          lastOutcome: tx.lastOutcome,
          scheduler: {
            nextProbe: scheduler.nextProbe,
            compatibilityFailure: scheduler.compatibilityFailure,
          },
          circuit: {
            failures: tx.circuit.failures,
            openUntil: tx.circuit.openUntil,
          },
          replay: health,
          diagnosticWriteFailures: log.failures,
        };
        context.ui.notify(
          flags.includes("--json")
            ? statusJson(status)
            : formatStatus(status, { detailed: command === "inspect" }),
          "info",
        );
      },
    });
  };
}
export default createExtension();
