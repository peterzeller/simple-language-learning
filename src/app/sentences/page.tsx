import Link from "next/link";
import { redirect } from "next/navigation";

import styles from "@/app/auth.module.css";
import { getCurrentUser } from "@/lib/auth";
import { ensureLearningTables, getDb } from "@/lib/db";
import { getTranslations } from "@/i18n";

const PAGE_SIZE = 20;

interface SentencesPageProps {
  searchParams: Promise<{ page?: string | string[] }>;
}

function normalizePage(value: string | string[] | undefined): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number(candidate);

  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

export default async function SentencesPage({ searchParams }: SentencesPageProps) {
  const t = await getTranslations();
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  await ensureLearningTables();
  const db = getDb();
  const params = await searchParams;
  const page = normalizePage(params.page);
  const countRow = await db
    .selectFrom("sentence_translations")
    .select((eb) => eb.fn.count<number>("id").as("sentenceCount"))
    .where("learning_language", "=", user.learningLanguage)
    .executeTakeFirstOrThrow();
  const totalSentences = Number(countRow.sentenceCount ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalSentences / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const offset = (currentPage - 1) * PAGE_SIZE;

  const sentences = await db
    .selectFrom("sentence_translations")
    .select(["id", "title", "topic", "created_at"])
    .where("learning_language", "=", user.learningLanguage)
    .orderBy("created_at", "desc")
    .offset(offset)
    .limit(PAGE_SIZE)
    .execute();

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>{t("home.sentenceTranslation")}</span>
        <h1>{t("sentences.title")}</h1>
        <p>{t("sentences.description")}</p>

        <div className={styles.tableWrapper}>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <th>{t("sentences.storyTitle")}</th>
                <th>{t("sentences.createdAt")}</th>
              </tr>
            </thead>
            <tbody>
              {sentences.map((sentence) => (
                <tr key={sentence.id}>
                  <td>
                    <Link className={styles.helperLink} href={`/sentence-translation?sentenceId=${sentence.id}`}>
                      {sentence.title?.trim() || sentence.topic.trim() || `Story ${sentence.id}`}
                    </Link>
                  </td>
                  <td>{sentence.created_at.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalSentences > 0 ? (
          <div className={styles.topicActions}>
            {currentPage > 1 ? (
              <Link className={styles.helperLink} href={`/sentences?page=${currentPage - 1}`}>
                {t("sentences.previous")}
              </Link>
            ) : (
              <span className={styles.helperText}>{t("sentences.previous")}</span>
            )}
            <p className={styles.helperText}>
              {t("sentences.pageLabel", { page: currentPage, totalPages })}
            </p>
            {currentPage < totalPages ? (
              <Link className={styles.helperLink} href={`/sentences?page=${currentPage + 1}`}>
                {t("sentences.next")}
              </Link>
            ) : (
              <span className={styles.helperText}>{t("sentences.next")}</span>
            )}
          </div>
        ) : (
          <p>{t("sentences.none")}</p>
        )}

        <Link className={styles.helperLink} href="/sentence-translation">
          {t("sentences.backToExercise")}
        </Link>
      </section>
    </main>
  );
}
