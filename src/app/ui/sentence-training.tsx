"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import {
  recordSentenceAnswer,
  recordSentenceReveal,
} from "@/app/sentence-translation/actions";
import type { SentenceExercise } from "@/lib/sentence-translation";
import styles from "@/app/auth.module.css";

interface SentenceTrainingProps {
  exercise: SentenceExercise;
  onUseSuggestion: (prompt: string) => void;
}

interface AnswerState {
  selectedOption: string;
  isCorrect: boolean;
}

export function SentenceTraining({ exercise, onUseSuggestion }: SentenceTrainingProps) {
  const t = useTranslations();
  const playbackSpeedOptions = useMemo(() => [0.5, 0.75, 1, 1.25, 1.5, 2], []);
  const [revealedWords, setRevealedWords] = useState<Record<number, boolean>>({});
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number | null>(null);
  const [isSpeedDialogOpen, setIsSpeedDialogOpen] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isPending, startTransition] = useTransition();
  const [isAudioPending, setIsAudioPending] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioBlockedMessage = t("sentence.audioBlocked");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedSentenceIdRef = useRef<number | null>(null);
  const loadingSentenceIdRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLButtonElement | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedDialogLongPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextTrackClickRef = useRef(false);
  const logPlaybackError = useCallback((context: string, error: unknown) => {
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
  }, [exercise.sentenceId]);

  const loadSentenceAudio = useCallback(() => {
    if (!audioRef.current || loadedSentenceIdRef.current === exercise.sentenceId) {
      return Boolean(audioRef.current?.src);
    }

    if (loadingSentenceIdRef.current === exercise.sentenceId) {
      return false;
    }

    setIsAudioPending(true);
    loadingSentenceIdRef.current = exercise.sentenceId;
    const audioSource = `/api/sentence-audio/${exercise.sentenceId}`;

    const resolvedSource = new URL(audioSource, window.location.origin).toString();

    audioRef.current.src = resolvedSource;
    audioRef.current.load();
    loadedSentenceIdRef.current = exercise.sentenceId;
    loadingSentenceIdRef.current = null;
    setIsAudioPending(false);
    setPlaybackProgress(0);
    return true;
  }, [exercise.sentenceId]);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    const audio = audioRef.current;
    audio.playbackRate = playbackSpeed;

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
          setAudioError(audioBlockedMessage);
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

    const handleCanPlay = () => {
      setIsAudioPending(false);
      audio.playbackRate = playbackSpeed;
    };

    audio.addEventListener("timeupdate", syncPlaybackProgress);
    audio.addEventListener("loadedmetadata", syncPlaybackProgress);
    audio.addEventListener("durationchange", syncPlaybackProgress);
    audio.addEventListener("seeked", syncPlaybackProgress);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("canplay", handleCanPlay);

    return () => {
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }
      if (speedDialogLongPressTimeoutRef.current) {
        clearTimeout(speedDialogLongPressTimeoutRef.current);
        speedDialogLongPressTimeoutRef.current = null;
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
      audio.removeEventListener("canplay", handleCanPlay);
    };
  }, [audioBlockedMessage, exercise.sentenceId, logPlaybackError]);

  const openSpeedDialog = () => {
    setIsSpeedDialogOpen(true);
  };

  const clearLongPressTimeout = () => {
    if (speedDialogLongPressTimeoutRef.current) {
      clearTimeout(speedDialogLongPressTimeoutRef.current);
      speedDialogLongPressTimeoutRef.current = null;
    }
  };

  const handleTrackTouchStart = () => {
    clearLongPressTimeout();
    speedDialogLongPressTimeoutRef.current = setTimeout(() => {
      suppressNextTrackClickRef.current = true;
      openSpeedDialog();
    }, 500);
  };

  const handleTrackTouchEnd = () => {
    clearLongPressTimeout();
  };

  const questionByIndex = useMemo(
    () => new Map(exercise.questions.map((question) => [question.tokenIndex, question])),
    [exercise.questions],
  );

  const activeQuestion =
    activeQuestionIndex !== null ? questionByIndex.get(activeQuestionIndex) : undefined;
  const activeTokenCandidate =
    activeQuestionIndex !== null ? exercise.tokens[activeQuestionIndex] : undefined;
  const activeToken = activeTokenCandidate?.kind === "word" ? activeTokenCandidate : undefined;

  const seekFromTrackClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressNextTrackClickRef.current) {
      suppressNextTrackClickRef.current = false;
      return;
    }

    if (!audioRef.current || !trackRef.current) {
      return;
    }

    setAudioError(null);

    if (isPlaying) {
      audioRef.current.pause();
      return;
    }

    const duration = audioRef.current.duration;

    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

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
      setIsPlaying(false);
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
      audioRef.current.playbackRate = playbackSpeed;
      setIsPlaying(true);
    } catch (error) {
      logPlaybackError("User-triggered playback failed", error);
      setAudioError(t("sentence.audioBlocked"));
    }
  };

  return (
    <div className={styles.trainingLayout}>
      <h2>{exercise.storyTitle}</h2>
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
          <button
            aria-label={t("sentence.audioSpeedMenuLabel", { speed: playbackSpeed })}
            className={styles.playbackTrack}
            onClick={seekFromTrackClick}
            onContextMenu={(event) => {
              event.preventDefault();
              openSpeedDialog();
            }}
            onTouchCancel={handleTrackTouchEnd}
            onTouchEnd={handleTrackTouchEnd}
            onTouchStart={handleTrackTouchStart}
            ref={trackRef}
            type="button"
          >
            <div className={styles.playbackProgress} style={{ height: `${playbackProgress * 100}%` }} />
          </button>
        </div>

        <div className={styles.sentenceLine}>
          {exercise.tokens.map((token, index) => {
            if (token.kind === "text") {
              const parts = token.text.split("\n")

              return parts.flatMap((part, partIndex) => (
                [
                partIndex > 0 ? <span key={`br-${index}-${partIndex}`} className={styles.lineBreak} /> : null,
                <span key={`text-${index}-${partIndex}`} className={styles.textToken}>
                  {part}
                </span>
                ]
              ));
            }

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

      {isSpeedDialogOpen && (
        <dialog className={styles.translationDialog} onClose={() => setIsSpeedDialogOpen(false)} open>
          <div className={styles.dialogHeading}>
            <h2>{t("sentence.audioSpeedDialogTitle")}</h2>
            <button
              aria-label={t("sentence.closeDialog")}
              className={styles.dialogClose}
              onClick={() => setIsSpeedDialogOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <div className={styles.optionsGrid}>
            {playbackSpeedOptions.map((speed) => (
              <button
                className={`${styles.optionButton} ${playbackSpeed === speed ? styles.optionCorrect : ""}`}
                key={speed}
                onClick={() => {
                  setPlaybackSpeed(speed);
                  if (audioRef.current) {
                    audioRef.current.playbackRate = speed;
                  }
                  setIsSpeedDialogOpen(false);
                }}
                type="button"
              >
                {t("sentence.audioSpeedOption", { speed })}
              </button>
            ))}
          </div>
        </dialog>
      )}

      {isPending && <p className={styles.helperText}>{t("sentence.saving")}</p>}
      <div className={styles.topicActions}>
        <p className={styles.helperText}>{t("sentence.followUpSuggestions")}</p>
        {exercise.storySuggestions.slice(0, 2).map((suggestion, index) => (
          <button
            className={styles.primaryButton}
            key={`${suggestion.headline}-${index}`}
            onClick={() => onUseSuggestion(suggestion.prompt)}
            title={suggestion.prompt}
            type="button"
          >
            {suggestion.headline}
          </button>
        ))}
      </div>
    </div>
  );
}
