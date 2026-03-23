"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE_KEY,
  isLanguage,
  LANGUAGE_STORAGE_KEY,
  translate,
} from "./core";
import type { Language, MessageKey, TranslationValues, Translator } from "./types";

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translator;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

function getClientPreferredLanguage(fallback: Language): Language {
  if (typeof window === "undefined") {
    return fallback;
  }

  const storedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (isLanguage(storedLanguage)) {
    return storedLanguage;
  }

  return window.navigator.language.toLowerCase().startsWith("en") ? "en" : fallback;
}

function setLanguageCookie(language: Language) {
  if (typeof window === "undefined") {
    return;
  }

  // SSR language persistence is only needed in deployed secure contexts.
  // localStorage still preserves the preference during local http development.
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
    const preferredLanguage = getClientPreferredLanguage(initialLanguage);
    setLanguageState((currentLanguage) =>
      currentLanguage === preferredLanguage ? currentLanguage : preferredLanguage,
    );
  }, [initialLanguage]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
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
