import { hash, validateCheckpoint, type Checkpoint } from "./checkpoint.js";
import { NativeError, classify } from "./errors.js";
import { StateMachine } from "./state-machine.js";
import { Circuit } from "./retry.js";
import { requestNative, type Sender, type Snapshot } from "./codex-v2.js";
import type { Config } from "./config.js";
import type { Diagnostics } from "./diagnostics.js";
export class Transaction {
  readonly machine = new StateMachine();
  readonly circuit: Circuit;
  private pending?: { key: string; promise: Promise<Checkpoint> };
  proposal?: Checkpoint;
  lastFailure?: NativeError;
  attemptCount = 0;
  lastOutcome: "none" | "committed" | "failed" | "discarded" = "none";
  private commitKey?: string;
  private commitSignal?: AbortSignal;
  private controller?: AbortController;
  constructor(
    private readonly c: Config,
    private readonly log: Diagnostics,
  ) {
    this.circuit = new Circuit(c);
  }
  async run(
    snapshot: Snapshot,
    send: Sender,
    currentKey: () => string,
    signal?: AbortSignal,
  ): Promise<Checkpoint> {
    if (this.pending) {
      if (this.pending.key !== snapshot.key)
        throw new NativeError("stale", "Another generation is in flight");
      // Caller must not independently commit the same proposal.
      throw new NativeError("stale", "Compaction already in flight");
    }
    if (this.proposal)
      throw new NativeError(
        "stale",
        "A compaction proposal is awaiting Pi commit",
      );
    this.circuit.assertAvailable();
    if (this.machine.phase === "CIRCUIT_OPEN") this.machine.move("IDLE");
    this.controller = new AbortController();
    const combined = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    const promise = this.execute(snapshot, send, currentKey, combined);
    this.pending = { key: snapshot.key, promise };
    try {
      return await promise;
    } finally {
      this.pending = undefined;
      this.controller = undefined;
    }
  }
  private async execute(
    s: Snapshot,
    send: Sender,
    currentKey: () => string,
    signal?: AbortSignal,
  ) {
    this.machine.move("SCHEDULED");
    try {
      this.machine.move("SNAPSHOT");
      this.log.emit("snapshot", { key: s.key });
      this.attemptCount = 0;
      const cp = await requestNative(
        s,
        (messages, options) => {
          this.attemptCount++;
          return send(messages, options);
        },
        this.c,
        this.machine,
        this.log,
        signal,
      );
      validateCheckpoint(cp);
      if (signal?.aborted)
        throw new NativeError("cancelled", "Cancelled before commit");
      if (currentKey() !== s.key)
        throw new NativeError(
          "stale",
          "Session changed during native compaction",
        );
      this.machine.move("COMMITTING");
      this.proposal = cp;
      this.commitKey = s.key;
      this.commitSignal = signal;
      this.log.emit("proposal", { generation: cp.generation });
      return cp;
    } catch (error) {
      const e = classify(error);
      this.lastFailure = e;
      this.lastOutcome = "failed";
      this.machine.move(e.kind === "cancelled" ? "CANCELLED" : "FAILED");
      this.circuit.fail(e);
      this.machine.move(
        e.kind === "transient" && this.circuit.openUntil > Date.now()
          ? "CIRCUIT_OPEN"
          : "IDLE",
      );
      this.log.emit("failed", { kind: e.kind, status: e.status });
      throw e;
    }
  }
  /** Re-read by Pi immediately before its synchronous append; no network or side effects here. */
  guard(currentKey: string) {
    if (this.commitSignal?.aborted)
      throw new NativeError("cancelled", "Cancelled before durable append");
    if (!this.proposal || currentKey !== this.commitKey)
      throw new NativeError("stale", "Session changed before durable append");
  }
  acknowledge(checkpoint: Checkpoint) {
    if (!this.proposal) return;
    if (hash(this.proposal) !== hash(checkpoint))
      throw new NativeError("stale", "Pi committed a different checkpoint");
    this.proposal = undefined;
    this.machine.move("IDLE");
    this.circuit.success();
    this.lastFailure = undefined;
    this.lastOutcome = "committed";
    this.log.emit("commit", { generation: checkpoint.generation });
  }
  cancel() {
    this.controller?.abort();
    this.discard();
  }
  discard() {
    if (this.proposal) {
      this.lastOutcome = "discarded";
      this.proposal = undefined;
      this.machine.move("CANCELLED");
      this.machine.move("IDLE");
    }
  }
}
