import assert from "node:assert/strict";
import type { Transport } from "@earendil-works/pi-ai";
import {
  getOpenAICodexWebSocketDebugStats,
  closeOpenAICodexWebSocketSessions,
} from "@earendil-works/pi-ai/api/openai-codex-responses";

/** Test-only guard: a requested WebSocket mode must never pass by falling back to SSE. */
export function transportProof(transport: Transport) {
  const originalFetch = globalThis.fetch;
  const records: Record<string, unknown>[] = [];
  let blockedSseRequests = 0;
  if (transport !== "sse") {
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      if (
        method.toUpperCase() === "POST" &&
        /\/responses\/?$/.test(url.pathname)
      ) {
        blockedSseRequests++;
        throw new Error("SSE fallback forbidden by WebSocket validation");
      }
      return originalFetch(input, init);
    };
  }
  return {
    records,
    check(sessionId: string, stage: string) {
      if (transport === "sse") return;
      const stats = getOpenAICodexWebSocketDebugStats(sessionId);
      assert(
        stats && stats.requests > 0,
        "No actual WebSocket request observed",
      );
      const { lastWebSocketError: _error, ...safe } = stats;
      void _error;
      records.push({ stage, ...safe });
      assert.equal(blockedSseRequests, 0, "HTTP/SSE fallback attempted");
      assert.equal(stats.sseFallbacks, 0, "Pi reported SSE fallback");
      assert.equal(stats.websocketFailures, 0, "Pi reported WebSocket failure");
      return stats;
    },
    reconnect(sessionId: string) {
      closeOpenAICodexWebSocketSessions(sessionId);
    },
    finish(sessionId: string) {
      closeOpenAICodexWebSocketSessions(sessionId);
      globalThis.fetch = originalFetch;
      const stats = getOpenAICodexWebSocketDebugStats(sessionId);
      const { lastWebSocketError: _error, ...safe } = stats ?? {};
      void _error;
      return { transport, blockedSseRequests, stats: safe, records };
    },
  };
}
