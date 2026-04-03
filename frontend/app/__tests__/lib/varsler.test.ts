// Tester for varsler-logikk (frist-klassifisering, tidsformatering, forhåndsvisning)

import { describe, it, expect } from "vitest";
import {
  FRIST_VINDU_DAGER,
  FRIST_KRITISK_TIMER,
  FRIST_SNART_TIMER,
  klassifiserFrist,
  erInnenforFristVindu,
  formaterTid,
  lagVarslingForhandsvisning,
} from "@/app/lib/varsler";

describe("konstanter", () => {
  it("FRIST_VINDU_DAGER er 7", () => {
    expect(FRIST_VINDU_DAGER).toBe(7);
  });

  it("FRIST_KRITISK_TIMER er 24", () => {
    expect(FRIST_KRITISK_TIMER).toBe(24);
  });

  it("FRIST_SNART_TIMER er 48", () => {
    expect(FRIST_SNART_TIMER).toBe(48);
  });
});

describe("klassifiserFrist", () => {
  it("returnerer 'kritisk' for under 24 timer", () => {
    expect(klassifiserFrist(0)).toBe("kritisk");
    expect(klassifiserFrist(1)).toBe("kritisk");
    expect(klassifiserFrist(12)).toBe("kritisk");
    expect(klassifiserFrist(23)).toBe("kritisk");
    expect(klassifiserFrist(23.9)).toBe("kritisk");
  });

  it("returnerer 'kritisk' for negative timer (forfalt)", () => {
    expect(klassifiserFrist(-1)).toBe("kritisk");
    expect(klassifiserFrist(-48)).toBe("kritisk");
  });

  it("returnerer 'snart' for 24-47 timer", () => {
    expect(klassifiserFrist(24)).toBe("snart");
    expect(klassifiserFrist(36)).toBe("snart");
    expect(klassifiserFrist(47)).toBe("snart");
    expect(klassifiserFrist(47.9)).toBe("snart");
  });

  it("returnerer 'kommende' for 48+ timer", () => {
    expect(klassifiserFrist(48)).toBe("kommende");
    expect(klassifiserFrist(72)).toBe("kommende");
    expect(klassifiserFrist(168)).toBe("kommende");
  });

  it("grenseverdier: nøyaktig 24 og 48", () => {
    expect(klassifiserFrist(24)).toBe("snart");
    expect(klassifiserFrist(48)).toBe("kommende");
  });
});

describe("erInnenforFristVindu", () => {
  const NÅ = new Date("2025-06-15T12:00:00Z").getTime();

  it("returnerer true for dato innenfor 7 dager", () => {
    const dato = new Date("2025-06-18T12:00:00Z");
    expect(erInnenforFristVindu(dato, NÅ)).toBe(true);
  });

  it("returnerer true for dato om noen timer", () => {
    const dato = new Date("2025-06-15T18:00:00Z");
    expect(erInnenforFristVindu(dato, NÅ)).toBe(true);
  });

  it("returnerer false for dato i fortiden", () => {
    const dato = new Date("2025-06-14T12:00:00Z");
    expect(erInnenforFristVindu(dato, NÅ)).toBe(false);
  });

  it("returnerer false for dato langt i fremtiden (>7 dager)", () => {
    const dato = new Date("2025-07-01T12:00:00Z");
    expect(erInnenforFristVindu(dato, NÅ)).toBe(false);
  });

  it("returnerer false for null", () => {
    expect(erInnenforFristVindu(null, NÅ)).toBe(false);
  });

  it("returnerer false for undefined", () => {
    expect(erInnenforFristVindu(undefined, NÅ)).toBe(false);
  });

  it("godtar streng-dato", () => {
    expect(erInnenforFristVindu("2025-06-17T12:00:00Z", NÅ)).toBe(true);
  });

  it("grenseverdi: nøyaktig 7 dager (168 timer) er innenfor", () => {
    const dato = new Date(NÅ + 168 * 60 * 60 * 1000);
    expect(erInnenforFristVindu(dato, NÅ)).toBe(true);
  });

  it("grenseverdi: over 168 timer er utenfor", () => {
    const dato = new Date(NÅ + 169 * 60 * 60 * 1000);
    expect(erInnenforFristVindu(dato, NÅ)).toBe(false);
  });

  it("grenseverdi: nøyaktig nå er ikke innenfor (timer = 0)", () => {
    const dato = new Date(NÅ);
    expect(erInnenforFristVindu(dato, NÅ)).toBe(false);
  });
});

