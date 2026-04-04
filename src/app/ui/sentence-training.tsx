"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
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
  const t = useTranslations();
  const [revealedWords, setRevealedWords] = useState<Record<number, boolean>>({});
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isAudioPending, setIsAudioPending] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedSentenceIdRef = useRef<number | null>(null);
  const loadingSentenceIdRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLButtonElement | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logPlaybackError = (context: string, error: unknown) => {
    if (error instanceof DOMException) {
      console.warn(`[sentence-training] ${context}`, {
        sentenceId: exercise.sentenceId,
        name: error.name,
        message: error.message,
      });
      return;
    }

    console.warn(`[sentence-training] ${context}`, {
      sentenceId: exercise.sentenceId,
      error,
    });
  };

  const loadSentenceAudio = () => {
    if (!audioRef.current || loadedSentenceIdRef.current === exercise.sentenceId) {
      return Boolean(audioRef.current?.src);
    }

    if (loadingSentenceIdRef.current === exercise.sentenceId) {
      return false;
    }

    setIsAudioPending(true);
    loadingSentenceIdRef.current = exercise.sentenceId;
    const audioSource = `/api/sentence-audio/${exercise.sentenceId}`;

    const resolvedSource = (() => {
      try {
        return new URL(audioSource, window.location.origin).toString();
      } catch (error) {
        console.error("[sentence-training] Invalid audio URL returned by getSentenceAudio", {
          sentenceId: exercise.sentenceId,
          audioSource,
          error,
        });
        return null;
      }
    })();

    if (!resolvedSource) {
      setIsAudioPending(false);
      loadingSentenceIdRef.current = null;
      setAudioError(t("sentence.audioLoadError"));
      return false;
    }

    audioRef.current.src = resolvedSource;
    audioRef.current.load();
    loadedSentenceIdRef.current = exercise.sentenceId;
    loadingSentenceIdRef.current = null;
    setIsAudioPending(false);
    setPlaybackProgress(0);
    return true;
  };

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    const audio = audioRef.current;

    const syncPlaybackProgress = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        setPlaybackProgress(0);
        return;
      }

      setPlaybackProgress(Math.min(1, audio.currentTime / audio.duration));
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setPlaybackProgress(1);

      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }

      restartTimeoutRef.current = setTimeout(async () => {
        if (!audio.src) {
          return;
        }

        audio.currentTime = 0;
        setPlaybackProgress(0);

        try {
          await audio.play();
        } catch (error) {
          logPlaybackError("Auto-replay failed", error);
        }
      }, 2000);
    };

    const handlePause = () => {
      setIsPlaying(false);

      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
    };

    const handlePlay = () => {
      setIsPlaying(true);
      syncPlaybackProgress();
    };

    audio.addEventListener("timeupdate", syncPlaybackProgress);
    audio.addEventListener("loadedmetadata", syncPlaybackProgress);
    audio.addEventListener("durationchange", syncPlaybackProgress);
    audio.addEventListener("seeked", syncPlaybackProgress);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);

    return () => {
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }

      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
      audio.removeEventListener("timeupdate", syncPlaybackProgress);
      audio.removeEventListener("loadedmetadata", syncPlaybackProgress);
      audio.removeEventListener("durationchange", syncPlaybackProgress);
      audio.removeEventListener("seeked", syncPlaybackProgress);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
    };
  }, [exercise.sentenceId]);

  useEffect(() => {
    setAudioError(null);
    loadedSentenceIdRef.current = null;
    loadingSentenceIdRef.current = null;

    loadSentenceAudio();
  }, [exercise.sentenceId]);

  const questionByIndex = useMemo(
    () => new Map(exercise.questions.map((question) => [question.tokenIndex, question])),
    [exercise.questions],
  );

  const activeQuestion =
    activeQuestionIndex !== null ? questionByIndex.get(activeQuestionIndex) : undefined;
  const activeToken =
    activeQuestionIndex !== null ? exercise.tokens[activeQuestionIndex] : undefined;

  const seekFromTrackClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!audioRef.current || !trackRef.current) {
      return;
    }

    const duration = audioRef.current.duration;

    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    const wasPlaying = isPlaying;
    const bounds = trackRef.current.getBoundingClientRect();

    if (!Number.isFinite(bounds.height) || bounds.height <= 0) {
      return;
    }

    const offsetY = Math.min(Math.max(event.clientY - bounds.top, 0), bounds.height);
    const ratio = Math.min(1, Math.max(0, offsetY / bounds.height));
    const nextTime = ratio * duration;

    if (!Number.isFinite(nextTime)) {
      return;
    }

    audioRef.current.currentTime = nextTime;
    setPlaybackProgress(ratio);

    if (!wasPlaying) {
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }

      try {
        await audioRef.current.play();
      } catch (error) {
        logPlaybackError("Playback from seek failed", error);
        setAudioError(t("sentence.audioBlocked"));
      }
    }
  };

  const togglePlayback = async () => {
    setAudioError(null);

    if (!audioRef.current) {
      return;
    }

    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    if (isPlaying) {
      audioRef.current.pause();
      return;
    }

    if (loadedSentenceIdRef.current !== exercise.sentenceId || !audioRef.current.src) {
      const audioLoaded = loadSentenceAudio();
      if (!audioLoaded) {
        return;
      }
    }

    try {
      await audioRef.current.play();
    } catch (error) {
      logPlaybackError("User-triggered playback failed", error);
      setAudioError(t("sentence.audioBlocked"));
    }
  };

  return (
    <div className={styles.trainingLayout}>
      {audioError && <p className={styles.helperText}>{audioError}</p>}

      <div className={styles.sentencePlaybackLayout}>
        <div className={styles.playbackRail}>
          <button
            aria-label={isPlaying ? t("sentence.pauseNarration") : t("sentence.playNarration")}
            className={styles.playbackButton}
            disabled={isAudioPending}
            onClick={() => {
              void togglePlayback();
            }}
            type="button"
          >
            {isAudioPending ? "…" : isPlaying ? "❚❚" : "▶"}
          </button>
          <button className={styles.playbackTrack} onClick={seekFromTrackClick} ref={trackRef} type="button">
            <div className={styles.playbackProgress} style={{ height: `${playbackProgress * 100}%` }} />
          </button>
        </div>

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
      </div>

      {activeQuestion && activeToken && activeQuestionIndex !== null && (
        <dialog className={styles.translationDialog} onClose={() => setActiveQuestionIndex(null)} open>
          <div className={styles.dialogHeading}>
            <h2>
              {t("sentence.selectTranslationFor")} <strong>{activeToken.source}</strong>
            </h2>
            <button
              aria-label={t("sentence.closeDialog")}
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

      {isPending && <p className={styles.helperText}>{t("sentence.saving")}</p>}
    </div>
  );
}
