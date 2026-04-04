import Link from "next/link";
import { redirect } from "next/navigation";

import styles from "@/app/auth.module.css";
import { getCurrentUser } from "@/lib/auth";
import { getUserWordKnowledgeTable } from "@/lib/learning";
import { getTranslations } from "@/i18n";

function toPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export default async function StatsPage() {
  const t = await getTranslations();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const words = await getUserWordKnowledgeTable(user.id);

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>{t("home.yourStats")}</span>
        <h1>{t("stats.wordKnowledge")}</h1>
        <p>{t("stats.ranked")}</p>

        <div className={styles.tableWrapper}>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <th>{t("stats.word")}</th>
                <th>{t("stats.language")}</th>
                <th>{t("stats.knowledge")}</th>
                <th>{t("stats.correct")}</th>
                <th>{t("stats.incorrect")}</th>
                <th>{t("stats.lastCorrect")}</th>
              </tr>
            </thead>
            <tbody>
              {words.map((word) => (
                <tr key={word.wordId}>
                  <td>{word.word}</td>
                  <td>{word.language}</td>
                  <td>{toPercent(word.knowledgeScore)}</td>
                  <td>{word.correctAttempts}</td>
                  <td>{word.incorrectAttempts}</td>
                  <td>{word.lastCorrectAt ? word.lastCorrectAt.toLocaleDateString() : t("stats.never")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {words.length === 0 ? <p>{t("stats.none")}</p> : null}

        <Link className={styles.helperLink} href="/">
          {t("common.backHome")}
        </Link>
      </section>
    </main>
  );
}
