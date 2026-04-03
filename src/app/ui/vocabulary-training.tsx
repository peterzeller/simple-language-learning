"use client";

import { useState, useTransition } from "react";

import { getNextVocabularyQuestion, submitVocabularyAnswer } from "@/app/vocabulary-training/actions";
import type { VocabularyQuestion } from "@/lib/learning";
import styles from "@/app/auth.module.css";

interface VocabularyTrainingProps {
  initialQuestion: VocabularyQuestion | null;
}

type FeedbackState = "correct" | "wrong" | null;

export function VocabularyTraining({ initialQuestion }: VocabularyTrainingProps) {
  const [question, setQuestion] = useState<VocabularyQuestion | null>(initialQuestion);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [isPending, startTransition] = useTransition();

  const loadNextQuestion = () => {
    startTransition(async () => {
      const nextQuestion = await getNextVocabularyQuestion();
      setQuestion(nextQuestion);
      setSelectedOption(null);
      setFeedback(null);
    });
  };

  if (!question) {
    return <p className={styles.helperText}>Add more translated words first to start this game.</p>;
  }

  return (
    <div className={styles.trainingLayout}>
      <div className={styles.vocabularyPrompt}>
        <h2>{question.sourceWord}</h2>
        <p>Pick the correct translation.</p>
      </div>

      <div className={styles.optionsGrid}>
        {question.options.map((option) => {
          const isSelected = selectedOption === option;
          const isCorrectOption = option === question.correctTranslation;
          const optionClassName = [styles.optionButton];

          if (isSelected && feedback === "correct") {
            optionClassName.push(styles.optionCorrect);
          }

          if (isSelected && feedback === "wrong") {
            optionClassName.push(styles.optionWrong);
          }

          if (feedback === "wrong" && !isSelected && isCorrectOption) {
            optionClassName.push(styles.optionCorrect);
          }

          return (
            <button
              className={optionClassName.join(" ")}
              disabled={isPending || feedback !== null}
              key={option}
              onClick={() => {
                if (isPending || feedback !== null) {
                  return;
                }

                const isCorrect = option === question.correctTranslation;
                setSelectedOption(option);
                setFeedback(isCorrect ? "correct" : "wrong");

                startTransition(async () => {
                  const nextQuestion = await submitVocabularyAnswer({
                    wordId: question.wordId,
                    isCorrect,
                  });

                  if (isCorrect) {
                    window.setTimeout(() => {
                      setQuestion(nextQuestion);
                      setSelectedOption(null);
                      setFeedback(null);
                    }, 300);
                  }
                });
              }}
              type="button"
            >
              {option}
            </button>
          );
        })}
      </div>

      <button
        className={styles.secondaryButton}
        disabled={isPending || feedback === "wrong"}
        onClick={() => {
          loadNextQuestion();
        }}
        type="button"
      >
        Skip
      </button>

      {feedback === "wrong" && (
        <button
          className={styles.primaryButton}
          disabled={isPending}
          onClick={() => {
            loadNextQuestion();
          }}
          type="button"
        >
          Next question
        </button>
      )}
    </div>
  );
}
