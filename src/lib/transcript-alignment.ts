export interface TranscriptWordTimestamp {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

interface NormalizedTimestampWord extends TranscriptWordTimestamp {
  normalizedWord: string;
}

function normalizeAlignmentWord(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "");
}

function tokenizeSourceWords(sourceText: string): string[] {
  const matches = sourceText.match(/[\p{L}\p{N}'’’-]+/gu);
  return matches?.map((word) => word.trim()).filter((word) => word.length > 0) ?? [];
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + substitutionCost);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }

  return previous[b.length] ?? Math.max(a.length, b.length);
}

function alignTranscriptToSourceWords(input: {
  sourceWords: string[];
  transcriptWords: NormalizedTimestampWord[];
}): Array<number | null> {
  const source = input.sourceWords.map((word) => normalizeAlignmentWord(word));
  const transcript = input.transcriptWords.map((word) => word.normalizedWord);
  const sourceLength = source.length;
  const transcriptLength = transcript.length;
  const dp = Array.from({ length: sourceLength + 1 }, () => new Array<number>(transcriptLength + 1).fill(Number.POSITIVE_INFINITY));
  const parent = Array.from({ length: sourceLength + 1 }, () => new Array<"match" | "delete" | "insert" | null>(transcriptLength + 1).fill(null));
  dp[0]![0] = 0;

  for (let i = 0; i <= sourceLength; i += 1) {
    for (let j = 0; j <= transcriptLength; j += 1) {
      const baseCost = dp[i]![j];
      if (!Number.isFinite(baseCost)) continue;

      if (i < sourceLength && j < transcriptLength) {
        const sourceWord = source[i] ?? "";
        const transcriptWord = transcript[j] ?? "";
        const maxLength = Math.max(1, sourceWord.length, transcriptWord.length);
        const substitutionCost = levenshteinDistance(sourceWord, transcriptWord) / maxLength;
        const nextCost = baseCost + substitutionCost;
        if (nextCost < dp[i + 1]![j + 1]!) {
          dp[i + 1]![j + 1] = nextCost;
          parent[i + 1]![j + 1] = "match";
        }
      }

      if (i < sourceLength) {
        const nextCost = baseCost + 1.15;
        if (nextCost < dp[i + 1]![j]!) {
          dp[i + 1]![j] = nextCost;
          parent[i + 1]![j] = "delete";
        }
      }

      if (j < transcriptLength) {
        const nextCost = baseCost + 1;
        if (nextCost < dp[i]![j + 1]!) {
          dp[i]![j + 1] = nextCost;
          parent[i]![j + 1] = "insert";
        }
      }
    }
  }

  const mapping = new Array<number | null>(sourceLength).fill(null);
  let i = sourceLength;
  let j = transcriptLength;
  while (i > 0 || j > 0) {
    const step = parent[i]?.[j] ?? null;
    if (step === "match") {
      mapping[i - 1] = j - 1;
      i -= 1;
      j -= 1;
      continue;
    }
    if (step === "delete") {
      i -= 1;
      continue;
    }
    if (step === "insert") {
      j -= 1;
      continue;
    }
    break;
  }

  return mapping;
}

export function repairTranscriptAgainstSourceText(input: {
  sourceText: string;
  transcriptWords: TranscriptWordTimestamp[];
}): TranscriptWordTimestamp[] {
  const sourceWords = tokenizeSourceWords(input.sourceText);
  if (sourceWords.length === 0) return input.transcriptWords;

  const transcriptWords = input.transcriptWords
    .map((word) => ({ ...word, normalizedWord: normalizeAlignmentWord(word.word) }))
    .filter((word) => word.normalizedWord.length > 0);

  if (transcriptWords.length === 0) return [];

  const mapping = alignTranscriptToSourceWords({ sourceWords, transcriptWords });
  const mappedDurations = mapping
    .map((transcriptIndex) => (
      transcriptIndex === null ? null : Math.max(0.05, transcriptWords[transcriptIndex]!.endSeconds - transcriptWords[transcriptIndex]!.startSeconds)
    ))
    .filter((value): value is number => value !== null);
  const defaultDuration = mappedDurations.length > 0
    ? mappedDurations.reduce((sum, value) => sum + value, 0) / mappedDurations.length
    : 0.35;
  const finalEnd = transcriptWords[transcriptWords.length - 1]?.endSeconds ?? 0;

  const repaired = sourceWords.map((word, index) => {
    const mappedIndex = mapping[index];
    if (mappedIndex !== null && transcriptWords[mappedIndex]) {
      const mappedWord = transcriptWords[mappedIndex];
      return { word, startSeconds: mappedWord.startSeconds, endSeconds: mappedWord.endSeconds };
    }

    let previousMappedIndex = index - 1;
    while (previousMappedIndex >= 0 && mapping[previousMappedIndex] === null) previousMappedIndex -= 1;
    let nextMappedIndex = index + 1;
    while (nextMappedIndex < mapping.length && mapping[nextMappedIndex] === null) nextMappedIndex += 1;

    const previousWord = previousMappedIndex >= 0 ? transcriptWords[mapping[previousMappedIndex] as number] : undefined;
    const nextWord = nextMappedIndex < mapping.length ? transcriptWords[mapping[nextMappedIndex] as number] : undefined;

    if (previousWord && nextWord && nextMappedIndex - previousMappedIndex > 1) {
      const missingCount = nextMappedIndex - previousMappedIndex - 1;
      const missingPosition = index - previousMappedIndex;
      const start = previousWord.endSeconds + ((nextWord.startSeconds - previousWord.endSeconds) * (missingPosition - 1)) / Math.max(1, missingCount);
      const end = previousWord.endSeconds + ((nextWord.startSeconds - previousWord.endSeconds) * missingPosition) / Math.max(1, missingCount);
      return { word, startSeconds: Math.max(0, start), endSeconds: Math.max(start + 0.05, end) };
    }

    if (previousWord) {
      const start = previousWord.endSeconds;
      return { word, startSeconds: start, endSeconds: start + defaultDuration };
    }

    if (nextWord) {
      const end = nextWord.startSeconds;
      return { word, startSeconds: Math.max(0, end - defaultDuration), endSeconds: end };
    }

    const fallbackStart = Math.max(0, (index / Math.max(1, sourceWords.length)) * finalEnd);
    return { word, startSeconds: fallbackStart, endSeconds: fallbackStart + defaultDuration };
  });

  return repaired.map((word, index) => {
    const previousEnd = index > 0 ? repaired[index - 1]?.endSeconds ?? 0 : 0;
    const clampedStart = Math.max(previousEnd, word.startSeconds);
    const clampedEnd = Math.max(clampedStart + 0.05, word.endSeconds);
    return { word: word.word, startSeconds: clampedStart, endSeconds: clampedEnd };
  });
}
