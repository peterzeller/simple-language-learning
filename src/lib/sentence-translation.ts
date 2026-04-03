import "server-only";

import { sql } from "kysely";
import { ensureLearningTables, getDb } from "@/lib/db";
import {
  getUserWordKnowledgeTable,
  normalizeWord,
  storeTranslationPairs,
} from "@/lib/learning";
import { parseBilingualSentence } from "@/lib/parse-bilingual-sentence";

const ENRICHING_PROMPT_BUILDERS = [
  (topic: string) => `Create a joke in Spanish about ${topic}.`,
  (topic: string) => `Create a dialogue in Spanish where two people talk about ${topic}.`,
  (topic: string) => `Create a short story in Spanish where ${topic} appears.`,
  (topic: string) => `Create a vivid scene in Spanish inspired by ${topic}.`,
  (topic: string) => `Create a mini mystery in Spanish related to ${topic}.`,
];

export interface SentenceToken {
  source: string;
  target: string;
  wordId: number;
  isKnown: boolean;
  revealByDefault: boolean;
  isQuestion: boolean;
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

async function saveGeneratedSentence(input: {
  topic: string;
  rawSentence: string;
}): Promise<void> {
  await ensureLearningTables();
  const db = getDb();

  await db
    .insertInto("sentence_translations")
    .values({
      topic: input.topic,
      raw_sentence: input.rawSentence,
    })
    .execute();
}

async function getRandomSavedSentence(): Promise<string | null> {
  await ensureLearningTables();
  const db = getDb();

  const row = await db
    .selectFrom("sentence_translations")
    .select("raw_sentence")
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .executeTakeFirst();

  return row?.raw_sentence ?? null;
}

async function generateFromOpenAI(topic: string): Promise<string | null> {
  const apiKey = process.env.OPEN_AI_KEY;

  if (!apiKey) {
    console.warn("Missing OpenAI API key, falling back to default sentence.");
    return null;
  }

  const basePrompt = topic.trim();
  const usePromptAsIs = basePrompt.length > 50;
  const selectedPrompt = usePromptAsIs
    ? basePrompt
    : ENRICHING_PROMPT_BUILDERS[Math.floor(Math.random() * ENRICHING_PROMPT_BUILDERS.length)](
      basePrompt || "everyday life",
    );
  const firstPrompt = `You are helping Spanish learners. Write an interesting Spanish text based on this prompt: "${selectedPrompt}". Return JSON only with key "spanishText".`;

  async function requestOpenAIJson<T>(input: {
    prompt: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<T | null> {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: input.prompt,
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            schema: input.schema,
            strict: true,
          },
        },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const texts: string[] = [];

    for (const outputItem of json.output ?? []) {
      for (const item of outputItem.content) {
        if (item.type === "output_text") {
          texts.push(item.text);
        }

        if (item.type === "text") {
          texts.push(item.value);
        }
      }
    }

    for (const text of texts) {
      try {
        return JSON.parse(text) as T;
      } catch {
        continue;
      }
    }

    return null;
  }

  try {
    const firstResponse = await requestOpenAIJson<{ spanishText: string }>({
      prompt: firstPrompt,
      schemaName: "spanish_text_response",
      schema: {
        type: "object",
        properties: {
          spanishText: { type: "string" },
        },
        required: ["spanishText"],
        additionalProperties: false,
      },
    });
    const spanishText = firstResponse?.spanishText?.trim();

    if (!spanishText) {
      console.warn("OpenAI generation step failed, falling back to default sentence.");
      return null;
    }

    const translationRequestPrompt = `Transform the following Spanish text into bilingual token format where every Spanish token is paired with an honest, literal English translation in the form (spanish|english). Do not merge tokens or smooth grammar for natural English. Keep token order and punctuation exactly as in Spanish, and if the literal English sounds unnatural, keep it anyway. Example: "me contaron" -> "(me|me) (contaron|they told)". Return JSON only with key "sentence". Spanish text: "${spanishText}"`;
    const secondResponse = await requestOpenAIJson<{ sentence: string }>({
      prompt: translationRequestPrompt,
      schemaName: "bilingual_sentence_response",
      schema: {
        type: "object",
        properties: {
          sentence: { type: "string" },
        },
        required: ["sentence"],
        additionalProperties: false,
      },
    });

    if (!secondResponse?.sentence?.trim()) {
      console.warn("OpenAI translation step failed, falling back to default sentence.");
      return null;
    }

    const sentence = secondResponse.sentence;

    if (parseBilingualSentence(sentence).length === 0) {
      console.warn("OpenAI returned an invalid bilingual format, falling back to default sentence.");
      return null;
    }

    return sentence;
  } catch (e) {
    console.error("Error generating sentence from OpenAI:", e);
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

async function createSentenceExerciseFromRawSentence(input: {
  sentence: string;
  userId: number;
}): Promise<SentenceExercise> {
  console.log("Generated AI sentence:", input.sentence);
  const sentence = input.sentence;
  const pairs = parseBilingualSentence(sentence);

  if (pairs.length === 0) {
    throw new Error(`Could not generate a valid bilingual sentence from '${sentence}'`);
  }

  const wordIdMap = await storeTranslationPairs(
    pairs.map((pair) => ({
      sourceWord: pair.source,
      targetWord: pair.target,
      sourceLanguage: "es",
      targetLanguage: "en",
    })),
  );

  const wordKnowledgeTable = await getUserWordKnowledgeTable(input.userId);
  const knownWordIds = new Set(
    wordKnowledgeTable
      .filter((row) => row.knowledgeScore > 0)
      .map((row) => row.wordId),
  );
  const scoreByWordId = new Map(
    wordKnowledgeTable.map((row) => [row.wordId, row.knowledgeScore]),
  );
  const tokens: SentenceToken[] = pairs.map((pair) => {
    const wordId = wordIdMap.get(normalizeWord(pair.source));

    if (!wordId) {
      throw new Error("Missing word id for generated sentence token.");
    }

    const score = scoreByWordId.get(wordId);

    return {
      source: pair.source,
      target: pair.target,
      wordId,
      isKnown: knownWordIds.has(wordId),
      revealByDefault: score === undefined || score === 0,
      isQuestion: false,
    };
  });

  const questionIndexes = getRandomQuestionIndexes(tokens.length);
  for (const index of questionIndexes) {
    tokens[index].isQuestion = true;
  }
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

export async function createSentenceExerciseFromPrompt(input: {
  topic: string;
  userId: number;
}): Promise<SentenceExercise> {
  const aiSentence = await generateFromOpenAI(input.topic);
  const sentence = aiSentence ?? fallbackSentence(input.topic);
  await saveGeneratedSentence({
    topic: input.topic,
    rawSentence: sentence,
  });

  return createSentenceExerciseFromRawSentence({
    sentence,
    userId: input.userId,
  });
}

export async function createSentenceExerciseFromRandomSentence(input: {
  topic: string;
  userId: number;
}): Promise<SentenceExercise> {
  const sentence = await getRandomSavedSentence();

  if (!sentence) {
    return createSentenceExerciseFromPrompt(input);
  }

  return createSentenceExerciseFromRawSentence({
    sentence,
    userId: input.userId,
  });
}
