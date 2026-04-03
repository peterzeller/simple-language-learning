import Link from "next/link";
import { redirect } from "next/navigation";

import { createSentenceFromPrompt } from "@/app/sentence-translation/actions";
import styles from "@/app/auth.module.css";
import { PromptSubmitButton } from "@/app/ui/prompt-submit-button";
import { SentenceTraining } from "@/app/ui/sentence-training";
import { getCurrentUser } from "@/lib/auth";
import { createSentenceExerciseFromRandomSentence } from "@/lib/sentence-translation";

interface SentenceTranslationPageProps {
  searchParams: Promise<{ topic?: string | string[] }>;
}

function normalizeTopic(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export default async function SentenceTranslationPage({
  searchParams,
}: SentenceTranslationPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const params = await searchParams;
  const topic = normalizeTopic(params.topic) || "Random story";
  const exercise = await createSentenceExerciseFromRandomSentence({
    topic,
    userId: user.id,
  });

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Sentence translation</span>
        <h1>Practice sentence translation</h1>
        <p>Pick a topic and start practicing with sentence-level translation prompts.</p>

        <form className={styles.topicForm} method="get">
          <label className={styles.field} htmlFor="topic">
            Topic
            <input defaultValue={topic} id="topic" name="topic" placeholder="Enter a topic" />
          </label>
          <PromptSubmitButton action={createSentenceFromPrompt} />
          <button className={styles.primaryButton} type="submit">
            Pick random saved sentence
          </button>
        </form>

        {exercise && <SentenceTraining exercise={exercise} />}

        <Link className={styles.helperLink} href="/">
          ← Back to home
        </Link>
      </section>
    </main>
  );
}
