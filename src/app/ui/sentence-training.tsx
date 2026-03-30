"use client";

import { useMemo, useState, useTransition } from "react";

import { recordSentenceAnswer } from "@/app/sentence-translation/actions";
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
  const [isPending, startTransition] = useTransition();

  const questionByIndex = useMemo(
    () => new Map(exercise.questions.map((question) => [question.tokenIndex, question])),
    [exercise.questions],
  );

  return (
    <div className={styles.trainingLayout}>
      <div className={styles.sentenceLine}>
        {exercise.tokens.map((token, index) => {
          const shouldReveal = !token.isKnown || revealedWords[index];

          return (
            <button
              className={styles.wordCard}
              key={`${token.source}-${index}`}
              onClick={() => {
                if (token.isKnown) {
                  setRevealedWords((prev) => ({ ...prev, [index]: !prev[index] }));
                }
              }}
              type="button"
            >
              <span>{token.source}</span>
              <small className={styles.wordTranslation}>
                {shouldReveal ? token.target : "tap to reveal"}
              </small>
            </button>
          );
        })}
      </div>

      {exercise.tokens.map((token, index) => {
        const question = questionByIndex.get(index);

        if (!question) {
          return null;
        }

        const answer = answers[index];

        return (
          <section className={styles.questionBlock} key={index}>
            <h2>
              Select the translation for <strong>{token.source}</strong>
            </h2>
            <div className={styles.optionsGrid}>
              {question.options.map((option) => {
                const isSelected = answer?.selectedOption === option;
                const isCorrectOption = option === question.correctAnswer;
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

                      const isCorrect = option === question.correctAnswer;
                      setAnswers((prev) => ({
                        ...prev,
                        [index]: {
                          selectedOption: option,
                          isCorrect,
                        },
                      }));

                      startTransition(async () => {
                        await recordSentenceAnswer({
                          wordId: token.wordId,
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
            {answer && (
              <p className={answer.isCorrect ? styles.feedbackCorrect : styles.feedbackWrong}>
                {answer.isCorrect ? "Correct!" : "Not quite—see the bold answer above."}
              </p>
            )}
          </section>
        );
      })}
      {isPending && <p className={styles.helperText}>Saving your progress…</p>}
    </div>
  );
}
