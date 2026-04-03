import "server-only";

import { sql } from "kysely";

import { ensureLearningTables, getDb } from "@/lib/db";

const LEARNING_HALF_LIFE_DAYS = 14;
const PERFECT_SCORE_DECAY_DAYS = 21;

interface TranslationPair {
  sourceWord: string;
  targetWord: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface UserWordKnowledge {
  wordId: number;
  language: string;
  word: string;
  attempts: number;
  correctAttempts: number;
  incorrectAttempts: number;
  lastAttemptedAt: Date;
  lastCorrectAt: Date | null;
  knowledgeScore: number;
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

async function getOrCreateWord(language: string, word: string): Promise<number> {
  const db = getDb();
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
  const db = getDb();

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
  const db = getDb();

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
  const db = getDb();

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
  await ensureLearningTables();
  const db = getDb();

  const result = await db
    .selectFrom("user_learning")
    .select((expressionBuilder) => [
      expressionBuilder.fn.count<number>("word_id").distinct().as("count"),
    ])
    .where("user_id", "=", userId)
    .where("is_correct", "=", true)
    .executeTakeFirst();

  return result?.count ?? 0;
}

export async function getUserWordKnowledgeTable(userId: number): Promise<UserWordKnowledge[]> {
  await ensureLearningTables();
  const db = getDb();

  const scoredRows = await db
    .selectFrom("user_learning")
    .innerJoin("words", "words.id", "user_learning.word_id")
    .select((expressionBuilder) => [
      "user_learning.word_id as wordId",
      "words.language as language",
      "words.word as word",
      expressionBuilder.fn.count<number>("user_learning.id").as("attempts"),
      expressionBuilder.fn
        .count<number>("user_learning.id")
        .filterWhere("user_learning.is_correct", "=", true)
        .as("correctAttempts"),
      expressionBuilder.fn
        .count<number>("user_learning.id")
        .filterWhere("user_learning.is_correct", "=", false)
        .as("incorrectAttempts"),
      expressionBuilder.fn.max<Date>("user_learning.attempted_at").as("lastAttemptedAt"),
      expressionBuilder.fn
        .max<Date>(
          expressionBuilder
            .case()
            .when("user_learning.is_correct", "=", true)
            .then(expressionBuilder.ref("user_learning.attempted_at"))
            .else(null)
            .end(),
        )
        .as("lastCorrectAt"),
      sql<number>`COALESCE(
        SUM(
          (
            CASE WHEN ${expressionBuilder.ref("user_learning.is_correct")} THEN 1.0 ELSE -0.7 END
          ) * EXP(
            -EXTRACT(EPOCH FROM (
              CURRENT_TIMESTAMP - ${expressionBuilder.ref("user_learning.attempted_at")}
            )) / ${LEARNING_HALF_LIFE_DAYS * 24 * 60 * 60}
          )
        ),
        0
      )`.as("knowledgeScoreRaw"),
    ])
    .where("user_learning.user_id", "=", userId)
    .groupBy(["user_learning.word_id", "words.language", "words.word"])
    .execute();

  return scoredRows
    .map((row) => {
      const daysSinceLastCorrect =
        row.lastCorrectAt === null
          ? Number.POSITIVE_INFINITY
          : (Date.now() - row.lastCorrectAt.getTime()) / (1000 * 60 * 60 * 24);
      const freshnessMultiplier =
        row.lastCorrectAt === null
          ? 0
          : Math.exp(-daysSinceLastCorrect / PERFECT_SCORE_DECAY_DAYS);
      const weightedAndDecayedScore = Math.max(
        0,
        Math.min(1, row.knowledgeScoreRaw),
      );
      const knowledgeScore = Math.max(
        0,
        Math.min(1, weightedAndDecayedScore * freshnessMultiplier),
      );

      return {
        ...row,
        knowledgeScore,
      };
    })
    .sort((first, second) => {
      if (second.knowledgeScore !== first.knowledgeScore) {
        return second.knowledgeScore - first.knowledgeScore;
      }

      return second.lastAttemptedAt.getTime() - first.lastAttemptedAt.getTime();
    });
}

export { normalizeWord };
