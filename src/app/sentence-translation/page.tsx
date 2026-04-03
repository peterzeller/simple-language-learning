import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import {
  createSentenceExerciseFromPrompt,
  createSentenceExerciseFromRandomSentence,
} from "@/lib/sentence-translation";
import styles from "@/app/auth.module.css";
import { SentenceTraining } from "@/app/ui/sentence-training";

interface SentenceTranslationPageProps {
  searchParams: Promise<{ topic?: string | string[]; action?: string | string[] }>;
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
  const action = normalizeTopic(params.action);
  const shouldGenerateFromPrompt = action === "generate";
  const exercise = shouldGenerateFromPrompt
    ? await createSentenceExerciseFromPrompt({
        topic,
        userId: user.id,
      })
    : await createSentenceExerciseFromRandomSentence({
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
          <button className={styles.primaryButton} name="action" type="submit" value="generate">
            Create sentence from prompt
          </button>
          <button className={styles.primaryButton} name="action" type="submit" value="random">
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
