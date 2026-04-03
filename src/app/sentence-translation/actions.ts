"use server";

import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { recordLearningEvent } from "@/lib/learning";
import { createSentenceExerciseFromPrompt } from "@/lib/sentence-translation";

export async function createSentenceFromPrompt(formData: FormData): Promise<void> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const rawTopic = String(formData.get("topic") ?? "").trim();
  const topic = rawTopic || "Random story";

  await createSentenceExerciseFromPrompt({
    topic,
    userId: user.id,
  });

  const nextTopic = encodeURIComponent(topic);
  redirect(`/sentence-translation?topic=${nextTopic}`);
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
