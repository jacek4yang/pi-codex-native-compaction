import { createHash } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import { check, NativeError, object } from "./errors.js";
import { validateMigration, type Migration } from "./provenance.js";
export const STRATEGY = "codex-remote-compaction-v2";
export const SENTINEL = "[Codex Remote Compaction V2 checkpoint]";
export type Item = Record<string, unknown>;
export interface Identity {
  provider: string;
  api: string;
  model: string;
  baseUrl: string;
}
export interface Checkpoint {
  schemaVersion: 1;
  strategy: typeof STRATEGY;
  protocolVersion: 2;
  identity: Identity;
  sessionId: string;
  headId: string | null;
  generation: number;
  createdAt: string;
  responseId: string;
  requestFingerprint: string;
  retained: Item[];
  compaction: Item;
  window: { inputItems: number; inputHash: string };
  usage?: { input: number; output: number; total: number };
  migration?: Migration;
  integrity: string;
}
export function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function identity(model: Model<Api>): Identity {
  // Never persist URL credentials or secret-bearing query parameters.
  const url = new URL(model.baseUrl);
  check(
    !url.username && !url.password && !url.search && !url.hash,
    "Secret-bearing/ambiguous base URL unsupported",
  );
  return {
    provider: model.provider,
    api: model.api,
    model: model.id,
    baseUrl: url.href.replace(/\/$/, ""),
  };
}
export function supported(i: Pick<Identity, "provider" | "api"> | undefined) {
  return i?.provider === "openai-codex" && i.api === "openai-codex-responses";
}
export function seal(value: Omit<Checkpoint, "integrity">): Checkpoint {
  return { ...value, integrity: hash(value) };
}
export function validateCheckpoint(
  value: unknown,
  expected?: Identity,
  sessionId?: string,
): Checkpoint {
  const c = object(value);
  check(
    c.schemaVersion === 1 && c.strategy === STRATEGY && c.protocolVersion === 2,
    "Unsupported native checkpoint schema",
  );
  const { integrity, ...body } = c;
  check(
    typeof integrity === "string" && hash(body) === integrity,
    "Checkpoint integrity mismatch",
  );
  const i = object(c.identity);
  check(supported(i as unknown as Identity), "Non-Codex checkpoint");
  check(
    ["provider", "api", "model", "baseUrl"].every(
      (k) => typeof i[k] === "string" && i[k] !== "",
    ),
    "Invalid identity",
  );
  if (expected && hash(i) !== hash(expected))
    throw new NativeError(
      "identity",
      "Checkpoint provider/API/model/endpoint mismatch",
    );
  if (sessionId && c.sessionId !== sessionId)
    throw new NativeError(
      "identity",
      "Checkpoint belongs to another session; fork migration unsupported",
    );
  check(
    typeof c.sessionId === "string" &&
      typeof c.responseId === "string" &&
      c.responseId.length > 0 &&
      typeof c.createdAt === "string",
    "Invalid checkpoint metadata",
  );
  check(
    Number.isInteger(c.generation) &&
      Number(c.generation) >= 1 &&
      typeof c.requestFingerprint === "string",
    "Invalid checkpoint generation",
  );
  check(Array.isArray(c.retained), "Invalid retained history");
  for (const item of c.retained) {
    const r = object(item);
    check(
      r.type === "message" &&
        (r.role === "user" || r.role === "developer") &&
        Array.isArray(r.content),
      "Invalid retained message",
    );
    for (const part of r.content) {
      const p = object(part);
      check(
        p.type === "input_text" && typeof p.text === "string",
        "Invalid retained content",
      );
    }
  }
  validateCompaction(c.compaction);
  if (c.migration !== undefined) validateMigration(c.migration);
  const w = object(c.window);
  check(
    Number.isInteger(w.inputItems) && typeof w.inputHash === "string",
    "Invalid native window",
  );
  return c as unknown as Checkpoint;
}
export function validateCompaction(value: unknown): Item {
  const item = object(value);
  check(
    item.type === "compaction" &&
      typeof item.encrypted_content === "string" &&
      item.encrypted_content.trim().length > 0,
    "Missing opaque encrypted compaction content",
  );
  // Explicit allowlist: do not persist transport metadata or unknown secret fields.
  check(
    Object.keys(item).every((k) =>
      ["type", "id", "encrypted_content"].includes(k),
    ),
    "Unknown compaction fields",
  );
  if (item.id !== undefined)
    check(
      typeof item.id === "string" && item.id.length > 0,
      "Invalid compaction ID",
    );
  return item;
}
