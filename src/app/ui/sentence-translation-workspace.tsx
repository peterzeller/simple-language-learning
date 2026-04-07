"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import styles from "@/app/auth.module.css";
import {
  createSentenceFromRandom,
} from "@/app/sentence-translation/actions";
import { SentenceTraining } from "@/app/ui/sentence-training";
import type { SentenceExercise, SentenceStreamingPayload } from "@/lib/sentence-translation";

interface SentenceTranslationWorkspaceProps {
  initialExercise: SentenceExercise;
  initialTopic: string;
}

export function SentenceTranslationWorkspace({ initialExercise, initialTopic }: SentenceTranslationWorkspaceProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [topic, setTopic] = useState(initialTopic);
  const [exercise, setExercise] = useState(initialExercise);
  const [streamedSourceText, setStreamedSourceText] = useState("");
  const [isQuizReady, setIsQuizReady] = useState(true);
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
      if (mode === "random") {
        const nextExercise = await createSentenceFromRandom({ topic: normalizedTopic });
        setExercise(nextExercise);
        setIsQuizReady(true);
        setStreamedSourceText("");
        return;
      }

      setExercise(initialExercise);
      setIsQuizReady(false);
      setStreamedSourceText("");

      const response = await fetch("/api/sentence-translation/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, topic: normalizedTopic }),
      });

      if (!response.ok) {
        setIsQuizReady(true);
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const payload = await response.json().catch(() => null) as { events?: SentenceStreamingPayload[] } | null;
        const finalEvent = payload?.events?.find((event) => event.type === "final_exercise");
        if (finalEvent?.exercise) {
          setExercise(finalEvent.exercise);
        }
        setIsQuizReady(true);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setIsQuizReady(true);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event
            .split("\n")
            .find((entry) => entry.startsWith("data: "));
          if (!line) {
            continue;
          }

          const payload = JSON.parse(line.slice(6)) as SentenceStreamingPayload;
          if (payload.type === "source_delta" && payload.delta) {
            setStreamedSourceText((current) => current + payload.delta);
          }

          if (payload.type === "draft_exercise" && payload.exercise) {
            setExercise(payload.exercise);
          }

          if (payload.type === "final_exercise" && payload.exercise) {
            setExercise(payload.exercise);
            setIsQuizReady(true);
          }
        }
      }
    });
  };

  return (
    <>
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

      {isPending && <p className={styles.helperText}>{t("sentence.loading")}</p>}
      {!isQuizReady && streamedSourceText && (
        <p className={styles.helperText} style={{ whiteSpace: "pre-wrap" }}>
          {streamedSourceText}
        </p>
      )}
      {isQuizReady ? (
        <SentenceTraining exercise={exercise} key={exercise.sentenceId} />
      ) : (
        <p className={styles.helperText}>{t("sentence.loading")}</p>
      )}
    </>
  );
}
