/**
 * Felles hjelpefunksjoner for KI-ruter som jobber med studieinnhold.
 *
 * Typisk bruk: ekstraktere JSON fra modell-svar og bygge "targeted query" hints
 * for kurs/modul/fil.
 */
import type { TargetedQuery } from "./ki.js";

/**
 * Ekstraherer en JSON-array fra et modell-svar.
 *
 * Kaster `AI_RESPONSE_NOT_JSON_ARRAY` hvis teksten ikke inneholder en gyldig `[...]`-seksjon.
 */
export function extractJsonArray(text: string): string {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("AI_RESPONSE_NOT_JSON_ARRAY");
  }
  return cleaned.slice(start, end + 1);
}

/**
 * Ekstraherer et JSON-objekt fra et modell-svar.
 *
 * Kaster `AI_RESPONSE_NOT_JSON_OBJECT` hvis teksten ikke inneholder en gyldig `{...}`-seksjon.
 */
export function extractJsonObject(text: string): string {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("AI_RESPONSE_NOT_JSON_OBJECT");
  }
  return cleaned.slice(start, end + 1);
}

/**
 * Lager et TargetedQuery-hint for et bestemt kurs.
 * Brukes for å styre KI-søk/kontekst til riktig kurs/modul.
 */
export function createCourseTargetedQuery(
  courseId: number,
  courseName: string,
  moduleNames: string[],
  fileNames: string[] = [],
): TargetedQuery {
  const allNames = [...moduleNames, ...fileNames];
  return {
    courseIdHint: courseId,
    courseHint: courseName,
    // Bruk null når flere moduler er valgt — lar hybrid søk finne innhold på tvers av alle moduler
    // uten å filtrere bort resultater fra andre moduler enn den første.
    // Søkequeryen inneholder allerede alle modulnavn, som gir BM25/semantisk matching.
    moduleHint: moduleNames.length === 1 ? moduleNames[0] : null,
    fileHint: fileNames.length === 1 ? fileNames[0] : null,
    chunkHint: allNames.join(", "),
  };
}
