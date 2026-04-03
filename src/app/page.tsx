import Link from "next/link";

import { login, logout } from "@/app/actions";
import { AuthForm } from "@/app/ui/auth-form";
import styles from "@/app/auth.module.css";
import { getCurrentUser } from "@/lib/auth";
import { getKnownWordsCount } from "@/lib/learning";

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    const knownWords = await getKnownWordsCount(user.id);

    return (
      <main className={styles.page}>
        <section className={styles.sessionCard}>
          <span className={styles.eyebrow}>Simple Language Learning</span>
          <h1>Welcome back.</h1>
          <p className={styles.emailPill}>{user.email}</p>

          <div className={styles.statsCard}>
            <h2>Your stats</h2>
            <p>
              Words you know: <strong>{knownWords}</strong>
            </p>
            <Link className={styles.helperLink} href="/stats">
              View detailed stats →
            </Link>
          </div>

          <div className={styles.gamesList}>
            <article className={styles.gameCard}>
              <h2>Sentence translation</h2>
              <p>
                Practice full sentences with contextual word hints and quick multiple-choice checks.
              </p>
              <Link className={styles.primaryButton} href="/sentence-translation">
                Start game
              </Link>
            </article>

            <article className={styles.gameCard}>
              <h2>Vocabulary training</h2>
              <p>Drill individual words and build up your personal dictionary.</p>
              <Link className={styles.primaryButton} href="/vocabulary-training">
                Start game
              </Link>
            </article>
          </div>

          <div className={styles.topicActions}>
            {user.id === 1 ? (
              <Link className={styles.helperLink} href="/admin">
                Open admin interface →
              </Link>
            ) : null}

            <form className={styles.logoutForm} action={logout}>
              <button className={styles.secondaryButton} type="submit">
                Log out
              </button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <AuthForm
        action={login}
        submitLabel="Log in"
        title="Log in and keep learning"
        description="Sign in with your email and password. New here? You can create an account in a few seconds."
        alternateHref="/register"
        alternateLabel="Create an account"
        alternateText="Need a new login?"
      />
      <Link href="/register" hidden>
        Register
      </Link>
    </main>
  );
}
