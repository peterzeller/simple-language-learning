export interface BilingualSentencePair {
  source: string;
  target: string;
}

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
