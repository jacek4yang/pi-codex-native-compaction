import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const source = resolve(process.argv[2] ?? ".");
const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as {
  name: string;
  version: string;
  pi: { extensions: string[] };
};
assert.deepEqual(pkg.pi.extensions, ["./index.ts"]);
const cwd = mkdtempSync(join(tmpdir(), "native-install-smoke-"));
const child = spawn(
  "pi",
  [
    "--mode",
    "rpc",
    "--offline",
    "--no-session",
    "--no-approve",
    "--no-extensions",
    "-e",
    source,
  ],
  { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] },
);
let buffer = "";
let complete = false;
let human = false;
let detailed = false;
const notices: string[] = [];
const errors: unknown[] = [];
let succeed!: () => void;
let fail!: (error: Error) => void;
const done = new Promise<void>((r, j) => {
  succeed = r;
  fail = j;
});
const timer = setTimeout(
  () => fail(new Error("Pi install smoke timed out")),
  45000,
);
const send = (value: unknown) =>
  child.stdin.write(JSON.stringify(value) + "\n");
child.on("error", fail);
child.on("exit", (code, signal) => {
  if (!complete)
    fail(new Error("Pi exited before validation: " + code + "/" + signal));
});
child.stderr.on("data", () => {
  /* Do not echo arbitrary child diagnostics or credentials. */
});
child.stdout.on("data", (chunk) => {
  buffer += String(chunk);
  for (;;) {
    const i = buffer.indexOf("\n");
    if (i < 0) break;
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      if (e.type === "extension_error") errors.push(e.event);
      if (
        e.type === "extension_ui_request" &&
        e.method === "notify" &&
        typeof e.message === "string"
      )
        notices.push(e.message);
      if (e.type !== "response") continue;
      const data = e.data as Record<string, unknown> | undefined;
      if (e.id === "commands") {
        assert(e.success);
        const commands = data?.commands as { name: string }[];
        assert(commands.some((c) => c.name === "native-compact"));
        send({
          id: "human",
          type: "prompt",
          message: "/native-compact status",
        });
      } else if (e.id === "human") {
        assert(e.success && data?.disposition === "handled");
        human = notices.some(
          (n) =>
            n.startsWith("Codex Native Compaction v" + pkg.version) &&
            n.includes("Replay:"),
        );
        assert(human);
        send({
          id: "inspect",
          type: "prompt",
          message: "/native-compact inspect",
        });
      } else if (e.id === "inspect") {
        assert(e.success);
        detailed = notices.some(
          (n) => n.includes("Native response:") && n.includes("API:"),
        );
        assert(detailed);
        send({
          id: "json",
          type: "prompt",
          message: "/native-compact status --json",
        });
      } else if (e.id === "json") {
        assert(e.success);
        const values = notices.flatMap((n) => {
          try {
            return [JSON.parse(n) as Record<string, unknown>];
          } catch {
            return [];
          }
        });
        const status = values.find((v) => v.name === pkg.name);
        assert(status);
        assert.equal(status.version, pkg.version);
        assert.equal(status.disabled, undefined);
        assert.equal(errors.length, 0);
        console.log(
          JSON.stringify({
            package: pkg.name,
            version: pkg.version,
            entry: "index.ts",
            humanStatus: human,
            inspect: detailed,
            jsonStatus: true,
            extensionErrors: 0,
          }),
        );
        complete = true;
        succeed();
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
});
send({ id: "commands", type: "get_commands" });
try {
  await done;
} finally {
  clearTimeout(timer);
  child.kill("SIGTERM");
  rmSync(cwd, { recursive: true, force: true });
}
