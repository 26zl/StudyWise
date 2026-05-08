import { describe, expect, it } from "vitest";
import {
  hasStrongLexicalMatchForHybridResults,
  hasExplicitCanvasContextSignal,
  isWeakVectorOnlyHybridContext,
  modulTitleMatcherHint,
} from "../../services/context-loader.service.js";

describe("modulTitleMatcherHint", () => {
  it("matcher nummerert leksjon mot romertallsmodul", () => {
    expect(
      modulTitleMatcherHint(
        "I. Introduksjon til Windows Server og datanett",
        "leksjon 1",
      ),
    ).toBe(true);
  });

  it("matcher ikke feil romertallsmodul for nummerert leksjon", () => {
    expect(
      modulTitleMatcherHint(
        "II. Nettverk, tjenester og protokoller",
        "leksjon 1",
      ),
    ).toBe(false);
  });

  it("lar ikke oppgave-hint matche romertallsmodul bare på nummer", () => {
    expect(
      modulTitleMatcherHint(
        "I. Introduksjon til Windows Server og datanett",
        "oppgave 1",
      ),
    ).toBe(false);
  });
});

describe("implicit canvas-light guard", () => {
  it("behandler generelle spørsmål uten Canvas-signal som implicit", () => {
    expect(
      hasExplicitCanvasContextSignal("Hvem var fagpersonen?", {
        courseIdHint: 1,
        courseHint: "TEST101",
        moduleHint: null,
        fileHint: null,
        chunkHint: "fagpersonen",
      }),
    ).toBe(false);
  });

  it("beholder eksplisitte Canvas-signaler", () => {
    expect(
      hasExplicitCanvasContextSignal("Kan du forklare leksjon 2 også?", {
        courseIdHint: 2,
        courseHint: "TEST102",
        moduleHint: "leksjon 2",
        fileHint: null,
        chunkHint: "leksjon 2 også",
      }),
    ).toBe(true);
  });

  it("droppes kun når hybridtreffet er svakt og bare vektorbasert", () => {
    expect(
      isWeakVectorOnlyHybridContext({
        retrievalSources: { vector: true, bm25: false, reranked: true },
        topScore: 0.219,
        fullDocumentMode: false,
      }),
    ).toBe(true);

    expect(
      isWeakVectorOnlyHybridContext({
        retrievalSources: { vector: true, bm25: true, reranked: true },
        topScore: 0.219,
        fullDocumentMode: false,
      }),
    ).toBe(false);

    expect(
      isWeakVectorOnlyHybridContext({
        retrievalSources: { vector: true, bm25: false, reranked: true },
        topScore: 0.7,
        fullDocumentMode: false,
      }),
    ).toBe(false);
  });

  it("beholder svake vektortreff når query faktisk finnes i kilden", () => {
    const hasLexicalMatch = hasStrongLexicalMatchForHybridResults("Hva er fagbegrep?", [
      {
        text: "Fagbegrep er forklart i notatet.",
        score: 0.21,
        source: {
          courseId: "42",
          courseName: "Testemne",
          moduleTitle: "Begreper",
          fileName: "fagbegrep-notater.pdf",
          fileId: 1001,
        },
        chunkIndex: 0,
      },
    ]);

    expect(hasLexicalMatch).toBe(true);
    expect(
      isWeakVectorOnlyHybridContext({
        retrievalSources: { vector: true, bm25: false, reranked: true },
        topScore: 0.21,
        fullDocumentMode: false,
        hasLexicalMatch,
      }),
    ).toBe(false);
  });
});
