import test from "node:test";
import assert from "node:assert/strict";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { convertResponsesMessages as original } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { codexStream, convertResponsesMessages } from "../src/pi-ai.js";
test("public-export adapter shares exact host functions and module state", () => {
  assert.equal(codexStream, streamSimple);
  assert.equal(convertResponsesMessages, original);
});
