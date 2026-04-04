import { getLocale, getTranslations as getI18nTranslations } from "@/i18n";

export { getLocale };

export async function getTranslations() {
  return getI18nTranslations();
}
