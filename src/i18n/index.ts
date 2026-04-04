import { cookies } from "next/headers";

import { defaultLocale, locales, messages, type Locale, type Messages } from "@/i18n/messages";

export const LOCALE_COOKIE = "ui-locale";

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;

  if (fromCookie && isLocale(fromCookie)) {
    return fromCookie;
  }

  return defaultLocale;
}

export function getMessages(locale: Locale): Messages {
  return messages[locale];
}

function format(template: string, values?: Record<string, string | number>): string {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ""));
}

function resolve(messageSet: Messages, key: string): string {
  return key.split(".").reduce<unknown>((current, segment) => {
    if (typeof current === "object" && current !== null && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return key;
  }, messageSet) as string;
}

export async function getTranslations() {
  const locale = await getLocale();
  const messageSet = getMessages(locale);

  return (key: string, values?: Record<string, string | number>) => {
    const template = resolve(messageSet, key);
    return format(template, values);
  };
}
