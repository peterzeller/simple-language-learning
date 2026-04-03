import Link from "next/link";

import styles from "@/app/auth.module.css";
import { deleteSentence } from "@/app/admin/actions";
import { ensureLearningTables, getDb } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin-auth";

export default async function AdminSentencesPage() {
  await requireAdminUser();
  await ensureLearningTables();
  const db = getDb();

  const sentences = await db
    .selectFrom("sentence_translations")
    .select(["id", "topic", "raw_sentence", "created_at"])
    .orderBy("created_at", "desc")
    .execute();

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Admin</span>
        <h1>Sentences</h1>
        <p>Total sentences: {sentences.length}</p>

        <div className={styles.tableWrapper}>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Topic</th>
                <th>Sentence</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sentences.map((sentence) => (
                <tr key={sentence.id}>
                  <td>{sentence.id}</td>
                  <td>{sentence.topic}</td>
                  <td>{sentence.raw_sentence}</td>
                  <td>{sentence.created_at.toLocaleString()}</td>
                  <td>
                    <form action={deleteSentence}>
                      <input type="hidden" name="sentenceId" value={sentence.id} />
                      <button className={styles.secondaryButton} type="submit">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sentences.length === 0 ? <p>No stored sentences.</p> : null}

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
