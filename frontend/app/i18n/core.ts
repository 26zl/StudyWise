import { enMessages } from "./messages/en";
import { nbMessages } from "./messages/nb";
import type { Language, MessageKey, PartialMessages, TranslationValues } from "./types";

export const DEFAULT_LANGUAGE: Language = "nb";
export const LANGUAGE_COOKIE_KEY = "studywise-language";

const messagesByLanguage: Record<Language, PartialMessages> = {
  en: enMessages,
  nb: nbMessages,
};

export function isLanguage(value: string | null | undefined): value is Language {
  return value === "nb" || value === "en";
}

export function getPreferredLanguageFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
): Language {
  if (!acceptLanguage) {
    return DEFAULT_LANGUAGE;
  }

  return /\ben\b/i.test(acceptLanguage) ? "en" : DEFAULT_LANGUAGE;
}

export function getMessages(language: Language): PartialMessages {
  return messagesByLanguage[language];
}

function getNestedMessage(
  messages: PartialMessages,
  key: MessageKey,
): string | undefined {
  return key
    .split(".")
    .reduce<unknown>((current, part) => {
      if (current == null || typeof current !== "object") {
        return undefined;
      }

      return (current as Record<string, unknown>)[part];
    }, messages) as string | undefined;
}

function interpolateMessage(
  message: string,
  values?: TranslationValues,
): string {
  if (!values) {
    return message;
  }

  return message.replace(/\{(\w+)\}/g, (_match, placeholder: string) => {
    const value = values[placeholder];
    return value == null ? `{${placeholder}}` : String(value);
  });
}

export function translate(
  language: Language,
  key: MessageKey,
  values?: TranslationValues,
): string {
  const valgtMelding = getNestedMessage(messagesByLanguage[language], key);
  if (valgtMelding) {
    return interpolateMessage(valgtMelding, values);
  }

  const fallbackMelding = getNestedMessage(messagesByLanguage[DEFAULT_LANGUAGE], key);
  if (fallbackMelding) {
    return interpolateMessage(fallbackMelding, values);
  }

  return key;
}
