import test from "node:test";
import assert from "node:assert/strict";

import { repairTranscriptAgainstSourceText, type TranscriptWordTimestamp } from "../src/lib/transcript-alignment.ts";

function tokenizeSourceWords(sourceText: string): string[] {
  return sourceText.match(/[\p{L}\p{N}'’’-]+/gu) ?? [];
}

test("repairTranscriptAgainstSourceText keeps all source words and preserves sequence for provided Rome sample", () => {
  const sourceText = "A las siete de la mañana, Roma ya estaba despierta. No del todo, pero sí lo suficiente para mostrar su doble vida: la ciudad antigua y la ciudad de hoy.";
  const transcriptWords: TranscriptWordTimestamp[] = [
    { word: "A", startSeconds: 0, endSeconds: 0.18 },
    { word: "las", startSeconds: 0.18, endSeconds: 0.46 },
    { word: "siete", startSeconds: 0.46, endSeconds: 0.76 },
    { word: "de", startSeconds: 0.76, endSeconds: 0.98 },
    { word: "la", startSeconds: 0.98, endSeconds: 1.46 },
    { word: "mañana", startSeconds: 1.46, endSeconds: 1.51 },
    { word: "Roma", startSeconds: 2.04, endSeconds: 2.34 },
    { word: "ya", startSeconds: 2.34, endSeconds: 2.8 },
    { word: "estaba", startSeconds: 2.8, endSeconds: 3.02 },
    { word: "despierta", startSeconds: 3.02, endSeconds: 3.68 },
    { word: "No", startSeconds: 4.3, endSeconds: 4.42 },
    { word: "del", startSeconds: 4.42, endSeconds: 4.66 },
    { word: "todo", startSeconds: 4.66, endSeconds: 4.9 },
    { word: "pero", startSeconds: 5.42, endSeconds: 5.56 },
    { word: "sí", startSeconds: 5.56, endSeconds: 5.86 },
    { word: "lo", startSeconds: 5.86, endSeconds: 6.1 },
    { word: "suficiente", startSeconds: 6.1, endSeconds: 6.5 },
    { word: "para", startSeconds: 6.5, endSeconds: 6.78 },
    { word: "mostrar", startSeconds: 6.78, endSeconds: 7.14 },
    { word: "su", startSeconds: 7.14, endSeconds: 7.54 },
    { word: "doble", startSeconds: 7.54, endSeconds: 7.78 },
    { word: "vida", startSeconds: 7.78, endSeconds: 8.04 },
    { word: "la", startSeconds: 8.64, endSeconds: 8.86 },
    { word: "ciudad", startSeconds: 8.86, endSeconds: 9.04 },
    { word: "antigua", startSeconds: 9.04, endSeconds: 9.62 },
    { word: "y", startSeconds: 9.62, endSeconds: 9.9 },
    { word: "la", startSeconds: 9.9, endSeconds: 10.3 },
    { word: "ciudad", startSeconds: 10.3, endSeconds: 10.35 },
    { word: "de", startSeconds: 10.35, endSeconds: 10.72 },
    { word: "hoy", startSeconds: 10.72, endSeconds: 10.77 },
  ];

  const repaired = repairTranscriptAgainstSourceText({ sourceText, transcriptWords });
  const sourceTokens = tokenizeSourceWords(sourceText);

  assert.equal(repaired.length, sourceTokens.length);
  assert.deepEqual(repaired.map((word) => word.word), sourceTokens);

  for (let index = 1; index < repaired.length; index += 1) {
    assert.ok(repaired[index]!.startSeconds >= repaired[index - 1]!.startSeconds);
    assert.ok(repaired[index]!.endSeconds >= repaired[index]!.startSeconds);
  }

  const roma = repaired.find((word) => word.word === "Roma");
  assert.ok(roma);
  assert.ok(roma!.startSeconds >= 2);
});

test("repairTranscriptAgainstSourceText interpolates missing words with monotonic timings", () => {
  const sourceText = "Pero la luz la dibujó con tanta claridad";
  const transcriptWords: TranscriptWordTimestamp[] = [
    { word: "Pero", startSeconds: 95.9, endSeconds: 96.14 },
    { word: "la", startSeconds: 96.14, endSeconds: 96.56 },
    { word: "dibujó", startSeconds: 96.92, endSeconds: 97.22 },
    { word: "con", startSeconds: 97.22, endSeconds: 97.54 },
    { word: "tanta", startSeconds: 97.54, endSeconds: 97.78 },
    { word: "claridad", startSeconds: 97.78, endSeconds: 98.3 },
  ];

  const repaired = repairTranscriptAgainstSourceText({ sourceText, transcriptWords });
  assert.deepEqual(
    repaired.map((word) => word.word),
    ["Pero", "la", "luz", "la", "dibujó", "con", "tanta", "claridad"],
  );

  const luz = repaired.find((word) => word.word === "luz");
  const dibujo = repaired.find((word) => word.word === "dibujó");
  assert.ok(luz);
  assert.ok(dibujo);
  assert.ok(luz!.startSeconds >= 96.14);
  assert.ok(luz!.endSeconds <= dibujo!.startSeconds);
});
