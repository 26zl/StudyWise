import { cookies, headers } from "next/headers";
import {
  getPreferredLanguageFromAcceptLanguage,
  isLanguage,
  LANGUAGE_COOKIE_KEY,
} from "./core";
import type { Language } from "./types";

export async function resolveRequestLanguage(): Promise<Language> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLanguage = cookieStore.get(LANGUAGE_COOKIE_KEY)?.value;

  if (isLanguage(cookieLanguage)) {
    return cookieLanguage;
  }

  return getPreferredLanguageFromAcceptLanguage(headerStore.get("accept-language"));
}
