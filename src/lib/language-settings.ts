import "server-only";

export const SUPPORTED_LEARNING_LANGUAGES = ["en", "es", "de", "ko"] as const;

export type SupportedLearningLanguage = (typeof SUPPORTED_LEARNING_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLearningLanguage, string> = {
  en: "English",
  es: "Spanish",
  de: "German",
  ko: "Korean",
};

export function isSupportedLearningLanguage(value: string): value is SupportedLearningLanguage {
  return SUPPORTED_LEARNING_LANGUAGES.includes(value as SupportedLearningLanguage);
}
