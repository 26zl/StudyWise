/*
 * i18n – LanguageProvider, useLanguage-hook og t()-hjelpefunksjon.
 * Støtter nb (norsk bokmål) og en (engelsk) med fallback til nb, deretter key-navn.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Language, TranslationKey } from "./types";
import { nb } from "./messages/nb";
import { en } from "./messages/en";

const STORAGE_KEY = "studywise_language";

const messages: Record<Language, Record<string, unknown>> = { nb, en };

function getNestedValue(obj: Record<string, unknown>, key: string): string | undefined {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("nb");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "nb") {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      const current = messages[language] as Record<string, unknown>;
      const fallback = messages.nb as Record<string, unknown>;
      return (
        getNestedValue(current, key) ??
        getNestedValue(fallback, key) ??
        key
      );
    },
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage må brukes innenfor LanguageProvider");
  return ctx;
}
