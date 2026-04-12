"use server";

import { getCurrentUser } from "@/lib/auth";
import { recordLearningEvent } from "@/lib/learning";
import {
  type SentenceExercise,
  createSentenceExerciseFromPrompt,
  createSentenceExerciseFromRandomSentence,
  createSentenceExerciseFromSentenceId,
} from "@/lib/sentence-translation";

function normalizeTopic(value: string): string {
  return value.trim() || "Random story";
}

export async function createSentenceFromPrompt(input: {
  topic: string;
}): Promise<SentenceExercise> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  return createSentenceExerciseFromPrompt({
    topic: normalizeTopic(input.topic),
    userId: user.id,
    learningLanguage: user.learningLanguage,
    knownLanguage: user.knownLanguage,
  });
}

export async function createSentenceFromRandom(input: {
  topic: string;
}): Promise<SentenceExercise> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  return createSentenceExerciseFromRandomSentence({
    topic: normalizeTopic(input.topic),
    userId: user.id,
    learningLanguage: user.learningLanguage,
    knownLanguage: user.knownLanguage,
  });
}

export async function createSentenceFromSentenceId(input: {
  topic: string;
  sentenceId: number;
}): Promise<SentenceExercise> {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  return createSentenceExerciseFromSentenceId({
    sentenceId: input.sentenceId,
    topic: normalizeTopic(input.topic),
    userId: user.id,
    learningLanguage: user.learningLanguage,
    knownLanguage: user.knownLanguage,
  });
}

export async function recordSentenceAnswer(input: {
  wordId: number;
  isCorrect: boolean;
}): Promise<void> {
  const user = await getCurrentUser();

  if (!user) {
    return;
  }

  await recordLearningEvent({
    userId: user.id,
    wordId: input.wordId,
    isCorrect: input.isCorrect,
  });
}

export async function recordSentenceReveal(input: { wordId: number }): Promise<void> {
  const user = await getCurrentUser();

  if (!user) {
    return;
  }

  await recordLearningEvent({
    userId: user.id,
    wordId: input.wordId,
    isCorrect: false,
  });
}
