import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { NextIntlClientProvider } from "next-intl";

import { ThemeToggle } from "@/app/ui/theme-toggle";
import { getLocale, getMessages, getTranslations } from "@/i18n";
import "./globals.css";
import styles from "@/app/auth.module.css";

export const metadata: Metadata = {
  title: "Simple Language Learning",
  description: "Login and registration for Simple Language Learning.",
};

const themeInitializationScript = `
(() => {
  const storedTheme = window.localStorage.getItem("theme");
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : (systemPrefersDark ? "dark" : "light");

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = getMessages(locale);
  const t = await getTranslations();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitializationScript}
        </Script>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <div className={styles.topBar} >
            <Link href="/settings">{t("common.settings")}</Link>
            <ThemeToggle />
          </div>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
