import Link from "next/link";
import { redirect } from "next/navigation";

import styles from "@/app/auth.module.css";
import { getCurrentUser } from "@/lib/auth";
import { getUserWordKnowledgeTable } from "@/lib/learning";

function toPercent(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export default async function StatsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/");
  }

  const words = await getUserWordKnowledgeTable(user.id);

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Your stats</span>
        <h1>Word knowledge</h1>
        <p>Words are ranked by your current estimated knowledge score.</p>

        <div className={styles.tableWrapper}>
          <table className={styles.statsTable}>
            <thead>
              <tr>
                <th>Word</th>
                <th>Language</th>
                <th>Knowledge</th>
                <th>Correct</th>
                <th>Incorrect</th>
                <th>Last correct</th>
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
                  <td>{word.lastCorrectAt ? word.lastCorrectAt.toLocaleDateString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {words.length === 0 ? <p>No learning attempts yet.</p> : null}

        <Link className={styles.helperLink} href="/">
          ← Back to home
        </Link>
      </section>
    </main>
  );
}
