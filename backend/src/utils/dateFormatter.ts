/**
 * Dato-formateringsverktøy for backend (norsk bokmål).
 * Sentraliserer dato-formatering for context-loader og andre tjenester.
 */

/** Normaliserer filnavn for fuzzy-matching: lowercases, fjerner .pdf, erstatter _ og - med mellomrom. */
export function normaliserFilnavnHint(value: string): string {
  return value.toLowerCase().replace(/\.pdf$/i, "").replace(/[_-]/g, " ").trim();
}
