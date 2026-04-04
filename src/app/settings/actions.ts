"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LOCALE_COOKIE, isLocale } from "@/i18n";

export async function saveLocale(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "");

  if (!isLocale(locale)) {
    redirect("/settings");
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });

  redirect("/settings?saved=1");
}
