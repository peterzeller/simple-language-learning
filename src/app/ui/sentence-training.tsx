"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  getSentenceAudio,
  recordSentenceAnswer,
  recordSentenceReveal,
} from "@/app/sentence-translation/actions";
import type { SentenceExercise } from "@/lib/sentence-translation";
import styles from "@/app/auth.module.css";

interface SentenceTrainingProps {
  exercise: SentenceExercise;
}

interface AnswerState {
  selectedOption: string;
  isCorrect: boolean;
}

export function SentenceTraining({ exercise }: SentenceTrainingProps) {
  const [revealedWords, setRevealedWords] = useState<Record<number, boolean>>({});
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [autoReadEnabled, setAutoReadEnabled] = useState(false);
  const [isAudioPending, setIsAudioPending] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setRevealedWords({});
    setAnswers({});
    setActiveQuestionIndex(null);
    setAudioError(null);
  }, [exercise.sentenceId]);

  const questionByIndex = useMemo(
    () => new Map(exercise.questions.map((question) => [question.tokenIndex, question])),
    [exercise.questions],
  );

  const activeQuestion =
    activeQuestionIndex !== null ? questionByIndex.get(activeQuestionIndex) : undefined;
  const activeToken =
    activeQuestionIndex !== null ? exercise.tokens[activeQuestionIndex] : undefined;

  const playStory = useCallback(async () => {
    setAudioError(null);
    setIsAudioPending(true);

    try {
      const dataUrl = await getSentenceAudio({ sentenceId: exercise.sentenceId });

      if (!dataUrl) {
        setAudioError("Unable to generate narration audio for this sentence right now.");
        return;
      }

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      audioRef.current.src = dataUrl;
      await audioRef.current.play();
    } catch {
      setAudioError("Audio playback was blocked or unavailable. Try pressing Read story again.");
    } finally {
      setIsAudioPending(false);
    }
  }, [exercise.sentenceId]);

  useEffect(() => {
    if (!autoReadEnabled) {
      return;
    }

    void playStory();
  }, [autoReadEnabled, playStory]);

  return (
    <div className={styles.trainingLayout}>
      <div className={styles.storyAudioControls}>
        <button
          className={styles.secondaryButton}
          disabled={isAudioPending}
          onClick={() => {
            void playStory();
          }}
          type="button"
        >
          {isAudioPending ? "Generating audio..." : "🔊 Read story"}
        </button>
        <label className={styles.toggleLabel} htmlFor="auto-read-toggle">
          <input
            checked={autoReadEnabled}
            id="auto-read-toggle"
            onChange={(event) => setAutoReadEnabled(event.target.checked)}
            type="checkbox"
          />
          Auto-read new sentence
        </label>
      </div>

      {audioError && <p className={styles.helperText}>{audioError}</p>}

      <div className={styles.sentenceLine}>
        {exercise.tokens.map((token, index) => {
          const question = questionByIndex.get(index);
          const answer = answers[index];
          const shouldReveal = !token.isQuestion && (token.revealByDefault || revealedWords[index]);

          const cardClassName = [styles.wordCard];

          if (question && !answer) {
            cardClassName.push(styles.wordCardQuestion);
          }

          if (answer?.isCorrect) {
            cardClassName.push(styles.wordCardCorrect);
          }

          if (answer && !answer.isCorrect) {
            cardClassName.push(styles.wordCardWrong);
          }

          return (
            <button
              className={cardClassName.join(" ")}
              key={`${token.source}-${index}`}
              onClick={() => {
                if (question) {
                  setActiveQuestionIndex(index);
                  return;
                }

                let shouldRecordReveal = false;
                setRevealedWords((prev) => {
                  const currentlyVisible = token.revealByDefault || Boolean(prev[index]);
                  const nextIsVisible = !currentlyVisible;
                  shouldRecordReveal = !currentlyVisible && nextIsVisible;
                  return { ...prev, [index]: nextIsVisible };
                });

                if (shouldRecordReveal) {
                  startTransition(async () => {
                    await recordSentenceReveal({ wordId: token.wordId });
                  });
                }
              }}
              type="button"
            >
              <span>{token.source}</span>
              <small className={styles.wordTranslation}>
                {answer || shouldReveal ? token.target : ""}
              </small>
            </button>
          );
        })}
      </div>

      {activeQuestion && activeToken && activeQuestionIndex !== null && (
        <dialog className={styles.translationDialog} onClose={() => setActiveQuestionIndex(null)} open>
          <div className={styles.dialogHeading}>
            <h2>
              Select the translation for <strong>{activeToken.source}</strong>
            </h2>
            <button
              aria-label="Close translation dialog"
              className={styles.dialogClose}
              onClick={() => setActiveQuestionIndex(null)}
              type="button"
            >
              ×
            </button>
          </div>
          <div className={styles.optionsGrid}>
            {activeQuestion.options.map((option) => {
              const answer = answers[activeQuestionIndex];
              const isSelected = answer?.selectedOption === option;
              const isCorrectOption = option === activeQuestion.correctAnswer;
              const isWrongSelected = isSelected && answer && !answer.isCorrect;

              return (
                <button
                  className={`${styles.optionButton} ${
                    isSelected && answer?.isCorrect ? styles.optionCorrect : ""
                  } ${isWrongSelected ? styles.optionWrong : ""}`}
                  key={option}
                  onClick={() => {
                    if (answer) {
                      return;
                    }

                    const isCorrect = option === activeQuestion.correctAnswer;
                    setAnswers((prev) => ({
                      ...prev,
                      [activeQuestionIndex]: {
                        selectedOption: option,
                        isCorrect,
                      },
                    }));
                    setActiveQuestionIndex(null);

                    startTransition(async () => {
                      await recordSentenceAnswer({
                        wordId: activeToken.wordId,
                        isCorrect,
                      });
                    });
                  }}
                  type="button"
                >
                  <span className={isCorrectOption && answer ? styles.correctLabel : undefined}>
                    {option}
                  </span>
                </button>
              );
            })}
          </div>
        </dialog>
      )}

      {isPending && <p className={styles.helperText}>Saving your progress…</p>}
    </div>
  );
}
