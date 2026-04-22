/*
 * Tester for richness-promotion i full-document-mode.
 *
 * Bakgrunn: Canvas-sider blir ofte plukket som primærfil av rerank fordi
 * tittelen matcher eksakt (f.eks. "Leksjon 3 Grunnprinsipper..."), men selve
 * siden inneholder bare læringsmål — den faktiske pensum-PDFen ligger i en
 * annen fil i samme kurs (typisk indeksert av crawleren fra ekstern URL som
 * windowsnett.no). Helperen `pickRicherPrimaryCandidate` løser dette ved å
 * promotere den rikere filen når primæren er for tynn.
 */

import { describe, it, expect } from "vitest";
import {
  pickRicherPrimaryCandidate,
  MIN_RICH_PRIMARY_CHARS,
  RICHER_ALTERNATIVE_MULTIPLIER,
} from "../../services/context-loader.service.js";

function cand(charCount: number, label = `cand-${charCount}`) {
  return { charCount, label };
}

describe("pickRicherPrimaryCandidate", () => {
  it("returnerer null når primæren allerede er rik nok", () => {
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: MIN_RICH_PRIMARY_CHARS + 1,
      candidates: [cand(50_000)],
    });
    expect(result).toBeNull();
  });

  it("returnerer null når ingen kandidater finnes", () => {
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: 500,
      candidates: [],
    });
    expect(result).toBeNull();
  });

  it("promoterer den største kandidaten når primæren er en tynn wrapper", () => {
    // Scenario fra den ekte buggen: Canvas-side (1735 tegn) som primær,
    // ekstern PDF (30 chunks ≈ 15 000 tegn) som kandidat.
    const canvasPage = 1735;
    const externalPdf = cand(15_000, "Leksjon3.pdf");
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: canvasPage,
      candidates: [externalPdf],
    });
    expect(result).toBe(externalPdf);
  });

  it("velger den RIKESTE kandidaten når flere kvalifiserer", () => {
    const a = cand(5_000, "a");
    const b = cand(20_000, "b");
    const c = cand(10_000, "c");
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: 800,
      candidates: [a, b, c],
    });
    expect(result).toBe(b);
  });

  it("avviser kandidater som ikke er tilstrekkelig større enn primæren", () => {
    // Primær 1500, kandidat 3000 — kun 2× større, under terskelen på 3×.
    const borderline = cand(3_000, "borderline");
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: 1500,
      candidates: [borderline],
    });
    expect(result).toBeNull();
  });

  it("avviser kandidat som er større men fortsatt under MIN_RICH-terskelen", () => {
    // Primær 100 tegn, kandidat 500 tegn. 5× større, men 500 < MIN_RICH.
    // Begge er "tynne" — ingen promotering fordi ingen kandidat er reelt rik.
    const alsoThin = cand(500, "alsoThin");
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: 100,
      candidates: [alsoThin],
    });
    expect(result).toBeNull();
  });

  it("respekterer tilpassede terskelparametre", () => {
    // Strammere krav: 5× større, og minst 10k tegn
    const candidate = cand(8_000);
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: 1500,
      candidates: [candidate],
      minRichChars: 10_000,
      richnessMultiplier: 5,
    });
    // 8k > 1.5k*5=7.5k men 8k < 10k → ikke kvalifisert
    expect(result).toBeNull();
  });

  it("håndterer lik charCount mellom flere kandidater deterministisk", () => {
    // To kandidater med lik størrelse — velger den første funnet.
    const first = cand(20_000, "first");
    const second = cand(20_000, "second");
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: 1000,
      candidates: [first, second],
    });
    expect(result).toBe(first);
  });

  it("hardkodet scenario: Canvas Page + windowsnett.no PDF for Leksjon 3", () => {
    // Eksakt fra loggen: fileId 732330 hadde 1735 tegn (Canvas-siden)
    // og crawleren indekserte en ekstern PDF med ~30 chunks (≈15-30k tegn).
    const canvasWrapperChars = 1735;
    const externalPdf = cand(28_000, "leksjon3_pensum.pdf");
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: canvasWrapperChars,
      candidates: [externalPdf],
    });
    expect(result).toBe(externalPdf);
    // Sanity: kravet er oppfylt
    expect(externalPdf.charCount).toBeGreaterThan(
      canvasWrapperChars * RICHER_ALTERNATIVE_MULTIPLIER,
    );
    expect(externalPdf.charCount).toBeGreaterThanOrEqual(MIN_RICH_PRIMARY_CHARS);
  });

  it("scenario som IKKE skal promoteres: tematisk ubeslektet alternativ", () => {
    // Selve pickRicherPrimaryCandidate har ingen semantisk logikk — den
    // velger alltid størst. Vern mot over-promotering må skje i kalleren
    // (sjekke primarySelection.overridden + catalogOverrideApplied før
    // funksjonen kalles). Denne testen dokumenterer at helperen IKKE
    // beskytter mot dette alene, så kalleren MÅ gate innkallingen.
    const canvasPage = 481; // "2. Kunstig intelligens og fusk.page"
    const unrelatedDocx = cand(29_381, "Eksempel+oblig+kommentert.docx");
    const result = pickRicherPrimaryCandidate({
      primaryCharCount: canvasPage,
      candidates: [unrelatedDocx],
    });
    // Helperen returnerer candidate — men i byggKontekstFraHybridSearch
    // skal vi ikke KALLE helperen når katalog-skanneren allerede har gjort
    // et bevisst valg. Dette testes som ren dokumentasjon av ansvarsdelingen.
    expect(result).toBe(unrelatedDocx);
  });
});
