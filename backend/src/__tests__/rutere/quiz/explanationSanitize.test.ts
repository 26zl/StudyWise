/*
 * Tester for resolvePositionReferencesInExplanation.
 *
 * Målet er at forklaringsteksten skal være immun mot at backend shuffler
 * alternativene etter at LLM har generert dem. Vi konverterer posisjons-
 * baserte referanser ("alternativ B", "første alternativ", "option 3") til
 * den faktiske innholdsstrengen, slik at shufflen ikke bryter forklaringen.
 */

import { describe, it, expect } from "vitest";
import { resolvePositionReferencesInExplanation } from "../../../rutere/quiz/quiz.js";

const OPTIONS = ["Kvalitativ metode", "Kvantitativ metode", "Eksperiment", "Observasjon"];

describe("resolvePositionReferencesInExplanation", () => {
  it("resolver bokstavlabel 'alternativ B' til tilsvarende alternativtekst", () => {
    const { text, detected, changed } = resolvePositionReferencesInExplanation(
      "Riktig svar er alternativ B fordi det måler tallfestede data.",
      OPTIONS,
    );
    expect(detected).toBe(true);
    expect(changed).toBe(true);
    expect(text).toContain("«Kvantitativ metode»");
    expect(text).not.toMatch(/\balternativ\s+B\b/i);
  });

  it("resolver 'option C' (engelsk) til alternativ 3", () => {
    const { text, changed } = resolvePositionReferencesInExplanation(
      "The correct answer is option C.",
      OPTIONS,
    );
    expect(changed).toBe(true);
    expect(text).toContain("«Eksperiment»");
  });

  it("resolver ordinaler på norsk: 'første alternativ'", () => {
    const { text, changed } = resolvePositionReferencesInExplanation(
      "Første alternativ er feil fordi...",
      OPTIONS,
    );
    expect(changed).toBe(true);
    expect(text).toContain("«Kvalitativ metode»");
  });

  it("resolver ordinaler på engelsk: 'second option'", () => {
    const { text, changed } = resolvePositionReferencesInExplanation(
      "The second option is correct.",
      OPTIONS,
    );
    expect(changed).toBe(true);
    expect(text).toContain("«Kvantitativ metode»");
  });

  it("resolver numeriske referanser: 'svar 3'", () => {
    const { text, changed } = resolvePositionReferencesInExplanation(
      "Svar 3 beskriver en kontrollert undersøkelse.",
      OPTIONS,
    );
    expect(changed).toBe(true);
    expect(text).toContain("«Eksperiment»");
  });

  it("resolver indeks-referanser: 'indeks 0'", () => {
    const { text, changed } = resolvePositionReferencesInExplanation(
      "Indeks 0 er ikke riktig her.",
      OPTIONS,
    );
    expect(changed).toBe(true);
    expect(text).toContain("«Kvalitativ metode»");
  });

  it("håndterer flere referanser i samme forklaring", () => {
    const { text, changed } = resolvePositionReferencesInExplanation(
      "Alternativ A er delvis riktig, men alternativ D er bedre.",
      OPTIONS,
    );
    expect(changed).toBe(true);
    expect(text).toContain("«Kvalitativ metode»");
    expect(text).toContain("«Observasjon»");
  });

  it("lar tekst uten posisjonsreferanser stå uendret", () => {
    const original = "Dette skyldes at kvantitative studier gir målbare resultater.";
    const { text, detected, changed } = resolvePositionReferencesInExplanation(original, OPTIONS);
    expect(detected).toBe(false);
    expect(changed).toBe(false);
    expect(text).toBe(original);
  });

  it("beholder originalen hvis indeks er utenfor options.length", () => {
    const short = ["A-tekst", "B-tekst"];
    const { text, detected, changed } = resolvePositionReferencesInExplanation(
      "Alternativ D er riktig.",
      short,
    );
    // Detected (vi så labelen), men ikke changed (D (index 3) finnes ikke i short[])
    expect(detected).toBe(true);
    expect(changed).toBe(false);
    expect(text).toContain("Alternativ D");
  });

  it("håndterer tom forklaring trygt", () => {
    const { text, detected, changed } = resolvePositionReferencesInExplanation("", OPTIONS);
    expect(detected).toBe(false);
    expect(changed).toBe(false);
    expect(text).toBe("");
  });

  it("matcher case-insensitivt", () => {
    const { text, changed } = resolvePositionReferencesInExplanation(
      "ALTERNATIV b er riktig.",
      OPTIONS,
    );
    expect(changed).toBe(true);
    expect(text).toContain("«Kvantitativ metode»");
  });

  it("rører ikke ord som tilfeldigvis starter med 'alternativ'", () => {
    const original = "Det finnes alternative forklaringer på dette.";
    const { text, changed } = resolvePositionReferencesInExplanation(original, OPTIONS);
    expect(changed).toBe(false);
    expect(text).toBe(original);
  });
});
