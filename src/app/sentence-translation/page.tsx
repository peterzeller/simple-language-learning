import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { createSentenceExercise } from "@/lib/sentence-translation";
import styles from "@/app/auth.module.css";
import { SentenceTraining } from "@/app/ui/sentence-training";

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

  const topic = normalizeTopic((await searchParams).topic);
  const exercise = topic
    ? await createSentenceExercise({
        topic,
        userId: user.id,
      })
    : null;

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Sentence translation</span>
        <h1>Practice sentence translation</h1>
        <p>Pick a topic and start practicing with sentence-level translation prompts.</p>

        <form className={styles.topicForm} method="get">
          <label className={styles.field} htmlFor="topic">
            Topic
            <select defaultValue={topic} id="topic" name="topic">
              <option value="">Choose a topic</option>
              <option value="weekend">Weekend</option>
              <option value="travel">Travel</option>
              <option value="food">Food</option>
            </select>
          </label>
          <button className={styles.primaryButton} type="submit">
            Generate sentence
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
