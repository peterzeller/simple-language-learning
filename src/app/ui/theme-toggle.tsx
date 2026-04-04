"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import styles from "@/app/ui/theme-toggle.module.css";

type Theme = "light" | "dark";

function getSystemTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem("theme");
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : getSystemTheme();
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const t = useTranslations();
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const nextTheme: Theme = theme === "dark" ? "light" : "dark";
  const themeName = nextTheme === "dark" ? t("theme.dark") : t("theme.light");
  const currentThemeName = theme === "dark" ? t("theme.light") : t("theme.dark");

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={() => {
        setTheme(nextTheme);
        window.localStorage.setItem("theme", nextTheme);
      }}
      aria-label={t("theme.switchTo", { theme: themeName.toLowerCase() })}
      title={t("theme.switchTo", { theme: themeName.toLowerCase() })}
    >
      <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
      <span>{t("theme.mode", { theme: currentThemeName })}</span>
    </button>
  );
}
