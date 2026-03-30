import Link from "next/link";

import { login, logout } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";
import styles from "@/app/auth.module.css";
import { AuthForm } from "@/app/ui/auth-form";

export default async function Home() {
  const user = await getCurrentUser();

  if (user) {
    return (
      <main className={styles.page}>
        <section className={styles.sessionCard}>
          <span className={styles.eyebrow}>Simple Language Learning</span>
          <h1>Welcome back.</h1>
          <p>
            You’re signed in and ready to keep building the learning experience.
          </p>
          <p className={styles.emailPill}>{user.email}</p>
          <form className={styles.logoutForm} action={logout}>
            <button className={styles.secondaryButton} type="submit">
              Log out
            </button>
          </form>
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
