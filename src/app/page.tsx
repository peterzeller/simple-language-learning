import Link from "next/link";

import { login, logout } from "@/app/actions";
import { AuthForm } from "@/app/ui/auth-form";
import styles from "@/app/auth.module.css";
import { getCurrentUser } from "@/lib/auth";
import { getKnownWordsCount } from "@/lib/learning";
import { getTranslations } from "@/i18n";

export default async function Home() {
  const t = await getTranslations();
  const user = await getCurrentUser();

  if (user) {
    const knownWords = await getKnownWordsCount(user.id);

    return (
      <main className={styles.page}>
        <section className={styles.sessionCard}>
          <span className={styles.eyebrow}>{t("common.appName")}</span>
          <h1>{t("home.welcome")}</h1>
          <p className={styles.emailPill}>{user.email}</p>

          <div className={styles.statsCard}>
            <h2>{t("home.yourStats")}</h2>
            <p>{t("home.wordsYouKnow", { count: knownWords })}</p>
            <Link className={styles.helperLink} href="/stats">
              {t("home.viewDetailedStats")}
            </Link>
          </div>

          <div className={styles.gamesList}>
            <article className={styles.gameCard}>
              <h2>{t("home.sentenceTranslation")}</h2>
              <p>{t("home.sentenceDescription")}</p>
              <Link className={styles.primaryButton} href="/sentence-translation">
                {t("home.startGame")}
              </Link>
            </article>

            <article className={styles.gameCard}>
              <h2>{t("home.vocabularyTraining")}</h2>
              <p>{t("home.vocabularyDescription")}</p>
              <Link className={styles.primaryButton} href="/vocabulary-training">
                {t("home.startGame")}
              </Link>
            </article>
          </div>

          <div className={styles.topicActions}>
            {user.id === 1 ? (
              <Link className={styles.helperLink} href="/admin">
                {t("home.openAdmin")}
              </Link>
            ) : null}

            <form className={styles.logoutForm} action={logout}>
              <button className={styles.secondaryButton} type="submit">
                {t("home.logout")}
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
        submitLabel={t("home.login")}
        title={t("home.loginTitle")}
        description={t("home.loginDescription")}
        alternateHref="/register"
        alternateLabel={t("home.createAccount")}
        alternateText={t("home.needLogin")}
        appName={t("common.appName")}
        emailLabel={t("auth.email")}
        passwordLabel={t("auth.password")}
        workingLabel={t("auth.working")}
        isRegister={false}
      />
      <Link href="/register" hidden>
        Register
      </Link>
    </main>
  );
}
