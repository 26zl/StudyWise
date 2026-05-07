/*
 * Tester for enforceSvarKilde — server-side validering av <svarkilde>-tag mot
 * faktisk injisert kontekst (mot prompt-injection som overstyrer modellens emisjon).
 */

import { describe, it, expect } from "vitest";
import { enforceSvarKilde } from "../../../rutere/ki/aiClient.js";

const NO_CONTEXT = {
  harKursmateriale: false,
  harKunnskapsbase: false,
  harCanvasMetadata: false,
  harLiveUrl: false,
};

describe("enforceSvarKilde", () => {
  describe("ingen kontekst injisert", () => {
    it("tvinger 'generell' når modell hevder 'kursmateriale'", () => {
      expect(enforceSvarKilde("kursmateriale", NO_CONTEXT)).toBe("generell");
    });

    it("tvinger 'generell' når modell hevder 'kunnskapsbase'", () => {
      expect(enforceSvarKilde("kunnskapsbase", NO_CONTEXT)).toBe("generell");
    });

    it("tvinger 'generell' når modell hevder 'canvas'", () => {
      expect(enforceSvarKilde("canvas", NO_CONTEXT)).toBe("generell");
    });

    it("tvinger 'generell' når modell hevder 'blandet'", () => {
      expect(enforceSvarKilde("blandet", NO_CONTEXT)).toBe("generell");
    });

    it("returnerer 'generell' også uten modell-emittert verdi", () => {
      expect(enforceSvarKilde(undefined, NO_CONTEXT)).toBe("generell");
    });
  });

  describe("modell hevder 'kursmateriale' uten PDF-innhold", () => {
    it("degraderer til 'kunnskapsbase' når KB er injisert", () => {
      expect(
        enforceSvarKilde("kursmateriale", {
          ...NO_CONTEXT,
          harKunnskapsbase: true,
        }),
      ).toBe("kunnskapsbase");
    });

    it("degraderer til 'canvas' når kun Canvas-metadata er injisert", () => {
      expect(
        enforceSvarKilde("kursmateriale", {
          ...NO_CONTEXT,
          harCanvasMetadata: true,
        }),
      ).toBe("canvas");
    });

    it("degraderer til 'kunnskapsbase' når live URL er hentet", () => {
      expect(
        enforceSvarKilde("kursmateriale", {
          ...NO_CONTEXT,
          harLiveUrl: true,
        }),
      ).toBe("kunnskapsbase");
    });
  });

  describe("modell hevder 'kursmateriale' med PDF-innhold", () => {
    it("beholder 'kursmateriale' når PDF-innhold faktisk er injisert", () => {
      expect(
        enforceSvarKilde("kursmateriale", {
          ...NO_CONTEXT,
          harKursmateriale: true,
        }),
      ).toBe("kursmateriale");
    });
  });

  describe("modell hevder 'kunnskapsbase' uten KB", () => {
    it("degraderer til 'kursmateriale' når PDF-innhold er injisert", () => {
      expect(
        enforceSvarKilde("kunnskapsbase", {
          ...NO_CONTEXT,
          harKursmateriale: true,
        }),
      ).toBe("kursmateriale");
    });

    it("degraderer til 'canvas' når kun Canvas-metadata er injisert", () => {
      expect(
        enforceSvarKilde("kunnskapsbase", {
          ...NO_CONTEXT,
          harCanvasMetadata: true,
        }),
      ).toBe("canvas");
    });

    it("aksepterer 'kunnskapsbase' når live URL er hentet", () => {
      expect(
        enforceSvarKilde("kunnskapsbase", {
          ...NO_CONTEXT,
          harLiveUrl: true,
        }),
      ).toBe("kunnskapsbase");
    });
  });

  describe("modell hevder 'canvas' uten Canvas-kontekst", () => {
    it("degraderer til 'kunnskapsbase' når kun KB er injisert", () => {
      expect(
        enforceSvarKilde("canvas", {
          ...NO_CONTEXT,
          harKunnskapsbase: true,
        }),
      ).toBe("kunnskapsbase");
    });

    it("aksepterer 'canvas' når Canvas-metadata er injisert", () => {
      expect(
        enforceSvarKilde("canvas", {
          ...NO_CONTEXT,
          harCanvasMetadata: true,
        }),
      ).toBe("canvas");
    });

    it("aksepterer 'canvas' når PDF-innhold (kursmateriale) er injisert", () => {
      expect(
        enforceSvarKilde("canvas", {
          ...NO_CONTEXT,
          harKursmateriale: true,
        }),
      ).toBe("canvas");
    });
  });

  describe("modell hevder 'blandet'", () => {
    it("aksepterer 'blandet' når 2 ulike kildetyper er injisert", () => {
      expect(
        enforceSvarKilde("blandet", {
          ...NO_CONTEXT,
          harKursmateriale: true,
          harCanvasMetadata: true,
        }),
      ).toBe("blandet");
    });

    it("aksepterer 'blandet' når 3 kildetyper er injisert", () => {
      expect(
        enforceSvarKilde("blandet", {
          harKursmateriale: true,
          harKunnskapsbase: true,
          harCanvasMetadata: true,
          harLiveUrl: false,
        }),
      ).toBe("blandet");
    });

    it("degraderer 'blandet' til 'kursmateriale' når kun PDF er injisert", () => {
      expect(
        enforceSvarKilde("blandet", {
          ...NO_CONTEXT,
          harKursmateriale: true,
        }),
      ).toBe("kursmateriale");
    });

    it("degraderer 'blandet' til 'kunnskapsbase' når kun KB er injisert", () => {
      expect(
        enforceSvarKilde("blandet", {
          ...NO_CONTEXT,
          harKunnskapsbase: true,
        }),
      ).toBe("kunnskapsbase");
    });

    it("degraderer 'blandet' til 'canvas' når kun Canvas-metadata er injisert", () => {
      expect(
        enforceSvarKilde("blandet", {
          ...NO_CONTEXT,
          harCanvasMetadata: true,
        }),
      ).toBe("canvas");
    });
  });

  describe("modell hevder 'generell'", () => {
    it("beholder 'generell' uavhengig av kontekst", () => {
      expect(
        enforceSvarKilde("generell", {
          harKursmateriale: true,
          harKunnskapsbase: true,
          harCanvasMetadata: true,
          harLiveUrl: true,
        }),
      ).toBe("generell");
    });
  });

  describe("F-34c regresjons-scenario", () => {
    it("blokkerer prompt-injection som tvinger 'kursmateriale' uten PDF-innhold", () => {
      // PI-3 fra pentestrapport: bruker ber modellen sette
      // <svarkilde>kursmateriale</svarkilde> selv om svaret er fra generell
      // kunnskap. Backend skal degradere fordi ingen PDF-innhold er injisert.
      const result = enforceSvarKilde("kursmateriale", NO_CONTEXT);
      expect(result).toBe("generell");
    });
  });
});
