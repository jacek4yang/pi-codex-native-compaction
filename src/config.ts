import { check, object } from "./errors.js";
export const defaults = {
  enabled: true,
  mode: "native-only" as "native-only" | "strict-debug",
  softThresholdRatio: 0.75,
  hardThresholdRatio: 0.88,
  maxRetries: 2,
  requestTimeoutMs: 300000,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 10000,
  retryJitterRatio: 0.2,
  circuitBreakerFailureCount: 3,
  circuitBreakerCooldownMs: 60000,
  debug: false,
  artifactRoot: "",
};
export type Config = typeof defaults;
export function configure(input: unknown = {}): Config {
  const value = object(input);
  for (const key of Object.keys(value))
    check(key in defaults, "Unknown native compaction setting: " + key);
  const c = { ...defaults, ...value } as Config;
  check(
    typeof c.enabled === "boolean" &&
      typeof c.debug === "boolean" &&
      typeof c.artifactRoot === "string",
    "Invalid boolean/path settings",
  );
  check(
    c.mode === "native-only" || c.mode === "strict-debug",
    "Invalid native mode",
  );
  for (const key of [
    "softThresholdRatio",
    "hardThresholdRatio",
    "maxRetries",
    "requestTimeoutMs",
    "retryBaseDelayMs",
    "retryMaxDelayMs",
    "retryJitterRatio",
    "circuitBreakerFailureCount",
    "circuitBreakerCooldownMs",
  ] as const)
    check(
      typeof c[key] === "number" && Number.isFinite(c[key]) && c[key] >= 0,
      "Invalid setting: " + key,
    );
  check(
    c.softThresholdRatio > 0 &&
      c.softThresholdRatio < c.hardThresholdRatio &&
      c.hardThresholdRatio < 1,
    "Require 0 < soft < hard < 1",
  );
  check(
    Number.isInteger(c.maxRetries) && c.maxRetries <= 5,
    "maxRetries must be integer 0..5",
  );
  check(
    c.retryJitterRatio <= 1 && c.retryBaseDelayMs <= c.retryMaxDelayMs,
    "Invalid backoff",
  );
  check(
    Number.isInteger(c.circuitBreakerFailureCount) &&
      c.circuitBreakerFailureCount >= 1 &&
      c.circuitBreakerCooldownMs > 0,
    "Invalid circuit settings",
  );
  check(
    c.requestTimeoutMs > 0 && c.requestTimeoutMs <= 900000,
    "requestTimeoutMs must be 1..900000",
  );
  return c;
}
