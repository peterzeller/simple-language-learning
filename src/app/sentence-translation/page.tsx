import Link from "next/link";
import { redirect } from "next/navigation";

import styles from "@/app/auth.module.css";
import { SentenceTranslationWorkspace } from "@/app/ui/sentence-translation-workspace";
import { getCurrentUser } from "@/lib/auth";
import { createSentenceExerciseFromRandomSentence } from "@/lib/sentence-translation";
import { getTranslations } from "@/i18n";

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
  const t = await getTranslations();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const params = await searchParams;
  const topic = normalizeTopic(params.topic) || t("sentence.defaultTopic");
  const exercise = await createSentenceExerciseFromRandomSentence({
    topic,
    userId: user.id,
  });

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>{t("home.sentenceTranslation")}</span>
        <h1>{t("sentence.title")}</h1>
        <p>{t("sentence.description")}</p>

        <SentenceTranslationWorkspace initialExercise={exercise} initialTopic={topic} />

        <Link className={styles.helperLink} href="/">
          {t("common.backHome")}
        </Link>
      </section>
    </main>
  );
}
