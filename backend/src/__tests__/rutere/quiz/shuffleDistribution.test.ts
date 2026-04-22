/*
 * Distribusjonstest for shuffleQuizOptions.
 *
 * Bakgrunn: bruker rapporterte at riktig-alternativet ofte landet på posisjon
 * 1 eller 4 (indeks 0 eller 3) selv etter shuffle. Vi verifiserer her at
 * Fisher-Yates faktisk produserer uniform fordeling — hvis testen passerer
 * og bruker fortsatt ser skjevhet, ligger årsaken utenfor selve shufflen
 * (f.eks. stale build, cache, eller LLM-bias som overføres uforandret).
 */

import { describe, it, expect } from "vitest";
import { shuffleQuizOptions } from "../../../rutere/quiz/quiz.js";

const OPTIONS = ["A", "B", "C", "D"];

function buildQuestion(correctIndex: number) {
  return {
    question: "Test",
    options: [...OPTIONS],
    correctIndex,
    explanation: "test",
  };
}

describe("shuffleQuizOptions — distribusjon", () => {
  it("produserer uniform fordeling av correctIndex (startpos 0)", () => {
    const iterations = 10_000;
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < iterations; i++) {
      const shuffled = shuffleQuizOptions(buildQuestion(0));
      counts[shuffled.correctIndex]++;
    }
    // Chi-square-agtig sanity-check: hver bucket skal være innenfor 10 %
    // av forventet verdi (iterations / 4). Med 10k iterasjoner er std dev
    // veldig lav, så 10 % er romslig.
    const expected = iterations / 4;
    for (const count of counts) {
      expect(count).toBeGreaterThan(expected * 0.9);
      expect(count).toBeLessThan(expected * 1.1);
    }
  });

  it("produserer uniform fordeling uavhengig av start-correctIndex", () => {
    const iterations = 5_000;
    for (const startIndex of [0, 1, 2, 3]) {
      const counts = [0, 0, 0, 0];
      for (let i = 0; i < iterations; i++) {
        const shuffled = shuffleQuizOptions(buildQuestion(startIndex));
        counts[shuffled.correctIndex]++;
      }
      const expected = iterations / 4;
      for (const count of counts) {
        expect(count).toBeGreaterThan(expected * 0.85);
        expect(count).toBeLessThan(expected * 1.15);
      }
    }
  });

  it("bevarer riktig alternativ-tekst etter shuffle", () => {
    for (let i = 0; i < 100; i++) {
      const original = buildQuestion(1);
      const shuffled = shuffleQuizOptions(original);
      expect(shuffled.options[shuffled.correctIndex]).toBe(OPTIONS[1]);
    }
  });

  it("gir reproduserbart resultat med seeded random (mulig å debugge)", () => {
    let seed = 0.42;
    const mockRandom = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    const a = shuffleQuizOptions(buildQuestion(0), mockRandom);
    seed = 0.42;
    const b = shuffleQuizOptions(buildQuestion(0), mockRandom);
    expect(a.correctIndex).toBe(b.correctIndex);
    expect(a.options).toEqual(b.options);
  });
});
