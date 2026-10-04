export type FailureKind =
  | "transient"
  | "protocol"
  | "identity"
  | "stale"
  | "cancelled"
  | "circuit"
  | "compatibility";
export class NativeError extends Error {
  constructor(
    public readonly kind: FailureKind,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "NativeError";
  }
}
export function classify(
  error: unknown,
  status?: number,
  retryAfterMs?: number,
): NativeError {
  if (error instanceof NativeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel|user.*abort|operation was aborted/i.test(message))
    return new NativeError("cancelled", "Native compaction cancelled");
  if (status && [408, 429, 500, 502, 503, 504].includes(status))
    return new NativeError("transient", message, status, retryAfterMs);
  if (status && status >= 400)
    return new NativeError("protocol", message, status);
  return new NativeError(
    /ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR_|terminated|socket|fetch failed|network|timeout|timed out|TLS|EOF|stream.*(end|clos)|temporar/i.test(
      message,
    )
      ? "transient"
      : "protocol",
    message,
    status,
    retryAfterMs,
  );
}
export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new NativeError("protocol", message);
}
export function object(value: unknown): Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected protocol object",
  );
  return value as Record<string, unknown>;
}
