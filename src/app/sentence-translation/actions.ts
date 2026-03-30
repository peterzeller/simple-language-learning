"use server";

import { getCurrentUser } from "@/lib/auth";
import { recordLearningEvent } from "@/lib/learning";

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
