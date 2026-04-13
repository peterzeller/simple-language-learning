import Link from "next/link";
import { redirect } from "next/navigation";

import styles from "@/app/auth.module.css";
import { SentenceTranslationWorkspace } from "@/app/ui/sentence-translation-workspace";
import { getCurrentUser } from "@/lib/auth";
import {
  createSentenceExerciseFromRandomSentence,
  createSentenceExerciseFromSentenceId,
  type SentenceExercise,
} from "@/lib/sentence-translation";
import { getTranslations } from "@/i18n";

interface SentenceTranslationPageProps {
  searchParams: Promise<{ topic?: string | string[]; sentenceId?: string | string[] }>;
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
  const requestedTopic = normalizeTopic(params.topic);
  const topic = requestedTopic || t("sentence.defaultTopic");
  const sentenceIdParam = normalizeTopic(params.sentenceId);
  const sentenceId = Number(sentenceIdParam);
  const hasRequestedSentenceId = Number.isInteger(sentenceId) && sentenceId > 0;
  let exercise: SentenceExercise;

  try {
    exercise = hasRequestedSentenceId
      ? await createSentenceExerciseFromSentenceId({
          sentenceId,
          topic,
          userId: user.id,
          learningLanguage: user.learningLanguage,
          knownLanguage: user.knownLanguage,
        })
      : await createSentenceExerciseFromRandomSentence({
          topic,
          userId: user.id,
          learningLanguage: user.learningLanguage,
          knownLanguage: user.knownLanguage,
        });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error("Failed to build sentence translation exercise.", {
      userId: user.id,
      hasRequestedSentenceId,
      sentenceId: hasRequestedSentenceId ? sentenceId : null,
      topic,
      error,
    });

    if (message.includes("Monthly OpenAI budget exceeded")) {
      return (
        <main className={styles.page}>
          <section className={styles.sessionCard}>
            <span className={styles.eyebrow}>{t("home.sentenceTranslation")}</span>
            <h1>{t("sentence.title")}</h1>
            <p>
              The OpenAI monthly budget for this account is exhausted. Please add your own key
              in settings or wait until the budget resets.
            </p>

            <Link className={styles.helperLink} href="/settings">
              Open settings
            </Link>

            <Link className={styles.helperLink} href="/">
              {t("common.backHome")}
            </Link>
          </section>
        </main>
      );
    }

    throw error;
  }

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>{t("home.sentenceTranslation")}</span>
        <h1>{t("sentence.title")}</h1>
        <p>{t("sentence.description")}</p>

        <SentenceTranslationWorkspace
          initialExercise={exercise}
          initialTopicInput={requestedTopic}
        />

        <Link className={styles.helperLink} href="/sentences">
          {t("sentence.browseStories")}
        </Link>

        <Link className={styles.helperLink} href="/">
          {t("common.backHome")}
        </Link>
      </section>
    </main>
  );
}
