/**
 * Server-side språkdeteksjon: leser cookie først, fall-backer til Accept-Language.
 * Brukes av RSC-render for å sette riktig språk før hydrering.
 */

import { cookies, headers } from "next/headers";
import {
  getPreferredLanguageFromAcceptLanguage,
  isLanguage,
  LANGUAGE_COOKIE_KEY,
} from "./core";
import type { Language } from "./types";

// Henter gjeldende språk fra cookie eller Accept-Language-header.
export async function resolveRequestLanguage(): Promise<Language> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const cookieLanguage = cookieStore.get(LANGUAGE_COOKIE_KEY)?.value;

  if (isLanguage(cookieLanguage)) {
    return cookieLanguage;
  }

  return getPreferredLanguageFromAcceptLanguage(headerStore.get("accept-language"));
}
