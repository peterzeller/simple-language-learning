import Link from "next/link";
import { redirect } from "next/navigation";

import styles from "@/app/auth.module.css";
import { getCurrentUser } from "@/lib/auth";

export default async function VocabularyTrainingPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Vocabulary training</span>
        <h1>Coming soon</h1>
        <p>Vocabulary training will be added in a follow-up task.</p>
        <Link className={styles.helperLink} href="/">
          ← Back to home
        </Link>
      </section>
    </main>
  );
}
