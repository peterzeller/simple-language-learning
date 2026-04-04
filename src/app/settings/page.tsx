import Link from "next/link";

import styles from "@/app/auth.module.css";
import { saveLocale } from "@/app/settings/actions";
import { getLocale, getTranslations } from "@/i18n";

interface SettingsPageProps {
  searchParams: Promise<{ saved?: string }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const t = await getTranslations();
  const locale = await getLocale();
  const params = await searchParams;

  return (
    <main className={styles.page}>
      <section className={styles.sessionCard}>
        <span className={styles.eyebrow}>{t("common.settings")}</span>
        <h1>{t("settings.title")}</h1>
        <p>{t("settings.description")}</p>

        <form className={styles.form} action={saveLocale}>
          <label className={styles.field}>
            <span>{t("common.language")}</span>
            <select name="locale" defaultValue={locale}>
              <option value="en">{t("common.english")}</option>
              <option value="de">{t("common.german")}</option>
            </select>
          </label>
          <button className={styles.primaryButton} type="submit">
            {t("common.save")}
          </button>
        </form>

        {params.saved === "1" ? <p className={styles.helperText}>{t("common.saved")}</p> : null}

        <Link className={styles.helperLink} href="/">
          {t("common.backHome")}
        </Link>
      </section>
    </main>
  );
}
