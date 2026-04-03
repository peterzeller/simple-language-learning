import Link from "next/link";
import { redirect } from "next/navigation";

import styles from "@/app/auth.module.css";
import { getCurrentUser } from "@/lib/auth";
import { getVocabularyQuestionForUser } from "@/lib/learning";
import { VocabularyTraining } from "@/app/ui/vocabulary-training";

export default async function VocabularyTrainingPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const initialQuestion = await getVocabularyQuestionForUser(user.id);

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Vocabulary training</span>
        <h1>Practice vocabulary</h1>
        <p>Select the correct translation for each word.</p>

        <VocabularyTraining initialQuestion={initialQuestion} />

        <Link className={styles.helperLink} href="/">
          ← Back to home
        </Link>
      </section>
    </main>
  );
}
