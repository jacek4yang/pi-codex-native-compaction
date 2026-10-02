import type { Identity } from "./checkpoint.js";
import type { Migration } from "./provenance.js";
import { VERSION } from "./version.js";
export interface Status {
  enabled: boolean;
  scope?: "active" | "inactive" | "blocked";
  disabled?: string;
  mode: string;
  model: Identity | null;
  transport: string;
  usage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
  thresholds: { soft: number; hard: number };
  state: string;
  generation: number;
  createdAt?: string;
  responseId?: string;
  migration?:
    | Migration
    | { available: boolean; kind: string; requiresExplicitCommand: boolean };
  continuity: string;
  lastFailure?: string;
  retryCount: number;
  lastOutcome: string;
  scheduler: { nextProbe: number; compatibilityFailure: boolean };
  circuit: { failures: number; openUntil: number };
  replay: string;
  diagnosticWriteFailures: number;
}
function clean(value: unknown): string {
  return String(value)
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 300);
}
function percent(value: number): string {
  return (value * 100).toFixed(1).replace(/\.0$/, "") + "%";
}
function number(value: number): string {
  return value.toLocaleString("en-US");
}
export function formatStatus(
  s: Status,
  { detailed = false, now = Date.now() } = {},
): string {
  const u = s.usage;
  const lines = [
    "Codex Native Compaction v" + VERSION,
    "Mode: " +
      clean(s.mode) +
      " · " +
      (s.scope === "inactive"
        ? "inactive (Pi handles this session)"
        : s.scope === "blocked"
          ? "blocked (incompatible native context)"
          : s.disabled
            ? "disabled"
            : s.enabled
              ? "enabled"
              : "new compactions paused"),
    "Model: " +
      (s.model
        ? clean(s.model.provider) + " / " + clean(s.model.model)
        : "none"),
    "Transport: " + clean(s.transport) + " (Pi managed)",
    "Context: " +
      (u && u.tokens !== null
        ? number(u.tokens) +
          " / " +
          number(u.contextWindow) +
          " tokens" +
          (u.percent !== null ? " (" + percent(u.percent / 100) + ")" : "")
        : "unknown"),
    "Thresholds: soft " +
      percent(s.thresholds.soft) +
      " · hard " +
      percent(s.thresholds.hard),
    "State: " + clean(s.state.toLowerCase()),
    "Continuity: " +
      (s.continuity === "codex-remote-compaction-v2"
        ? "native V2 · generation " + s.generation
        : clean(s.continuity)),
    "Replay: " + (s.replay === "ok" ? "healthy" : clean(s.replay)),
    "Circuit: " +
      (s.circuit.openUntil > now
        ? "open · " +
          Math.ceil((s.circuit.openUntil - now) / 1000) +
          "s remaining"
        : "closed"),
    "Last: " +
      clean(s.lastOutcome) +
      " · retries " +
      s.retryCount +
      (s.lastFailure ? " · " + clean(s.lastFailure) : ""),
  ];
  if (s.disabled) lines.push("Disabled: " + clean(s.disabled));
  if (s.migration) {
    if ("requiresExplicitCommand" in s.migration) {
      lines.push(
        "Migration: required · " + clean(s.migration.kind),
        "Action: /native-compact migrate",
      );
    } else
      lines.push(
        "Migrated from: " +
          clean(s.migration.kind) +
          " · earlier loss not recovered",
      );
  }
  if (s.scheduler.compatibilityFailure)
    lines.push("Automatic attempts: paused after compatibility failure");
  else if (s.scheduler.nextProbe > now)
    lines.push(
      "Next automatic probe: in " +
        Math.ceil((s.scheduler.nextProbe - now) / 1000) +
        "s",
    );
  if (detailed) {
    lines.push(
      "API: " + clean(s.model?.api ?? "none"),
      "Endpoint: " + clean(s.model?.baseUrl ?? "none"),
      "Last checkpoint: " + clean(s.createdAt ?? "none"),
      "Native response: " + clean(s.responseId ?? "none"),
      "Consecutive transient failures: " + s.circuit.failures,
      "Diagnostic write failures: " + s.diagnosticWriteFailures,
    );
    if (s.migration && "sourceEntryId" in s.migration)
      lines.push(
        "Migration source: " + clean(s.migration.sourceEntryId),
        "Migration scope: " + clean(s.migration.scope),
        "Migration time: " + clean(s.migration.migratedAt),
      );
  }
  return lines.join("\n");
}
export function statusJson(status: Status): string {
  return JSON.stringify(
    { name: "pi-codex-native-compaction", version: VERSION, ...status },
    null,
    2,
  );
}
