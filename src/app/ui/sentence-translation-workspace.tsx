"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import styles from "@/app/auth.module.css";
import {
  createSentenceFromPrompt,
  createSentenceFromRandom,
} from "@/app/sentence-translation/actions";
import { SentenceTraining } from "@/app/ui/sentence-training";
import type { SentenceExercise } from "@/lib/sentence-translation";

interface SentenceTranslationWorkspaceProps {
  initialExercise: SentenceExercise;
  initialTopicInput: string;
}

export function SentenceTranslationWorkspace({
  initialExercise,
  initialTopicInput,
}: SentenceTranslationWorkspaceProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [topic, setTopic] = useState(initialTopicInput);
  const [exercise, setExercise] = useState(initialExercise);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());

    if (params.get("sentenceId") === String(exercise.sentenceId)) {
      return;
    }

    params.set("sentenceId", String(exercise.sentenceId));
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [exercise.sentenceId, pathname, router, searchParams]);

  const fetchExercise = (mode: "prompt" | "random") => {
    startTransition(async () => {
      const normalizedTopic = topic.trim() || t("sentence.defaultTopic");
      const nextExercise =
        mode === "prompt"
          ? await createSentenceFromPrompt({ topic: normalizedTopic })
          : await createSentenceFromRandom({ topic: normalizedTopic });
      setExercise(nextExercise);
    });
  };

  const fetchExerciseFromTopic = (nextTopic: string) => {
    startTransition(async () => {
      const normalizedTopic = nextTopic.trim() || t("sentence.defaultTopic");
      setTopic(normalizedTopic);
      const nextExercise = await createSentenceFromPrompt({ topic: normalizedTopic });
      setExercise(nextExercise);
    });
  };

  return (
    <>
      {isPending && <p className={styles.helperText}>{t("sentence.loading")}</p>}
      <SentenceTraining
        exercise={exercise}
        key={exercise.sentenceId}
        onUseSuggestion={(suggestionPrompt) => {
          fetchExerciseFromTopic(suggestionPrompt);
        }}
      />

      <div className={styles.topicForm}>
        <label className={styles.field} htmlFor="topic">
          {t("sentence.topic")}
          <input
            id="topic"
            name="topic"
            onChange={(event) => setTopic(event.target.value)}
            placeholder={t("sentence.enterTopic")}
            value={topic}
          />
        </label>

        <div className={styles.topicActions}>
          <button className={styles.primaryButton} disabled={isPending} onClick={() => fetchExercise("prompt")} type="button">
            <span className={styles.buttonContent}>
              {isPending && <span aria-hidden="true" className={styles.inlineSpinner} />}
              {t("sentence.createFromPrompt")}
            </span>
          </button>
          <button className={styles.primaryButton} disabled={isPending} onClick={() => fetchExercise("random")} type="button">
            {t("sentence.pickRandom")}
          </button>
        </div>
      </div>
    </>
  );
}
