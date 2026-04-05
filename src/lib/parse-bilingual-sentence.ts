export const CURRENT_TRANSLATION_FORMAT_VERSION = 2;

export interface BilingualSentencePair {
  source: string;
  target: string;
}

export type BilingualSentenceSegment = BilingualSentencePair | string;

interface ParsedBilingualWord {
  original: string;
  translation: string;
}

interface ParsedBilingualSentence {
  version: number;
  segments: unknown[];
}

function isParsedBilingualWord(value: unknown): value is ParsedBilingualWord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ParsedBilingualWord>;
  return typeof candidate.original === "string" && typeof candidate.translation === "string";
}

function parseStoredSentence(value: unknown): ParsedBilingualSentence | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ParsedBilingualSentence>;
  if (typeof candidate.version !== "number" || !Array.isArray(candidate.segments)) {
    return null;
  }

  return {
    version: candidate.version,
    segments: candidate.segments,
  };
}

export function parseBilingualSentence(sentence: string): { version: number; segments: BilingualSentenceSegment[] } | null {
  try {
    const parsed = parseStoredSentence(JSON.parse(sentence));

    if (!parsed) {
      return null;
    }

    const segments: BilingualSentenceSegment[] = [];

    for (const item of parsed.segments) {
      if (typeof item === "string") {
        segments.push(item);
        continue;
      }

      if (!isParsedBilingualWord(item)) {
        return null;
      }

      segments.push({ source: item.original.trim(), target: item.translation.trim() });
    }

    return { version: parsed.version, segments };
  } catch {
    return null;
  }
}

export function isBilingualWordSegment(segment: BilingualSentenceSegment): segment is BilingualSentencePair {
  return typeof segment !== "string";
}
