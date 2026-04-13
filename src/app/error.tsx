"use client";

import Link from "next/link";

import styles from "@/app/auth.module.css";

export default function GlobalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const friendlyMessage =
    "Something went wrong while preparing this page. Please try again in a moment.";

  console.error("Unhandled application error", {
    message: error.message,
    digest: error.digest,
  });

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>Error</span>
        <h1>We hit a temporary problem</h1>
        <p>{friendlyMessage}</p>

        <button type="button" className={styles.button} onClick={reset}>
          Try again
        </button>

        <Link className={styles.helperLink} href="/">
          Back to home
        </Link>
      </section>
    </main>
  );
}
