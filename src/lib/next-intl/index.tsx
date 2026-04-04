"use client";

import { createContext, useContext } from "react";

import type { Locale, Messages } from "@/i18n/messages";

interface NextIntlContextValue {
  locale: Locale;
  messages: Messages;
}

const NextIntlContext = createContext<NextIntlContextValue | null>(null);

function format(template: string, values?: Record<string, string | number>): string {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ""));
}

function resolve(messages: Messages, key: string): string {
  return key.split(".").reduce<unknown>((current, segment) => {
    if (typeof current === "object" && current !== null && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return key;
  }, messages) as string;
}

export function NextIntlClientProvider({
  children,
  locale,
  messages,
}: {
  children: React.ReactNode;
  locale: Locale;
  messages: Messages;
}) {
  return <NextIntlContext.Provider value={{ locale, messages }}>{children}</NextIntlContext.Provider>;
}

export function useTranslations() {
  const context = useContext(NextIntlContext);

  if (!context) {
    throw new Error("useTranslations must be used within NextIntlClientProvider");
  }

  return (key: string, values?: Record<string, string | number>) => {
    const template = resolve(context.messages, key);
    return format(template, values);
  };
}
