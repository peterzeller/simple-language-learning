"use server";

import { getCurrentUser } from "@/lib/auth";
import { getVocabularyQuestionForUser, type VocabularyQuestion, recordLearningEvent } from "@/lib/learning";

export async function getNextVocabularyQuestion(): Promise<VocabularyQuestion | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  return getVocabularyQuestionForUser(user.id);
}

export async function submitVocabularyAnswer(input: {
  wordId: number;
  isCorrect: boolean;
}): Promise<VocabularyQuestion | null> {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  await recordLearningEvent({
    userId: user.id,
    wordId: input.wordId,
    isCorrect: input.isCorrect,
  });

  return getVocabularyQuestionForUser(user.id);
}
