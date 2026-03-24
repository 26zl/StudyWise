/**
 * Dato-formateringsverktøy for backend (norsk bokmål).
 * Sentraliserer dato-formatering som tidligere var duplisert i kiCanvas.ts og context-loader.
 */

import { getWeekNumber } from "common/dateUtils";

export const DAG_NAVN = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
export const MÅNED_NAVN = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

/** Formaterer ISO-streng til «dd.mm.yyyy kl. HH:MM» (Europe/Oslo). */
export function formaterDatoMedTid(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  const dato = d.toLocaleDateString("no-NO", { timeZone: "Europe/Oslo" });
  const tid = d.toLocaleTimeString("no-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit" });
  return `${dato} kl. ${tid}`;
}

/** Returnerer dagens dato som «mandag 24. mars 2026», evt. med ukenummer. */
export function dagensDatoStreng(includeWeek = false): string {
  const idag = new Date();
  const base = `${DAG_NAVN[idag.getDay()]} ${idag.getDate()}. ${MÅNED_NAVN[idag.getMonth()]} ${idag.getFullYear()}`;
  return includeWeek ? `${base} (uke ${getWeekNumber(idag)})` : base;
}

/** Normaliserer filnavn for fuzzy-matching: lowercases, fjerner .pdf, erstatter _ og - med mellomrom. */
export function normaliserFilnavnHint(value: string): string {
  return value.toLowerCase().replace(/\.pdf$/i, "").replace(/[_-]/g, " ").trim();
}
