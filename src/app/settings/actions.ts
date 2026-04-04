"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LOCALE_COOKIE, isLocale } from "@/i18n";
import { getCurrentUser } from "@/lib/auth";
import { ensureUsersTable, getDb } from "@/lib/db";
import { isSupportedLearningLanguage } from "@/lib/language-settings";

export async function saveSettings(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "");
  const learningLanguage = String(formData.get("learningLanguage") ?? "");
  const knownLanguage = String(formData.get("knownLanguage") ?? "");

  if (!isLocale(locale)) {
    redirect("/settings");
  }
  if (
    !isSupportedLearningLanguage(learningLanguage)
    || !isSupportedLearningLanguage(knownLanguage)
    || learningLanguage === knownLanguage
  ) {
    redirect("/settings");
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });

  const user = await getCurrentUser();

  if (user) {
    await ensureUsersTable();
    const db = getDb();
    await db
      .updateTable("users")
      .set({
        learning_language: learningLanguage,
        known_language: knownLanguage,
        updated_at: new Date(),
      })
      .where("id", "=", user.id)
      .executeTakeFirst();
  }

  redirect("/settings?saved=1");
}
