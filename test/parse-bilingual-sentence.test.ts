import test from "node:test";
import assert from "node:assert/strict";

import { CURRENT_TRANSLATION_FORMAT_VERSION, parseBilingualSentence } from "../src/lib/parse-bilingual-sentence.ts";

test("parseBilingualSentence parses versioned mixed JSON segments", () => {
  assert.deepEqual(
    parseBilingualSentence('{"version":2,"segments":[{"original":"Hallo","translation":"Hello"},",\\n",{"original":"Welt","translation":"World"},"!"]}'),
    {
      version: CURRENT_TRANSLATION_FORMAT_VERSION,
      segments: [
        { source: "Hallo", target: "Hello" },
        ",\n",
        { source: "Welt", target: "World" },
        "!",
      ],
    },
  );
});

test("parseBilingualSentence returns null for legacy parenthesis format", () => {
  assert.equal(parseBilingualSentence("¿(Cómo|How) (estuvo|was) (tu|your)?"), null);
});
