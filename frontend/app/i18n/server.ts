import { cookies, headers } from "next/headers";
import {
  getPreferredLanguageFromAcceptLanguage,
  isLanguage,
  LANGUAGE_COOKIE_KEY,
  translate,
} from "./core";
import type { Language, MessageKey, TranslationValues } from "./types";

export async function resolveRequestLanguage(): Promise<Language> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLanguage = cookieStore.get(LANGUAGE_COOKIE_KEY)?.value;

  if (isLanguage(cookieLanguage)) {
    return cookieLanguage;
  }

  return getPreferredLanguageFromAcceptLanguage(headerStore.get("accept-language"));
}

export async function translateServer(
  key: MessageKey,
  values?: TranslationValues,
): Promise<string> {
  const language = await resolveRequestLanguage();
  return translate(language, key, values);
}
