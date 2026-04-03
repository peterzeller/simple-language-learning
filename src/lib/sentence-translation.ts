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

const STORY_CONTEXT_TAIL_LIMIT = 6;

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

export interface StoryContext {
  storyId: number | null;
  sentenceIndex: number | null;
  outline: string | null;
}

export interface SentenceExercise {
  tokens: SentenceToken[];
  questions: SentenceQuestion[];
  originalSentence: string;
  story: StoryContext;
}

function extractOriginalSentenceFromBilingual(input: string): string {
  const pairs = parseBilingualSentence(input);

  if (pairs.length === 0) {
    return input;
  }

  return pairs.map((pair) => pair.source).join(" ");
}

async function saveGeneratedSentence(input: {
  topic: string;
  rawSentence: string;
  originalSentence: string;
  storyId?: number | null;
  storyIndex?: number | null;
}): Promise<void> {
  await ensureLearningTables();
  const db = getDb();

  await db
    .insertInto("sentence_translations")
    .values({
      topic: input.topic,
      raw_sentence: input.rawSentence,
      original_sentence: input.originalSentence,
      story_id: input.storyId ?? null,
      story_index: input.storyIndex ?? null,
    })
    .execute();
}

interface SavedSentenceRow {
  raw_sentence: string;
  original_sentence: string | null;
  story_id: number | null;
  story_index: number | null;
}

async function getRandomSavedSentence(): Promise<SavedSentenceRow | null> {
  await ensureLearningTables();
  const db = getDb();

  const row = await db
    .selectFrom("sentence_translations")
    .select(["raw_sentence", "original_sentence", "story_id", "story_index"])
    .orderBy(sql`RANDOM()`)
    .limit(1)
    .executeTakeFirst();

  return row ?? null;
}

