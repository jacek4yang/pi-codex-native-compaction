import type { Config } from "./config.js";
import type { NativeError } from "./errors.js";
/** Boundary-only scheduler. Hard guard belongs in the provider, never abort an active tool. */
export class Scheduler {
  nextProbe = 0;
  compatibilityFailure = false;
  constructor(private readonly config: Config) {}
  due(percent: number | null | undefined, now = Date.now()) {
    return (
      !this.compatibilityFailure &&
      now >= this.nextProbe &&
      (percent ?? 0) / 100 >= this.config.softThresholdRatio
    );
  }
  failed(error: NativeError, now = Date.now()) {
    this.compatibilityFailure = ![
      "transient",
      "circuit",
      "cancelled",
      "stale",
    ].includes(error.kind);
    this.nextProbe =
      now +
      Math.max(this.config.circuitBreakerCooldownMs, error.retryAfterMs ?? 0);
  }
  success() {
    this.nextProbe = 0;
    this.compatibilityFailure = false;
  }
}
