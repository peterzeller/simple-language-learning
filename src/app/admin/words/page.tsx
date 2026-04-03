import Link from "next/link";

import styles from "@/app/auth.module.css";
import { ensureLearningTables, getDb } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin-auth";

export default async function AdminWordsPage() {
  await requireAdminUser();
  await ensureLearningTables();
  const db = getDb();

  const words = await db
    .selectFrom("words")
    .select(["id", "language", "word"])
    .orderBy("language", "asc")
    .orderBy("word", "asc")
    .execute();

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Admin</span>
        <h1>Words</h1>
        <p>Total words: {words.length}</p>

        <div className={styles.tableWrapper}>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Language</th>
                <th>Word</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {words.map((word) => (
                <tr key={word.id}>
                  <td>{word.id}</td>
                  <td>{word.language}</td>
                  <td>{word.word}</td>
                  <td>
                    <Link className={styles.helperLink} href={`/admin/words/${word.id}`}>
                      View details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {words.length === 0 ? <p>No words stored.</p> : null}

        <div className={styles.topicActions}>
          <Link className={styles.helperLink} href="/admin">
            ← Back to admin
          </Link>
          <Link className={styles.helperLink} href="/">
            ← Back to home
          </Link>
        </div>
      </section>
    </main>
  );
}
