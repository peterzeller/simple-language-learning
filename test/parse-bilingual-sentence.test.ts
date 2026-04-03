import test from "node:test";
import assert from "node:assert/strict";

import { parseBilingualSentence } from "../src/lib/parse-bilingual-sentence.ts";

test("parseBilingualSentence parses consecutive bilingual tokens and surrounding punctuation", () => {
  assert.deepEqual(parseBilingualSentence("¿(Cómo|How) (estuvo|was) (tu|your)?"), [
    { source: "¿Cómo", target: "How" },
    { source: " estuvo", target: "was" },
    { source: " tu", target: "your" },
    { source: "?", target: "" },
  ]);
});

test("parseBilingualSentence parses correctly with parens after word", () => {
  assert.deepEqual(parseBilingualSentence("¿Cómo(How) estuvo(was) tu(your)?"), [
    { source: "¿Cómo", target: "How" },
    { source: " estuvo", target: "was" },
    { source: " tu", target: "your" },
    { source: "?", target: "" },
  ]);
});