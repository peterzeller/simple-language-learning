import Link from "next/link";

import styles from "@/app/auth.module.css";
import { requireAdminUser } from "@/lib/admin-auth";

export default async function AdminPage() {
  await requireAdminUser();

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Admin</span>
        <h1>Administration</h1>
        <p>Manage words, translations, and saved sentence exercises.</p>

        <div className={styles.gamesList}>
          <article className={styles.gameCard}>
            <h2>Words</h2>
            <p>Browse all words and review/delete their translation links.</p>
            <Link className={styles.primaryButton} href="/admin/words">
              Open words
            </Link>
          </article>

          <article className={styles.gameCard}>
            <h2>Sentences</h2>
            <p>Review all stored sentences and remove entries you no longer need.</p>
            <Link className={styles.primaryButton} href="/admin/sentences">
              Open sentences
            </Link>
          </article>
        </div>

        <Link className={styles.helperLink} href="/">
          ← Back to home
        </Link>
      </section>
    </main>
  );
}
