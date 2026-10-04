import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

const phases: Record<string, string> = {
  attempt: "Requesting",
  request: "Waiting for provider",
  provider_event: "Receiving",
  retry: "Reconnecting",
  validated: "Validating checkpoint",
  proposal: "Awaiting commit",
  commit: "Committed",
  failed: "Stopped",
  proposal_discarded: "Not committed",
};
/** A whitelist-only snapshot: never store payloads, messages, response IDs or error text. */
export class Progress {
  private timer?: ReturnType<typeof setInterval>;
  private ui?: ExtensionContext["ui"];
  private began = 0;
  private lastEventAt = 0;
  private retryUntil = 0;
  private active = false;
  private data: Record<string, string | number> = {};
  failures = 0;
  constructor(private file?: string) {}
  previous(): unknown {
    if (!this.file) return undefined;
    try {
      const text = readFileSync(this.file, "utf8");
      if (text.length > 4096) return undefined;
      // Files are diagnostic output only; never drive decisions or replay.
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== "object" || Array.isArray(data))
        return undefined;
      const safe: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(data)) {
        if (
          [
            "attempts",
            "timeoutMs",
            "events",
            "attempt",
            "inputItems",
            "inputBytes",
            "status",
            "wait",
            "elapsedMs",
          ].includes(key) &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0
        )
          safe[key] = value;
        if (typeof value !== "string") continue;
        if (key === "phase" && Object.values(phases).includes(value))
          safe[key] = value;
        if (key === "at" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value))
          safe[key] = value;
        if (
          key === "failure" &&
          [
            "transient",
            "protocol",
            "identity",
            "stale",
            "cancelled",
            "circuit",
            "compatibility",
          ].includes(value)
        )
          safe[key] = value;
        if (
          key === "lastEvent" &&
          (value === "stream event" ||
            /^response\.(created|in_progress|completed|done|output_item\.(added|done))$/.test(
              value,
            ))
        )
          safe[key] = value;
      }
      return safe;
    } catch {
      return undefined;
    }
  }
  start(ui: ExtensionContext["ui"], attempts: number, timeout: number) {
    this.stop();
    this.ui = ui;
    this.active = true;
    this.began = this.lastEventAt = Date.now();
    this.retryUntil = 0;
    this.data = { phase: "Starting", attempts, timeoutMs: timeout, events: 0 };
    this.render();
    this.timer = setInterval(() => this.render(), 1000);
    this.timer.unref();
  }
  observe(event: string, fields: Record<string, unknown>) {
    if (
      !this.active &&
      !["commit", "failed", "proposal_discarded"].includes(event)
    )
      return;
    if (phases[event]) this.data.phase = phases[event];
    for (const key of [
      "attempt",
      "inputItems",
      "inputBytes",
      "status",
      "wait",
    ]) {
      const value = fields[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        this.data[key] = value;
    }
    if (event === "retry")
      this.retryUntil = Date.now() + Number(fields.wait ?? 0);
    if (event === "attempt") this.retryUntil = 0;
    if (event === "provider_event") {
      this.data.events = Number(this.data.events ?? 0) + 1;
      this.lastEventAt = Date.now();
      const type = fields.type;
      // Map provider event names rather than persisting arbitrary server strings.
      this.data.lastEvent =
        typeof type === "string" &&
        /^response\.(created|in_progress|completed|done|output_item\.(added|done))$/.test(
          type,
        )
          ? type
          : "stream event";
    }
    if (
      [
        "transient",
        "protocol",
        "identity",
        "stale",
        "cancelled",
        "circuit",
        "compatibility",
      ].includes(String(fields.kind))
    )
      this.data.failure = String(fields.kind);
    if (["failed", "commit", "proposal_discarded"].includes(event)) {
      this.data.elapsedMs = Math.max(0, Date.now() - this.began);
      this.persist();
      this.stop();
    }
  }
  private persist() {
    if (!this.file) return;
    const temp = this.file + "." + process.pid + ".tmp";
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(
        temp,
        JSON.stringify({ at: new Date().toISOString(), ...this.data }) + "\n",
        { mode: 0o600 },
      );
      renameSync(temp, this.file);
    } catch {
      this.failures++;
    }
  }
  private render() {
    if (!this.ui) return;
    try {
      const secs = Math.floor((Date.now() - this.began) / 1000);
      const retry =
        this.retryUntil > Date.now()
          ? ` · retry in ${Math.ceil((this.retryUntil - Date.now()) / 1000)}s`
          : "";
      this.ui.setWidget("native-compaction", [
        `Native compact · ${this.data.phase} · ${secs}s · attempt ${Number(this.data.attempt ?? 0) + 1}/${this.data.attempts}${retry}`,
        `${this.data.inputItems ?? 0} input items · ${Math.ceil(Number(this.data.inputBytes ?? 0) / 1024)} KiB · ${this.data.events} events · quiet ${Math.floor((Date.now() - this.lastEventAt) / 1000)}s · limit ${Number(this.data.timeoutMs) / 1000}s/attempt`,
      ]);
    } catch {
      this.failures++;
    }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.active = false;
    try {
      this.ui?.setWidget("native-compaction", undefined);
    } catch {
      this.failures++;
    }
    this.ui = undefined;
  }
}
