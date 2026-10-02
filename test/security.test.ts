import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Diagnostics, redact } from "../src/diagnostics.js";
import { configure } from "../src/config.js";
import { Transaction } from "../src/transaction.js";
import { snapshot, sender, jwt } from "./fixtures.js";
test("redacts JSON-string secrets and credential assignments", () => {
  const value = JSON.stringify(
    redact({
      reason:
        '{"access_token":"canary1","refresh_token":"canary2","password":"canary3"} Authorization: canary4 api_key=canary5',
    }),
  );
  for (let i = 1; i <= 5; i++) assert(!value.includes("canary" + i), value);
});
test("no authentication material enters diagnostic artifact, even provider echo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "native-redaction-"));
  try {
    const c = configure({
      mode: "strict-debug",
      artifactRoot: dir,
      maxRetries: 0,
    });
    const log = new Diagnostics(c);
    const tx = new Transaction(c, log);
    await assert.rejects(
      tx.run(
        snapshot(),
        sender(
          async () =>
            new Response(
              JSON.stringify({
                error: { message: "password=canary-private Bearer " + jwt },
              }),
              { status: 400 },
            ),
        ),
        () => "key",
      ),
    );
    const text = readFileSync(join(dir, "native-compaction.jsonl"), "utf8");
    assert(!text.includes(jwt));
    assert(!text.includes("canary-private"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
