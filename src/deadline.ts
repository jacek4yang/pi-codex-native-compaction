import { NativeError } from "./errors.js";

/** An end-to-end attempt deadline, including response-body drain, not just headers. */
export function deadline(ms: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new NativeError("cancelled", "Native request cancelled"));
  parent?.addEventListener("abort", cancel, { once: true });
  if (parent?.aborted) cancel();
  const timer = setTimeout(
    () =>
      controller.abort(
        new NativeError("transient", "Native request deadline exceeded"),
      ),
    ms,
  );
  const signal = controller.signal;
  return {
    signal,
    async wait<T>(work: Promise<T>): Promise<T> {
      let aborted: (() => void) | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            aborted = () => reject(signal.reason);
            signal.addEventListener("abort", aborted, { once: true });
            if (signal.aborted) aborted();
          }),
        ]);
      } finally {
        if (aborted) signal.removeEventListener("abort", aborted);
      }
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", cancel);
    },
  };
}
