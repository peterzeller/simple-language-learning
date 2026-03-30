import "server-only";

import { db, ensureLearningTables } from "@/lib/db";

interface TranslationPair {
  sourceWord: string;
  targetWord: string;
  sourceLanguage: string;
  targetLanguage: string;
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

async function getOrCreateWord(language: string, word: string): Promise<number> {
  const normalizedWord = normalizeWord(word);

  const existing = await db
    .selectFrom("words")
    .select("id")
    .where("language", "=", language)
    .where("word", "=", normalizedWord)
    .executeTakeFirst();

  if (existing) {
    return existing.id;
  }

  const inserted = await db
    .insertInto("words")
    .values({
      language,
      word: normalizedWord,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return inserted.id;
}

export async function storeTranslationPairs(
  pairs: TranslationPair[],
): Promise<Map<string, number>> {
  await ensureLearningTables();

  const sourceWordToId = new Map<string, number>();

  for (const pair of pairs) {
    const sourceId = await getOrCreateWord(pair.sourceLanguage, pair.sourceWord);
    const targetId = await getOrCreateWord(pair.targetLanguage, pair.targetWord);

    sourceWordToId.set(normalizeWord(pair.sourceWord), sourceId);

    const existingLink = await db
      .selectFrom("word_links")
      .select("from_id")
      .where("from_id", "=", sourceId)
      .where("to_id", "=", targetId)
      .executeTakeFirst();

    if (!existingLink) {
      await db
        .insertInto("word_links")
        .values({
          from_id: sourceId,
          to_id: targetId,
        })
        .execute();
    }
  }

  return sourceWordToId;
}

export async function getKnownWordIdsForUser(userId: number): Promise<Set<number>> {
  await ensureLearningTables();

  const rows = await db
    .selectFrom("user_learning")
    .select((expressionBuilder) => [
      "word_id",
      expressionBuilder.fn.count<number>("id").filterWhere("is_correct", "=", true).as("correct_count"),
      expressionBuilder.fn.count<number>("id").filterWhere("is_correct", "=", false).as("incorrect_count"),
    ])
    .where("user_id", "=", userId)
    .groupBy("word_id")
    .execute();

  const knownWordIds = new Set<number>();

  for (const row of rows) {
    if (row.correct_count - row.incorrect_count >= 3) {
      knownWordIds.add(row.word_id);
    }
  }

  return knownWordIds;
}

export async function recordLearningEvent(input: {
  userId: number;
  wordId: number;
  isCorrect: boolean;
}): Promise<void> {
  await ensureLearningTables();

  await db
    .insertInto("user_learning")
    .values({
      user_id: input.userId,
      word_id: input.wordId,
      is_correct: input.isCorrect,
      attempted_at: new Date(),
    })
    .execute();
}

export async function getKnownWordsCount(userId: number): Promise<number> {
  const knownWordIds = await getKnownWordIdsForUser(userId);

  return knownWordIds.size;
}

export { normalizeWord };
