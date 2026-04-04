import Link from "next/link";
import { redirect } from "next/navigation";

import styles from "@/app/auth.module.css";
import { getCurrentUser } from "@/lib/auth";
import { getVocabularyQuestionForUser } from "@/lib/learning";
import { VocabularyTraining } from "@/app/ui/vocabulary-training";
import { getTranslations } from "@/i18n";

export default async function VocabularyTrainingPage() {
  const t = await getTranslations();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const initialQuestion = await getVocabularyQuestionForUser({
    userId: user.id,
    learningLanguage: user.learningLanguage,
    knownLanguage: user.knownLanguage,
  });

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>{t("home.vocabularyTraining")}</span>
        <h1>{t("vocabulary.title")}</h1>
        <p>{t("vocabulary.description")}</p>

        <VocabularyTraining initialQuestion={initialQuestion} />

        <Link className={styles.helperLink} href="/">
          {t("common.backHome")}
        </Link>
      </section>
    </main>
  );
}
