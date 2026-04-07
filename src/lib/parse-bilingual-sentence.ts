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
export function parseBilingualSentence(sentence: string): BilingualSentencePair[] {
  let inParentheses = false;
  let afterBar = false;
  let currentBeforeParentheses = "";
  let currentSource = "";
  let currentTarget = "";
  const result: BilingualSentencePair[] = [];

  for (const char of sentence) {
    if (char === "(") {
      inParentheses = true;
      afterBar = false;
      currentSource = "";
      currentTarget = "";
    } else if (char === ")") {
      if (inParentheses) {
        if (currentTarget) {
          result.push({ source: currentBeforeParentheses + currentSource, target: currentTarget.trim() });
        } else {
          result.push({ source: currentBeforeParentheses, target: currentSource.trim() });
        }
        inParentheses = false;
        afterBar = false;
        currentBeforeParentheses = "";
        currentSource = "";
        currentTarget = "";
      } else {
        currentBeforeParentheses += char;
      }
    } else if (inParentheses) {
      if (char === "|") {
        afterBar = true;
        continue;
      }
      if (afterBar) {
        currentTarget += char;
      } else {
        currentSource += char;
      }
    } else {
      if (char == '|') {
        continue;
      }
      currentBeforeParentheses += char;
    }
  }

  if (currentBeforeParentheses) {
    result.push({ source: currentBeforeParentheses, target: "" });
  }

  return result;
}

function normalizeLettersOnly(value: string): string {
  return value.normalize("NFC").replace(/[^\p{L}]+/gu, "");
}

export function alignBilingualPairsWithOriginalText(
  originalText: string,
  pairs: BilingualSentencePair[],
): AlignedBilingualSegment[] {
  const segments: AlignedBilingualSegment[] = [];
  const wordRegex = /\p{L}+/gu;
  let pairIndex = 0;
  let lastIndex = 0;

  for (const match of originalText.matchAll(wordRegex)) {
    const fullWord = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      segments.push(originalText.slice(lastIndex, index));
    }

    const pair = pairs[pairIndex];
    const normalizedWord = normalizeLettersOnly(fullWord);
    const normalizedPairSource = normalizeLettersOnly(pair?.source ?? "");
    const translation = pair?.target?.trim() ?? "";

    segments.push({
      original: normalizedWord,
      translation,
    });

    if (normalizedPairSource && normalizedPairSource === normalizedWord) {
      pairIndex += 1;
    } else if (pair) {
      pairIndex += 1;
    }

    lastIndex = index + fullWord.length;
  }

  if (lastIndex < originalText.length) {
    segments.push(originalText.slice(lastIndex));
  }

  return segments;
}
