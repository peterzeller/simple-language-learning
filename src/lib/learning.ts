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

export interface VocabularyQuestion {
  wordId: number;
  sourceWord: string;
  correctTranslation: string;
  options: string[];
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
  return word.trim().replaceAll(/\p{P}+/gu, "").trim().toLowerCase();
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

    await db
      .insertInto("word_links")
      .values({
        from_id: sourceId,
        to_id: targetId,
        count: 1,
      })
      .onConflict((builder) =>
        builder.columns(["from_id", "to_id"]).doUpdateSet((expressionBuilder) => ({
          count: sql`${expressionBuilder.ref("word_links.count")} + 1`,
        })),
      )
      .execute();
  }

  return sourceWordToId;
}

export async function getKnownWordIdsForUser(userId: number): Promise<Set<number>> {
  const knownWordIds = new Set<number>();
  const wordKnowledge = await getUserWordKnowledgeTable(userId);

  for (const row of wordKnowledge) {
    if (row.knowledgeScore > 0) {
      knownWordIds.add(row.wordId);
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

function shuffle<T>(values: T[]): T[] {
  const clone = [...values];

  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }

  return clone;
}

export async function getVocabularyQuestionForUser(
  input: { userId: number; learningLanguage: string; knownLanguage: string },
): Promise<VocabularyQuestion | null> {
  await ensureLearningTables();
  const db = getDb();

  const candidateRows = await db
    .selectFrom("word_links")
    .innerJoin("words as source_words", "source_words.id", "word_links.from_id")
    .innerJoin("words as target_words", "target_words.id", "word_links.to_id")
    .select([
      "source_words.id as wordId",
      "source_words.word as sourceWord",
      "target_words.word as targetWord",
      "word_links.count as translationCount",
    ])
    .where("source_words.language", "=", input.learningLanguage)
    .where("target_words.language", "=", input.knownLanguage)
    .execute();

  if (candidateRows.length === 0) {
    return null;
  }

  const candidateByWordId = new Map<
    number,
    { wordId: number; sourceWord: string; targetWord: string; translationCount: number }
  >();

  for (const row of candidateRows) {
    const existing = candidateByWordId.get(row.wordId);

    if (
      !existing
      || row.translationCount > existing.translationCount
      || (row.translationCount === existing.translationCount && Math.random() < 0.5)
    ) {
      candidateByWordId.set(row.wordId, row);
    }
  }

  const rankedCandidates = Array.from(candidateByWordId.values());

  const uniqueOptionsPool = Array.from(new Set(rankedCandidates.map((row) => row.targetWord)));

  if (uniqueOptionsPool.length < 4) {
    return null;
  }

  const scoreRows = await db
    .selectFrom("user_learning")
    .select((expressionBuilder) => [
      "word_id as wordId",
      expressionBuilder.fn
        .avg<number>(
          expressionBuilder
            .case()
            .when("is_correct", "=", true)
            .then(1)
            .else(0)
            .end(),
        )
        .as("accuracy"),
    ])
    .where("user_id", "=", input.userId)
    .groupBy("word_id")
    .execute();

  const scoreByWordId = new Map<number, number>();
  for (const row of scoreRows) {
    scoreByWordId.set(row.wordId, Number(row.accuracy ?? 0));
  }

  const shouldPickRandom = Math.random() < 0.1;
  const chosenCandidate = shouldPickRandom
    ? rankedCandidates[Math.floor(Math.random() * rankedCandidates.length)]
    : [...rankedCandidates].sort((first, second) => {
        const firstScore = scoreByWordId.get(first.wordId) ?? 0;
        const secondScore = scoreByWordId.get(second.wordId) ?? 0;

        if (firstScore !== secondScore) {
          return firstScore - secondScore;
        }

        return Math.random() - 0.5;
      })[0];

  const wrongOptions = shuffle(
    uniqueOptionsPool.filter((option) => option !== chosenCandidate.targetWord),
  ).slice(0, 3);

  const options = shuffle([chosenCandidate.targetWord, ...wrongOptions]);

  return {
    wordId: chosenCandidate.wordId,
    sourceWord: chosenCandidate.sourceWord,
    correctTranslation: chosenCandidate.targetWord,
    options,
  };
}

export { normalizeWord };
