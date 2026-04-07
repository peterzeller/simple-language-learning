export interface BilingualSentencePair {
  source: string;
  target: string;
}

export interface AlignedBilingualWord {
  original: string;
  translation: string;
}

export type AlignedBilingualSegment = AlignedBilingualWord | string;

// Parses a sentence expected to have repeated "(source|target)" segments.
export function parseBilingualSentence(sentence: string): AlignedBilingualSegment[] {
  let inParentheses = false;
  let afterBar = false;
  let currentBeforeParentheses = "";
  let currentSource = "";
  let currentTarget = "";
  const result: AlignedBilingualSegment[] = [];

  for (const char of sentence) {
    if (char === "⦅") {
      if (currentBeforeParentheses) {
        result.push(currentBeforeParentheses);
        currentBeforeParentheses = "";
      }
      inParentheses = true;
      afterBar = false;
      currentSource = "";
      currentTarget = "";
    } else if (char === "⦆") {
      if (inParentheses) {
        result.push({ original: currentSource, translation: currentTarget.trim() });
        inParentheses = false;
        afterBar = false;
        currentBeforeParentheses = "";
        currentSource = "";
        currentTarget = "";
      } else {
        currentBeforeParentheses += char;
      }
    } else if (inParentheses) {
      if (char === "‖") {
        afterBar = true;
        continue;
      }
      if (afterBar) {
        currentTarget += char;
      } else {
        currentSource += char;
      }
    } else {
      if (char == '‖') {
        continue;
      }
      currentBeforeParentheses += char;
    }
  }

  if (currentBeforeParentheses) {
    result.push(currentBeforeParentheses);
  }

  return result;
}

function normalizeLettersOnly(value: string): string {
  return value.normalize("NFC").replace(/[^\p{L}]+/gu, "");
}
