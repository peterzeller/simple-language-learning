import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/app/auth.module.css";
import { deleteWord, deleteWordTranslation } from "@/app/admin/actions";
import { ensureLearningTables, getDb } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin-auth";

interface AdminWordDetailPageProps {
  params: Promise<{ wordId: string }>;
}

export default async function AdminWordDetailPage({ params }: AdminWordDetailPageProps) {
  await requireAdminUser();
  await ensureLearningTables();
  const db = getDb();

  const { wordId } = await params;
  const parsedWordId = Number(wordId);

  if (!Number.isInteger(parsedWordId) || parsedWordId <= 0) {
    notFound();
  }

  const word = await db
    .selectFrom("words")
    .select(["id", "language", "word"])
    .where("id", "=", parsedWordId)
    .executeTakeFirst();

  if (!word) {
    notFound();
  }

  const fromTranslations = await db
    .selectFrom("word_links")
    .innerJoin("words as linked", "linked.id", "word_links.to_id")
    .select([
      "word_links.from_id as fromId",
      "word_links.to_id as toId",
      "linked.language as linkedLanguage",
      "linked.word as linkedWord",
    ])
    .where("word_links.from_id", "=", word.id)
    .orderBy("linked.language", "asc")
    .orderBy("linked.word", "asc")
    .execute();

  const toTranslations = await db
    .selectFrom("word_links")
    .innerJoin("words as linked", "linked.id", "word_links.from_id")
    .select([
      "word_links.from_id as fromId",
      "word_links.to_id as toId",
      "linked.language as linkedLanguage",
      "linked.word as linkedWord",
    ])
    .where("word_links.to_id", "=", word.id)
    .orderBy("linked.language", "asc")
    .orderBy("linked.word", "asc")
    .execute();

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Admin</span>
        <h1>Word detail</h1>
        <p>
          <strong>{word.word}</strong> ({word.language}) — id {word.id}
        </p>

        <div className={styles.statsCard}>
          <h2>Translations from this word</h2>
          {fromTranslations.length === 0 ? <p>No outgoing translations.</p> : null}
          <ul className={styles.adminList}>
            {fromTranslations.map((translation) => (
              <li key={`${translation.fromId}-${translation.toId}`}>
                <span>
                  → {translation.linkedWord} ({translation.linkedLanguage})
                </span>
                <form action={deleteWordTranslation}>
                  <input type="hidden" name="wordId" value={word.id} />
                  <input type="hidden" name="fromId" value={translation.fromId} />
                  <input type="hidden" name="toId" value={translation.toId} />
                  <button className={styles.secondaryButton} type="submit">
                    Delete translation
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.statsCard}>
          <h2>Translations to this word</h2>
          {toTranslations.length === 0 ? <p>No incoming translations.</p> : null}
          <ul className={styles.adminList}>
            {toTranslations.map((translation) => (
              <li key={`${translation.fromId}-${translation.toId}`}>
                <span>
                  ← {translation.linkedWord} ({translation.linkedLanguage})
                </span>
                <form action={deleteWordTranslation}>
                  <input type="hidden" name="wordId" value={word.id} />
                  <input type="hidden" name="fromId" value={translation.fromId} />
                  <input type="hidden" name="toId" value={translation.toId} />
                  <button className={styles.secondaryButton} type="submit">
                    Delete translation
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>

        <form action={deleteWord}>
          <input type="hidden" name="wordId" value={word.id} />
          <button className={styles.dangerButton} type="submit">
            Delete word
          </button>
        </form>

        <div className={styles.topicActions}>
          <Link className={styles.helperLink} href="/admin/words">
            ← Back to words
          </Link>
          <Link className={styles.helperLink} href="/admin">
            ← Back to admin
          </Link>
        </div>
      </section>
    </main>
  );
}
