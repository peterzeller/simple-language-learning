"use client";

import { useState, useTransition } from "react";

import styles from "@/app/auth.module.css";
import {
  createSentenceFromPrompt,
  createSentenceFromRandom,
} from "@/app/sentence-translation/actions";
import { SentenceTraining } from "@/app/ui/sentence-training";
import type { SentenceExercise } from "@/lib/sentence-translation";

interface SentenceTranslationWorkspaceProps {
  initialExercise: SentenceExercise;
  initialTopic: string;
}

export function SentenceTranslationWorkspace({
  initialExercise,
  initialTopic,
}: SentenceTranslationWorkspaceProps) {
  const [topic, setTopic] = useState(initialTopic);
  const [exercise, setExercise] = useState(initialExercise);
  const [isPending, startTransition] = useTransition();
  const [autoReadEnabled, setAutoReadEnabled] = useState(false);

  const fetchExercise = (mode: "prompt" | "random") => {
    startTransition(async () => {
      const normalizedTopic = topic.trim() || "Random story";
      const nextExercise =
        mode === "prompt"
          ? await createSentenceFromPrompt({ topic: normalizedTopic })
          : await createSentenceFromRandom({ topic: normalizedTopic });
      setExercise(nextExercise);
    });
  };

  return (
    <>
      <div className={styles.topicForm}>
        <label className={styles.field} htmlFor="topic">
          Topic
          <input
            id="topic"
            name="topic"
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Enter a topic"
            value={topic}
          />
        </label>

        <div className={styles.topicActions}>
          <button
            className={styles.primaryButton}
            disabled={isPending}
            onClick={() => fetchExercise("prompt")}
            type="button"
          >
            <span className={styles.buttonContent}>
              {isPending && <span aria-hidden="true" className={styles.inlineSpinner} />}
              Create sentence from prompt
            </span>
          </button>
          <button
            className={styles.primaryButton}
            disabled={isPending}
            onClick={() => fetchExercise("random")}
            type="button"
          >
            Pick random saved sentence
          </button>
        </div>
      </div>

      {isPending && <p className={styles.helperText}>Loading sentence...</p>}
      <SentenceTraining
        autoReadEnabled={autoReadEnabled}
        exercise={exercise}
        onAutoReadEnabledChange={setAutoReadEnabled}
      />
    </>
  );
}
