import test from "node:test";
import assert from "node:assert/strict";

import { parseBilingualSentence } from "../src/lib/parse-bilingual-sentence.ts";

test("parseBilingualSentence parses consecutive bilingual tokens and surrounding punctuation", () => {
  assert.deepEqual(parseBilingualSentence("¿⦅Cómo‖How⦆ ⦅estuvo‖was⦆ ⦅tu‖your⦆?"), [
    "¿",
    { original: "Cómo", translation: "How" },
    " ",
    { original: "estuvo", translation: "was" },
    " ",
    { original: "tu", translation: "your" },
    "?"
  ]);
});
