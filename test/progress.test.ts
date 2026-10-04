import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Progress } from "../src/progress.js";
import { deadline } from "../src/deadline.js";
import { classify } from "../src/errors.js";
import { configure } from "../src/config.js";
import { Diagnostics } from "../src/diagnostics.js";

test("deadline bounds even a stalled body; parent cancellation is not retryable", async () => {
  const d = deadline(10);
  try {
    await assert.rejects(
      d.wait(new Promise(() => {})),
      (e) => classify(e).kind === "transient",
    );
    assert(d.signal.aborted);
  } finally {
    d.dispose();
  }
  const controller = new AbortController();
  const c = deadline(1000, controller.signal);
  controller.abort();
  try {
    await assert.rejects(
      c.wait(new Promise(() => {})),
      (e) => classify(e).kind === "cancelled",
    );
  } finally {
    c.dispose();
  }
});
test("progress lifecycle, bounded safe persistence and restart inspection", () => {
  const root = mkdtempSync(join(tmpdir(), "native-progress-"));
  try {
    const path = join(root, "last.json");
    const widgets: (string[] | undefined)[] = [];
    const ui = {
      setWidget: (_: string, lines: string[] | undefined) =>
        widgets.push(lines),
    } as unknown as ExtensionContext["ui"];
    const p = new Progress(path);
    p.start(ui, 3, 300000);
    p.observe("attempt", { attempt: 1 });
    p.observe("provider_event", { type: "secret-provider-event" });
    p.observe("failed", {
      kind: "transient",
      reason: "private-user-content",
      encrypted_content: "opaque-secret",
      status: 503,
    });
    const saved = readFileSync(path, "utf8");
    for (const secret of [
      "secret-provider-event",
      "private-user-content",
      "opaque-secret",
    ])
      assert(!saved.includes(secret));
    assert(saved.length < 4096);
    assert.deepEqual(new Progress(path).previous(), JSON.parse(saved));
    assert(widgets[0]?.[0]?.includes("Native compact"));
    assert.equal(widgets.at(-1), undefined);
    p.stop();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("broken diagnostic observers cannot affect transaction semantics", () => {
  const d = new Diagnostics(configure(), () => {
    throw new Error("bad UI");
  });
  assert.doesNotThrow(() => d.emit("attempt"));
  assert.equal(d.failures, 1);
});
