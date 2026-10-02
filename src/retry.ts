import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "./config.js";
import { NativeError } from "./errors.js";
export function retryAfter(
  value: string | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return;
  const n = Number(value);
  const ms = Number.isFinite(n) ? n * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}
export function backoff(
  c: Config,
  attempt: number,
  requested?: number,
  random = Math.random,
): number {
  if (requested !== undefined && requested > c.retryMaxDelayMs)
    throw new NativeError(
      "transient",
      "Retry-After exceeds local wait budget",
      429,
      requested,
    );
  return Math.min(
    c.retryMaxDelayMs,
    Math.max(
      requested ?? 0,
      c.retryBaseDelayMs *
        2 ** attempt *
        (1 + c.retryJitterRatio * (random() * 2 - 1)),
    ),
  );
}
export async function sleep(ms: number, signal?: AbortSignal) {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    throw new NativeError(
      "cancelled",
      "Native compaction cancelled during backoff",
    );
  }
}
export class Circuit {
  failures = 0;
  openUntil = 0;
  constructor(private readonly c: Config) {}
  assertAvailable(now = Date.now()) {
    if (now < this.openUntil)
      throw new NativeError("circuit", "Native compaction cooling down");
  }
  fail(e: NativeError, now = Date.now()) {
    if (e.kind !== "transient") return;
    this.failures++;
    const local =
      this.failures >= this.c.circuitBreakerFailureCount
        ? this.c.circuitBreakerCooldownMs
        : 0;
    const cooldown = Math.max(local, e.retryAfterMs ?? 0);
    if (cooldown > 0) this.openUntil = Math.max(this.openUntil, now + cooldown);
  }
  success() {
    this.failures = 0;
    this.openUntil = 0;
  }
}