describe("formaterTid", () => {
  describe("norsk (nb)", () => {
    it("formaterer under 1 time", () => {
      expect(formaterTid(0.5, "nb")).toBe("under 1 time");
    });

    it("formaterer 1 time (avrundet)", () => {
      expect(formaterTid(1, "nb")).toBe("1 timer");
    });

    it("formaterer flere timer", () => {
      expect(formaterTid(5, "nb")).toBe("5 timer");
    });

    it("formaterer 23 timer", () => {
      expect(formaterTid(23, "nb")).toBe("23 timer");
    });

    it("formaterer 1 dag uten resttimer", () => {
      expect(formaterTid(24, "nb")).toBe("1 dag");
    });

    it("formaterer 1 dag med resttimer", () => {
      expect(formaterTid(26, "nb")).toBe("1 dag og 2 timer");
    });

    it("formaterer flere dager", () => {
      expect(formaterTid(72, "nb")).toBe("3 dager");
    });

    it("formaterer flere dager med resttimer", () => {
      expect(formaterTid(50, "nb")).toBe("2 dager og 2 timer");
    });

    it("bruker norsk som standard", () => {
      expect(formaterTid(0.5)).toBe("under 1 time");
    });
  });

  describe("engelsk (en)", () => {
    it("formaterer under 1 time", () => {
      expect(formaterTid(0.5, "en")).toBe("under 1 hour");
    });

    it("formaterer 1 time", () => {
      expect(formaterTid(1, "en")).toBe("1 hour");
    });

    it("formaterer flere timer", () => {
      expect(formaterTid(5, "en")).toBe("5 hours");
    });

    it("formaterer 1 dag uten resttimer", () => {
      expect(formaterTid(24, "en")).toBe("1 day");
    });

    it("formaterer 1 dag og 1 time", () => {
      expect(formaterTid(25, "en")).toBe("1 day and 1 hour");
    });

    it("formaterer 1 dag og flere timer", () => {
      expect(formaterTid(26, "en")).toBe("1 day and 2 hours");
    });

    it("formaterer flere dager", () => {
      expect(formaterTid(72, "en")).toBe("3 days");
    });

    it("formaterer flere dager og 1 time", () => {
      expect(formaterTid(49, "en")).toBe("2 days and 1 hour");
    });

    it("formaterer flere dager og flere timer", () => {
      expect(formaterTid(50, "en")).toBe("2 days and 2 hours");
    });
  });

  describe("grenseverdier", () => {
    it("timer lik 0 er under 1 time", () => {
      expect(formaterTid(0, "nb")).toBe("under 1 time");
      expect(formaterTid(0, "en")).toBe("under 1 hour");
    });

    it("timer lik 0.99 er under 1 time", () => {
      expect(formaterTid(0.99, "nb")).toBe("under 1 time");
      expect(formaterTid(0.99, "en")).toBe("under 1 hour");
    });
  });
});

describe("lagVarslingForhandsvisning", () => {
  it("returnerer tom streng for null", () => {
    expect(lagVarslingForhandsvisning(null)).toBe("");
  });

  it("returnerer tom streng for undefined", () => {
    expect(lagVarslingForhandsvisning(undefined)).toBe("");
  });

  it("returnerer tom streng for tom streng", () => {
    expect(lagVarslingForhandsvisning("")).toBe("");
  });

  it("returnerer kort tekst uendret", () => {
    expect(lagVarslingForhandsvisning("Kort melding")).toBe("Kort melding");
  });

  it("trunkerer lang tekst med ellipsis", () => {
    const langTekst = "a".repeat(300);
    const resultat = lagVarslingForhandsvisning(langTekst);
    expect(resultat.length).toBeLessThanOrEqual(220);
    expect(resultat.endsWith("…")).toBe(true);
  });

  it("bruker egendefinert maxLengde", () => {
    const tekst = "a".repeat(100);
    const resultat = lagVarslingForhandsvisning(tekst, 50);
    expect(resultat.length).toBeLessThanOrEqual(50);
    expect(resultat.endsWith("…")).toBe(true);
  });

  it("fjerner HTML-tagger", () => {
    const html = "<p>Viktig <strong>melding</strong></p>";
    const resultat = lagVarslingForhandsvisning(html);
    expect(resultat).not.toContain("<");
    expect(resultat).not.toContain(">");
    expect(resultat).toContain("Viktig");
    expect(resultat).toContain("melding");
  });

  it("erstatter &nbsp; med mellomrom", () => {
    const html = "Ord&nbsp;nummer&nbsp;to";
    const resultat = lagVarslingForhandsvisning(html);
    expect(resultat).toContain("Ord nummer to");
  });

  it("kollapser ekstra mellomrom", () => {
    const tekst = "Mye    mellomrom    her";
    const resultat = lagVarslingForhandsvisning(tekst);
    expect(resultat).toBe("Mye mellomrom her");
  });

  it("trimmer whitespace", () => {
    const tekst = "   Tekst med ekstra mellomrom   ";
    const resultat = lagVarslingForhandsvisning(tekst);
    expect(resultat).toBe("Tekst med ekstra mellomrom");
  });

  it("returnerer tekst lik maxLengde uten trunkering", () => {
    const tekst = "a".repeat(220);
    const resultat = lagVarslingForhandsvisning(tekst, 220);
    expect(resultat).toBe(tekst);
    expect(resultat.endsWith("…")).toBe(false);
  });
});
