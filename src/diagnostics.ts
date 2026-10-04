import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
const secret =
  /authorization|bearer|api.?key|token|cookie|credential|password|secret|encrypted_content/i;
export function redact(value: unknown, key = "", depth = 0): unknown {
  if (secret.test(key)) return "[REDACTED]";
  if (depth > 15) return "[DEPTH]";
  if (typeof value === "string")
    return value
      .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
      .replace(/\b(?:sk-|sess-)[\w-]+/g, "[REDACTED]")
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED]")
      .replace(
        /((?:authorization|cookie|password|credential|api[_-]?key|access[_-]?token|refresh[_-]?token|secret)["\']?\s*[:=]\s*["\']?)[^"\'\s,;}]+/gi,
        "$1[REDACTED]",
      );
  if (Array.isArray(value)) return value.map((v) => redact(v, key, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redact(v, k, depth + 1)]),
    );
  return value;
}
export class Diagnostics {
  latest: unknown;
  failures = 0;
  constructor(
    private readonly c: Config,
    private readonly observe?: (
      event: string,
      fields: Record<string, unknown>,
    ) => void,
  ) {}
  emit(event: string, fields: Record<string, unknown> = {}) {
    const record = redact({ at: new Date().toISOString(), event, ...fields });
    this.latest = record;
    try {
      this.observe?.(event, fields);
    } catch {
      this.failures++;
    }
    if (
      !this.c.artifactRoot ||
      !(this.c.debug || this.c.mode === "strict-debug")
    )
      return;
    try {
      mkdirSync(this.c.artifactRoot, { recursive: true, mode: 0o700 });
      appendFileSync(
        join(this.c.artifactRoot, "native-compaction.jsonl"),
        JSON.stringify(record) + "\n",
        { mode: 0o600 },
      );
    } catch {
      this.failures++;
    } // Diagnostics must not change transaction correctness.
  }
}
