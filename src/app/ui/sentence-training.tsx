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
  onPickRandomStory: (sentenceId: number) => void;
}

interface AnswerState {
  selectedOption: string;
  isCorrect: boolean;
}

interface SentenceWordTimestamp {
  word: string;
  startSeconds: number;
  endSeconds: number;
}

interface SentenceAudioTranscriptResponse {
  words?: SentenceWordTimestamp[];
}

export function SentenceTraining({ exercise, onUseSuggestion, onPickRandomStory }: SentenceTrainingProps) {
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
  const [wordTimestamps, setWordTimestamps] = useState<SentenceWordTimestamp[]>([]);
  const [activePlaybackWordIndex, setActivePlaybackWordIndex] = useState<number | null>(null);
  const audioBlockedMessage = t("sentence.audioBlocked");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedSentenceIdRef = useRef<number | null>(null);
  const loadingSentenceIdRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLButtonElement | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speedDialogLongPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextTrackClickRef = useRef(false);
  const pausedQuestionIndexesRef = useRef<Set<number>>(new Set());
  const shouldResumeAfterAnswerRef = useRef(false);
  const transcriptSentenceIdRef = useRef<number | null>(null);
  const answersRef = useRef(answers);
  const isPlayingRef = useRef(isPlaying);
  const questionByIndexRef = useRef<Map<number, (typeof exercise.questions)[number]>>(new Map());
  const tokenTimingByIndexRef = useRef<Map<number, { startSeconds: number; endSeconds: number }>>(new Map());
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

  const normalizeForAlignment = useCallback((value: string) => (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}]+/gu, "")
  ), []);

  const tokenTimingByIndex = useMemo(() => {
    if (wordTimestamps.length === 0) {
      return new Map<number, { startSeconds: number; endSeconds: number }>();
    }

    const wordTokenIndexes = exercise.tokens
      .map((token, index) => (token.kind === "word" ? index : -1))
      .filter((index) => index >= 0);
    const timings = new Map<number, { startSeconds: number; endSeconds: number }>();
    let transcriptCursor = 0;

    for (const tokenIndex of wordTokenIndexes) {
      const token = exercise.tokens[tokenIndex];
      if (token?.kind !== "word") {
        continue;
      }

      const normalizedToken = normalizeForAlignment(token.source);

      if (!normalizedToken) {
        continue;
      }

      while (transcriptCursor < wordTimestamps.length) {
        const transcriptWord = wordTimestamps[transcriptCursor];
        transcriptCursor += 1;
        if (normalizeForAlignment(transcriptWord.word) !== normalizedToken) {
          continue;
        }

        timings.set(tokenIndex, {
          startSeconds: transcriptWord.startSeconds,
          endSeconds: transcriptWord.endSeconds,
        });
        break;
      }
    }

    return timings;
  }, [exercise.tokens, normalizeForAlignment, wordTimestamps]);

  const questionByIndex = useMemo(
    () => new Map(exercise.questions.map((question) => [question.tokenIndex, question])),
    [exercise.questions],
  );

  const loadSentenceTranscript = useCallback(async () => {
    if (transcriptSentenceIdRef.current === exercise.sentenceId) {
      return;
    }

    try {
      const response = await fetch(`/api/sentence-audio/${exercise.sentenceId}/transcript`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json() as SentenceAudioTranscriptResponse;
      const words = Array.isArray(payload.words) ? payload.words : [];
      setWordTimestamps(words);
      transcriptSentenceIdRef.current = exercise.sentenceId;
    } catch (error) {
      logPlaybackError("Loading transcript failed", error);
    }
  }, [exercise.sentenceId, logPlaybackError]);

  const loadSentenceAudio = useCallback(() => {
    if (!audioRef.current || loadedSentenceIdRef.current === exercise.sentenceId) {
      return Boolean(audioRef.current?.src);
    }

    if (loadingSentenceIdRef.current === exercise.sentenceId) {
      return false;
    }

    setIsAudioPending(true);
    loadingSentenceIdRef.current = exercise.sentenceId;
    pausedQuestionIndexesRef.current = new Set();
    shouldResumeAfterAnswerRef.current = false;
    setActivePlaybackWordIndex(null);
    setAudioError(null);
    setPlaybackProgress(0);
    setWordTimestamps([]);
    transcriptSentenceIdRef.current = null;
    const audioSource = `/api/sentence-audio/${exercise.sentenceId}`;

    const resolvedSource = new URL(audioSource, window.location.origin).toString();

    audioRef.current.src = resolvedSource;
    audioRef.current.load();
    loadedSentenceIdRef.current = exercise.sentenceId;
    loadingSentenceIdRef.current = null;
    setIsAudioPending(false);
    void loadSentenceTranscript();
    return true;
  }, [exercise.sentenceId, loadSentenceTranscript]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    questionByIndexRef.current = questionByIndex;
  }, [questionByIndex]);

  useEffect(() => {
    tokenTimingByIndexRef.current = tokenTimingByIndex;
  }, [tokenTimingByIndex]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    const audio = audioRef.current;
    audio.playbackRate = playbackSpeed;

    const syncPlaybackProgress = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        setPlaybackProgress(0);
        setActivePlaybackWordIndex(null);
        return;
      }

      const currentTime = audio.currentTime;
      setPlaybackProgress(Math.min(1, currentTime / audio.duration));

      const currentWordIndex = Array.from(tokenTimingByIndexRef.current.entries()).find(([, timing]) => (
        currentTime >= timing.startSeconds && currentTime < timing.endSeconds
      ))?.[0] ?? null;
      setActivePlaybackWordIndex(currentWordIndex);

      if (!isPlayingRef.current || currentWordIndex === null) {
        return;
      }

      const isQuestionWord = questionByIndexRef.current.has(currentWordIndex);
      const hasAnswer = Boolean(answersRef.current[currentWordIndex]);

      if (!isQuestionWord || hasAnswer || pausedQuestionIndexesRef.current.has(currentWordIndex)) {
        return;
      }

      pausedQuestionIndexesRef.current.add(currentWordIndex);
      shouldResumeAfterAnswerRef.current = true;
      setActiveQuestionIndex(currentWordIndex);
      audio.pause();
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setPlaybackProgress(1);
      setActivePlaybackWordIndex(null);

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
      setActivePlaybackWordIndex(null);

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
  }, [audioBlockedMessage, exercise.sentenceId, logPlaybackError, playbackSpeed]);

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

    if (wordTimestamps.length === 0) {
      void loadSentenceTranscript();
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

            if (activePlaybackWordIndex === index) {
              cardClassName.push(styles.wordCardPlaying);
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
                    pausedQuestionIndexesRef.current.add(activeQuestionIndex);

                    startTransition(async () => {
                      await recordSentenceAnswer({
                        wordId: activeToken.wordId,
                        isCorrect,
                      });
                    });

                    if (shouldResumeAfterAnswerRef.current && audioRef.current?.src) {
                      shouldResumeAfterAnswerRef.current = false;
                      void audioRef.current.play().catch((error) => {
                        logPlaybackError("Resume after answer failed", error);
                        setAudioError(t("sentence.audioBlocked"));
                      });
                    }
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
        <p className={styles.helperText}>{t("sentence.suggestions")}</p>
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
        {exercise.randomStories.slice(0, 2).map((story) => (
          <button
            className={styles.primaryButton}
            key={story.sentenceId}
            onClick={() => onPickRandomStory(story.sentenceId)}
            type="button"
          >
            {story.title}
          </button>
        ))}
      </div>
    </div>
  );
}