async function requestOpenAIJson<T>(input: {
  prompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<T | null> {
  const apiKey = process.env.OPEN_AI_KEY;

  if (!apiKey) {
    return null;
  }

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

async function convertSpanishToBilingualSentence(spanishText: string): Promise<string | null> {
  const translationRequestPrompt = `Transform the following Spanish text into bilingual token format where each Spanish token is paired with a natural English translation like (hola|hello). Preserve punctuation and order. Return JSON only with key "sentence". Spanish text: "${spanishText}"`;
  const response = await requestOpenAIJson<{ sentence: string }>({
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

  if (!response?.sentence?.trim()) {
    return null;
  }

  const sentence = response.sentence.trim();

  if (parseBilingualSentence(sentence).length === 0) {
    return null;
  }

  return sentence;
}

async function generateSpanishText(topic: string): Promise<string | null> {
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
  const prompt = `You are helping Spanish learners. Write an interesting Spanish text based on this prompt: "${selectedPrompt}". Return JSON only with key "spanishText".`;

  const response = await requestOpenAIJson<{ spanishText: string }>({
    prompt,
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

  return response?.spanishText?.trim() || null;
}

async function generateFromOpenAI(topic: string): Promise<{
  rawSentence: string;
  originalSentence: string;
} | null> {
  try {
    const spanishText = await generateSpanishText(topic);

    if (!spanishText) {
      return null;
    }

    const sentence = await convertSpanishToBilingualSentence(spanishText);

    if (!sentence) {
      console.warn("OpenAI translation step failed, falling back to default sentence.");
      return null;
    }

    return {
      rawSentence: sentence,
      originalSentence: spanishText,
    };
  } catch (e) {
    console.error("Error generating sentence from OpenAI:", e);
    return null;
  }
}

function fallbackSentence(topic: string): { rawSentence: string; originalSentence: string } {
  const normalized = topic.trim().toLowerCase();

  if (normalized === "travel") {
    return {
      rawSentence: "(Me|I) (gusta|like) (viajar|to travel) (en|in) (tren|train).",
      originalSentence: "Me gusta viajar en tren.",
    };
  }

  if (normalized === "food") {
    return {
      rawSentence: "(Nosotros|We) (comemos|eat) (sopa|soup) (cada|every) (noche|night).",
      originalSentence: "Nosotros comemos sopa cada noche.",
    };
  }

  return {
    rawSentence: "¿(Cómo|How) (estuvo|was) (tu|your) (fin|end) (de|of) (semana|week)?",
    originalSentence: "¿Cómo estuvo tu fin de semana?",
  };
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
  originalSentence?: string;
  storyId?: number | null;
  storyIndex?: number | null;
  storyOutline?: string | null;
  userId: number;
}): Promise<SentenceExercise> {
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

  return {
    tokens,
    questions,
    originalSentence: input.originalSentence ?? extractOriginalSentenceFromBilingual(input.sentence),
    story: {
      storyId: input.storyId ?? null,
      sentenceIndex: input.storyIndex ?? null,
      outline: input.storyOutline ?? null,
    },
  };
}

async function createStoryOutline(topic: string): Promise<string> {
  const defaultOutline = `Story premise: ${topic}.\nCharacters: an explorer, a skeptical friend, and a wise local guide.\nLocations: a small town, a mysterious path, and an ancient landmark.\nArc: discovery, rising tension, conflict, and hopeful resolution.`;

  const response = await requestOpenAIJson<{ outline: string }>({
    prompt:
      `Create a concise but useful long-term book outline for a Spanish story about "${topic}". ` +
      "Include plot arc, character notes, and locations. Return JSON with key outline.",
    schemaName: "story_outline_response",
    schema: {
      type: "object",
      properties: {
        outline: { type: "string" },
      },
      required: ["outline"],
      additionalProperties: false,
    },
  });

  return response?.outline?.trim() || defaultOutline;
}

async function createStory(topic: string): Promise<{ id: number; outline: string }> {
  await ensureLearningTables();
  const db = getDb();
  const outline = await createStoryOutline(topic);

  const row = await db
    .insertInto("stories")
    .values({
      topic,
      outline,
    })
    .returning(["id", "outline"])
    .executeTakeFirstOrThrow();

  return row;
}

async function getStoryWithRecentContext(storyId: number): Promise<{
  id: number;
  topic: string;
  outline: string;
  recentOriginalSentences: string[];
  nextStoryIndex: number;
} | null> {
  await ensureLearningTables();
  const db = getDb();

  const story = await db
    .selectFrom("stories")
    .select(["id", "topic", "outline"])
    .where("id", "=", storyId)
    .executeTakeFirst();

  if (!story) {
    return null;
  }

  const rows = await db
    .selectFrom("sentence_translations")
    .select(["story_index", "original_sentence", "raw_sentence"])
    .where("story_id", "=", storyId)
    .where("story_index", "is not", null)
    .orderBy("story_index", "desc")
    .limit(STORY_CONTEXT_TAIL_LIMIT)
    .execute();

  const chronologicallySorted = [...rows].sort((a, b) => (a.story_index ?? 0) - (b.story_index ?? 0));
  const recentOriginalSentences = chronologicallySorted.map((row) =>
    row.original_sentence ?? extractOriginalSentenceFromBilingual(row.raw_sentence),
  );
  const maxIndex = rows.reduce((highest, row) => {
    if (row.story_index === null) {
      return highest;
    }

    return Math.max(highest, row.story_index);
  }, -1);

  return {
    ...story,
    recentOriginalSentences,
    nextStoryIndex: maxIndex + 1,
  };
}

async function generateStoryContinuation(input: {
  topic: string;
  outline: string;
  tail: string[];
}): Promise<{ rawSentence: string; originalSentence: string } | null> {
  const continuationPrompt =
    `Continue this Spanish story with exactly one sentence.\n` +
    `Topic: ${input.topic}\n` +
    `Outline:\n${input.outline}\n` +
    `Recent tail:\n${input.tail.join(" ")}\n` +
    "Return JSON with key spanishText.";

  const response = await requestOpenAIJson<{ spanishText: string }>({
    prompt: continuationPrompt,
    schemaName: "story_continuation_response",
    schema: {
      type: "object",
      properties: {
        spanishText: { type: "string" },
      },
      required: ["spanishText"],
      additionalProperties: false,
    },
  });

  const originalSentence = response?.spanishText?.trim();

  if (!originalSentence) {
    return null;
  }

  const rawSentence = await convertSpanishToBilingualSentence(originalSentence);

  if (!rawSentence) {
    return null;
  }

  return { rawSentence, originalSentence };
}

export async function createSentenceExerciseFromPrompt(input: {
  topic: string;
  userId: number;
}): Promise<SentenceExercise> {
  const story = await createStory(input.topic);
  const generated = await generateFromOpenAI(input.topic);
  const fallback = fallbackSentence(input.topic);
  const sentence = generated ?? fallback;

  await saveGeneratedSentence({
    topic: input.topic,
    rawSentence: sentence.rawSentence,
    originalSentence: sentence.originalSentence,
    storyId: story.id,
    storyIndex: 0,
  });

  return createSentenceExerciseFromRawSentence({
    sentence: sentence.rawSentence,
    originalSentence: sentence.originalSentence,
    storyId: story.id,
    storyIndex: 0,
    storyOutline: story.outline,
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
    sentence: sentence.raw_sentence,
    originalSentence:
      sentence.original_sentence ?? extractOriginalSentenceFromBilingual(sentence.raw_sentence),
    storyId: sentence.story_id,
    storyIndex: sentence.story_index,
    userId: input.userId,
  });
}

export async function continueStoryExercise(input: {
  storyId: number;
  userId: number;
}): Promise<SentenceExercise> {
  const storyWithContext = await getStoryWithRecentContext(input.storyId);

  if (!storyWithContext) {
    throw new Error("Story not found.");
  }

  const generated = await generateStoryContinuation({
    topic: storyWithContext.topic,
    outline: storyWithContext.outline,
    tail: storyWithContext.recentOriginalSentences,
  });
  const fallback = fallbackSentence(storyWithContext.topic);
  const sentence = generated ?? fallback;

  await saveGeneratedSentence({
    topic: storyWithContext.topic,
    rawSentence: sentence.rawSentence,
    originalSentence: sentence.originalSentence,
    storyId: storyWithContext.id,
    storyIndex: storyWithContext.nextStoryIndex,
  });

  return createSentenceExerciseFromRawSentence({
    sentence: sentence.rawSentence,
    originalSentence: sentence.originalSentence,
    storyId: storyWithContext.id,
    storyIndex: storyWithContext.nextStoryIndex,
    storyOutline: storyWithContext.outline,
    userId: input.userId,
  });
}
