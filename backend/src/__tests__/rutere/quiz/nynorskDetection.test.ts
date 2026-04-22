/*
 * Tester for detectNynorskMarkers.
 *
 * Deteksjon er et overvåkingsverktøy — vi oversetter ikke automatisk, men
 * vil fange opp når Claude ignorerer Bokmål-regelen og slipper gjennom
 * Nynorsk-output. Testene her sikrer at vi faktisk fanger typiske markører
 * uten å gi false positives på vanlig Bokmål-tekst.
 */

import { describe, it, expect } from "vitest";
import { detectNynorskMarkers } from "../../../rutere/quiz/quiz.js";

describe("detectNynorskMarkers", () => {
  it("detekterer 'kva' (Nynorsk for 'hva')", () => {
    const hits = detectNynorskMarkers(
      "Kva er den viktigaste skilnaden mellom metodene?",
    );
    expect(hits).toContain("Kva");
  });

  it("detekterer 'ikkje', 'berre', 'noko'", () => {
    const hits = detectNynorskMarkers(
      "Dette er ikkje rett svar — det er berre noko av forklaringa.",
    );
    expect(hits.map((h) => h.toLowerCase())).toEqual(
      expect.arrayContaining(["ikkje", "berre", "noko"]),
    );
  });

  it("detekterer 'korleis', 'kvifor' (Nynorsk spørreord)", () => {
    const hits = detectNynorskMarkers("Korleis og kvifor skjer dette?");
    expect(hits.map((h) => h.toLowerCase())).toEqual(
      expect.arrayContaining(["korleis", "kvifor"]),
    );
  });

  it("detekterer 'skilnad', 'viktigast' med ulike bøyninger", () => {
    const hits = detectNynorskMarkers(
      "Ein skilnad mellom dei viktigaste metodane",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.toLowerCase())).toEqual(
      expect.arrayContaining(["skilnad", "viktigaste"]),
    );
  });

  it("detekterer Nynorsk 'oppgåve' og 'førelesing'", () => {
    const hits = detectNynorskMarkers(
      "Oppgåva refererer til førelesinga fra veke 3",
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("gir ingen treff på rent Bokmål-tekst", () => {
    const hits = detectNynorskMarkers(
      "Hva er den viktigste forskjellen mellom kvalitativ og kvantitativ metode?",
    );
    expect(hits).toEqual([]);
  });

  it("gir ingen treff på engelsk tekst (e.g. er ikke 'eg')", () => {
    const hits = detectNynorskMarkers("What is the best method, e.g. SQL?");
    expect(hits).toEqual([]);
  });

  it("matcher case-insensitivt", () => {
    const hits = detectNynorskMarkers("KVA er svaret?");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("gir tomt resultat for tom streng", () => {
    expect(detectNynorskMarkers("")).toEqual([]);
  });
});
