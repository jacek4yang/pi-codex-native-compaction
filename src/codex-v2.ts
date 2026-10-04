import type {
  AssistantMessageEventStream,
  Model,
  Api,
  Message,
  ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import {
  hash,
  identity,
  seal,
  STRATEGY,
  validateCompaction,
  type Checkpoint,
  type Item,
} from "./checkpoint.js";
import { check, classify, NativeError, object } from "./errors.js";
import { inputOf, retained } from "./replay.js";
import { retryAfter, backoff, sleep } from "./retry.js";
import type { Config } from "./config.js";
import type { StateMachine } from "./state-machine.js";
import type { Diagnostics } from "./diagnostics.js";
import { deadline } from "./deadline.js";
export class Collector {
  items: Item[] = [];
  completed = 0;
  responseId = "";
  counts: Record<string, number> = {};
  usage?: { input: number; output: number; total: number };
  observe(value: unknown) {
    const event = object(value);
    check(typeof event.type === "string", "Malformed provider event");
    this.counts[event.type] = (this.counts[event.type] ?? 0) + 1;
    if (event.type === "response.output_item.done") {
      const item = object(event.item);
      if (item.type === "compaction")
        this.items.push(structuredClone(validateCompaction(item)));
    }
    if (event.type === "response.completed" || event.type === "response.done") {
      const response = object(event.response);
      check(
        response.status === undefined || response.status === "completed",
        "Response was not completed",
      );
      check(
        typeof response.id === "string" && response.id.length > 0,
        "Missing native response ID",
      );
      this.responseId = response.id;
      this.completed++;
      if (response.usage) {
        const u = object(response.usage);
        if (
          [u.input_tokens, u.output_tokens, u.total_tokens].every(
            (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
          )
        )
          this.usage = {
            input: Number(u.input_tokens),
            output: Number(u.output_tokens),
            total: Number(u.total_tokens),
          };
      }
    }
  }
  finish(): Item {
    if (!this.completed)
      throw new NativeError("transient", "EOF before response.completed");
    check(this.completed === 1, "Duplicate response completion");
    check(
      this.items.length === 1,
      "Expected exactly one compaction output; received " + this.items.length,
    );
    return this.items[0]!;
  }
}
export interface Snapshot {
  sessionId: string;
  headId: string | null;
  model: Model<Api>;
  messages: Message[];
  generation: number;
  key: string;
  migration?: Checkpoint["migration"];
}
export type Sender = (
  messages: Message[],
  options: ModelsSimpleStreamOptions,
) => AssistantMessageEventStream;
export async function requestNative(
  s: Snapshot,
  send: Sender,
  c: Config,
  machine: StateMachine,
  log: Diagnostics,
  signal?: AbortSignal,
): Promise<Checkpoint> {
  let attempt = 0;
  for (;;) {
    if (signal?.aborted)
      throw new NativeError("cancelled", "Native request cancelled");
    machine.move("REQUESTING");
    const collector = new Collector();
    let status: number | undefined;
    let requested: number | undefined;
    let request: Item | undefined;
    let input: Item[] = [];
    const budget = deadline(c.requestTimeoutMs, signal);
    try {
      log.emit("attempt", {
        attempt,
        sessionId: s.sessionId,
        headId: s.headId,
        generation: s.generation,
      });
      const stream = send(s.messages, {
        signal: budget.signal,
        maxRetries: 0,
        timeoutMs: c.requestTimeoutMs,
        onPayload(payload) {
          budget.signal.throwIfAborted();
          const parsed = inputOf(payload);
          check(
            !parsed.input.some((i) => i.type === "compaction_trigger"),
            "Duplicate trigger",
          );
          input = structuredClone(parsed.input);
          request = {
            ...parsed.body,
            input: [...input, { type: "compaction_trigger" }],
          };
          log.emit("request", {
            attempt,
            inputItems: input.length,
            inputBytes: Buffer.byteLength(JSON.stringify(request)),
            fingerprint: hash(request),
            types: input.map((i) => i.type ?? i.role),
          });
          return request;
        },
        onResponse(response) {
          status = response.status;
          requested = retryAfter(response.headers["retry-after"]);
        },
        onProviderStreamEvent(event) {
          budget.signal.throwIfAborted();
          collector.observe(event);
          const e = object(event);
          log.emit("provider_event", { type: e.type });
        },
      });
      const result = await budget.wait(
        (async () => {
          for await (const event of stream) {
            void event;
          }
          return stream.result();
        })(),
      );
      budget.signal.throwIfAborted();
      budget.dispose();
      if (result.stopReason === "error" || result.stopReason === "aborted")
        throw classify(
          new Error(result.errorMessage ?? "Provider failed"),
          status,
          requested,
        );
      const compaction = collector.finish();
      check(request, "Provider did not expose the request payload");
      if (signal?.aborted)
        throw new NativeError("cancelled", "Cancelled after remote completion");
      machine.move("VALIDATING");
      log.emit("validated", {
        attempt,
        events: collector.counts,
        responseId: collector.responseId,
      });
      return seal({
        schemaVersion: 1,
        strategy: STRATEGY,
        protocolVersion: 2,
        identity: identity(s.model),
        sessionId: s.sessionId,
        headId: s.headId,
        generation: s.generation,
        createdAt: new Date().toISOString(),
        responseId: collector.responseId,
        requestFingerprint: hash(request),
        retained: retained(input),
        compaction,
        window: { inputItems: input.length, inputHash: hash(input) },
        ...(collector.usage ? { usage: collector.usage } : {}),
        ...(s.migration ? { migration: s.migration } : {}),
      });
    } catch (error) {
      const e = classify(
        budget.signal.aborted ? budget.signal.reason : error,
        status,
        requested,
      );
      budget.dispose();
      log.emit("attempt_failed", {
        attempt,
        kind: e.kind,
        status: e.status,
        reason: e.message,
        events: collector.counts,
      });
      if (
        e.kind !== "transient" ||
        attempt >= c.maxRetries ||
        signal?.aborted ||
        (e.retryAfterMs ?? 0) > c.retryMaxDelayMs
      )
        throw e;
      const wait = backoff(c, attempt, e.retryAfterMs);
      machine.move("BACKOFF");
      log.emit("retry", { attempt, wait });
      await sleep(wait, signal);
      attempt++;
    } finally {
      budget.dispose();
    }
  }
}
