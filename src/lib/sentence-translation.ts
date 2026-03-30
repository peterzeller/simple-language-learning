import "server-only";

import { getKnownWordIdsForUser, normalizeWord, storeTranslationPairs } from "@/lib/learning";

export interface SentenceToken {
  source: string;
  target: string;
  wordId: number;
  isKnown: boolean;
}

export interface SentenceQuestion {
  tokenIndex: number;
  options: string[];
  correctAnswer: string;
}

export interface SentenceExercise {
  tokens: SentenceToken[];
  questions: SentenceQuestion[];
}

function parseBilingualSentence(sentence: string): Array<{ source: string; target: string }> {
  const matches = sentence.matchAll(/\(([^|)]+)\|([^\)]+)\)/g);
  const pairs: Array<{ source: string; target: string }> = [];

  for (const match of matches) {
    const source = match[1]?.trim();
    const target = match[2]?.trim();

    if (!source || !target) {
      continue;
    }

    pairs.push({ source, target });
  }

  return pairs;
}

async function generateFromOpenAI(topic: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const prompt = `Generate one short bilingual training sentence about "${topic}" in this exact format: ¿(Cómo|How) (estuvo|was) (tu|your) (fin|end) (de|of) (semana|week)?. Use Spanish as first language and English as second language. Return JSON only with key \"sentence\".`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "sentence_response",
            schema: {
              type: "object",
              properties: {
                sentence: { type: "string" },
              },
              required: ["sentence"],
              additionalProperties: false,
            },
          },
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const json = (await response.json()) as { output_text?: string };

    if (!json.output_text) {
      return null;
    }

    const parsed = JSON.parse(json.output_text) as { sentence?: string };

    return parsed.sentence ?? null;
  } catch {
    return null;
  }
}

function fallbackSentence(topic: string): string {
  const normalized = topic.trim().toLowerCase();

  if (normalized === "travel") {
    return "(Me|I) (gusta|like) (viajar|to travel) (en|in) (tren|train).";
  }

  if (normalized === "food") {
    return "(Nosotros|We) (comemos|eat) (sopa|soup) (cada|every) (noche|night).";
  }

  return "¿(Cómo|How) (estuvo|was) (tu|your) (fin|end) (de|of) (semana|week)?";
}

function getRandomQuestionIndexes(length: number): number[] {
  const indexes = Array.from({ length }, (_, index) => index);

  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[swapIndex]] = [indexes[swapIndex], indexes[index]];
  }

  return indexes.slice(0, Math.min(2, length));
}

export async function createSentenceExercise(input: {
  topic: string;
  userId: number;
}): Promise<SentenceExercise> {
  const aiSentence = await generateFromOpenAI(input.topic);
  const sentence = aiSentence ?? fallbackSentence(input.topic);
  const pairs = parseBilingualSentence(sentence);

  if (pairs.length === 0) {
    throw new Error("Could not generate a valid bilingual sentence.");
  }

  const wordIdMap = await storeTranslationPairs(
    pairs.map((pair) => ({
      sourceWord: pair.source,
      targetWord: pair.target,
      sourceLanguage: "es",
      targetLanguage: "en",
    })),
  );

  const knownWordIds = await getKnownWordIdsForUser(input.userId);
  const tokens: SentenceToken[] = pairs.map((pair) => {
    const wordId = wordIdMap.get(normalizeWord(pair.source));

    if (!wordId) {
      throw new Error("Missing word id for generated sentence token.");
    }

    return {
      source: pair.source,
      target: pair.target,
      wordId,
      isKnown: knownWordIds.has(wordId),
    };
  });

  const questionIndexes = getRandomQuestionIndexes(tokens.length);
  const optionPool = Array.from(new Set(tokens.map((token) => token.target)));

  const questions = questionIndexes.map((tokenIndex) => {
    const correctAnswer = tokens[tokenIndex].target;
    const wrongAnswers = optionPool.filter((option) => option !== correctAnswer).slice(0, 3);
    const options = [correctAnswer, ...wrongAnswers];

    for (let index = options.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [options[index], options[swapIndex]] = [options[swapIndex], options[index]];
    }

    return {
      tokenIndex,
      options,
      correctAnswer,
    };
  });

  return { tokens, questions };
}
