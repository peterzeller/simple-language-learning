import Link from "next/link";

import { redirectLoggedInUsers, register } from "@/app/actions";
import styles from "@/app/auth.module.css";
import { AuthForm } from "@/app/ui/auth-form";
import { getTranslations } from "@/i18n";

export default async function RegisterPage() {
  await redirectLoggedInUsers();
  const t = await getTranslations();

  return (
    <main className={styles.page}>
      <AuthForm
        action={register}
        submitLabel={t("register.submit")}
        title={t("register.title")}
        description={t("register.description")}
        alternateHref="/"
        alternateLabel={t("home.login")}
        alternateText={t("register.alternateText")}
        appName={t("common.appName")}
        emailLabel={t("auth.email")}
        passwordLabel={t("auth.password")}
        workingLabel={t("auth.working")}
        isRegister
      />
      <Link href="/" hidden>
        Back to login
      </Link>
    </main>
  );
}
