"use client";

/**
 * React-context for valgt språk (nb/en).
 * Eksponerer `t()` for oversettelser og persisterer valget i en cookie.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE_KEY, translate } from "./core";
import type { Language, MessageKey, TranslationValues, Translator } from "./types";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translator;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function setLanguageCookie(language: Language) {
  if (typeof window === "undefined") {
    return;
  }

  // SSR-språkpersistens trengs kun i deployed sikre kontekster.
  if (!window.isSecureContext) {
    return;
  }

  document.cookie = `${LANGUAGE_COOKIE_KEY}=${encodeURIComponent(language)}; path=/; max-age=31536000; SameSite=Lax; Secure`;
}

export function LanguageProvider({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setLanguageCookie(language);
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
  }, []);

  const t = useCallback(
    (key: MessageKey, values?: TranslationValues) => translate(language, key, values),
    [language],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t,
    }),
    [language, setLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }

  return context;
}
