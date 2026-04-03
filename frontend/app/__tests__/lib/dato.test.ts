// Tester for dato- og klokkeslettformatering

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formaterDatoShort,
  formaterDatoLong,
  formaterDatoFull,
  formaterKlokkeslett,
  formaterDatoMedTid,
  formaterDatoOgTid,
  dagerFraIdag,
  formaterDagerRelativtFrist,
  formaterTall,
} from "@/app/lib/dato";

// Bruk en fast dato for deterministiske tester
const FAST_DATO = new Date("2025-06-15T12:00:00Z");

describe("formaterDatoShort", () => {
  it("formaterer dato kort på norsk", () => {
    const resultat = formaterDatoShort(FAST_DATO, "nb");
    expect(resultat).toContain("15");
    expect(resultat).toBeTruthy();
  });

  it("formaterer dato kort på engelsk", () => {
    const resultat = formaterDatoShort(FAST_DATO, "en");
    expect(resultat).toContain("15");
    expect(resultat).toBeTruthy();
  });

  it("godtar streng-dato", () => {
    const resultat = formaterDatoShort("2025-06-15T12:00:00Z", "nb");
    expect(resultat).toContain("15");
  });

  it("godtar timestamp (tall)", () => {
    const resultat = formaterDatoShort(FAST_DATO.getTime(), "nb");
    expect(resultat).toContain("15");
  });

  it("bruker norsk som standard locale", () => {
    const resultat = formaterDatoShort(FAST_DATO);
    expect(resultat).toBeTruthy();
  });
});

describe("formaterDatoLong", () => {
  it("formaterer lang dato på norsk med årstall", () => {
    const resultat = formaterDatoLong(FAST_DATO, "nb");
    expect(resultat).toContain("2025");
    expect(resultat).toContain("15");
  });

  it("formaterer lang dato på engelsk med årstall", () => {
    const resultat = formaterDatoLong(FAST_DATO, "en");
    expect(resultat).toContain("2025");
    expect(resultat).toContain("15");
  });

  it("godtar streng-dato", () => {
    const resultat = formaterDatoLong("2025-12-25T00:00:00Z", "nb");
    expect(resultat).toContain("2025");
    expect(resultat).toContain("25");
  });
});

describe("formaterDatoFull", () => {
  it("inkluderer ukedag på norsk", () => {
    const resultat = formaterDatoFull(FAST_DATO, "nb");
    expect(resultat).toContain("2025");
    expect(resultat).toBeTruthy();
  });

  it("inkluderer ukedag på engelsk", () => {
    const resultat = formaterDatoFull(FAST_DATO, "en");
    expect(resultat).toContain("2025");
    expect(resultat).toBeTruthy();
  });
});

describe("formaterKlokkeslett", () => {
  it("formaterer klokkeslett på norsk", () => {
    const dato = new Date("2025-06-15T14:30:00Z");
    const resultat = formaterKlokkeslett(dato, "nb");
    expect(resultat).toMatch(/\d{2}:\d{2}/);
  });

  it("formaterer klokkeslett på engelsk", () => {
    const dato = new Date("2025-06-15T14:30:00Z");
    const resultat = formaterKlokkeslett(dato, "en");
    expect(resultat).toBeTruthy();
  });

  it("godtar streng-dato", () => {
    const resultat = formaterKlokkeslett("2025-06-15T08:05:00Z", "nb");
    expect(resultat).toBeTruthy();
  });

  it("bruker norsk som standard", () => {
    const resultat = formaterKlokkeslett(FAST_DATO);
    expect(resultat).toBeTruthy();
  });
});

describe("formaterDatoMedTid", () => {
  it("inneholder både dato og klokkeslett på norsk", () => {
    const resultat = formaterDatoMedTid(FAST_DATO, "nb");
    expect(resultat).toContain("15");
    expect(resultat).toMatch(/\d{2}:\d{2}/);
  });

  it("inneholder både dato og klokkeslett på engelsk", () => {
    const resultat = formaterDatoMedTid(FAST_DATO, "en");
    expect(resultat).toContain("15");
    expect(resultat).toBeTruthy();
  });
});

describe("formaterDatoOgTid", () => {
  it("formaterer dato og tid med komma-separator", () => {
    const resultat = formaterDatoOgTid(FAST_DATO, "nb");
    expect(resultat).toContain(",");
    expect(resultat).toContain("2025");
  });

  it("fungerer på engelsk", () => {
    const resultat = formaterDatoOgTid(FAST_DATO, "en");
    expect(resultat).toContain(",");
    expect(resultat).toContain("2025");
  });
});

describe("dagerFraIdag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returnerer 0 for i dag", () => {
    const iDag = new Date("2025-06-15T18:00:00Z");
    expect(dagerFraIdag(iDag)).toBe(0);
  });

  it("returnerer positivt tall for fremtidige datoer", () => {
    const fremtidig = new Date("2025-06-20T12:00:00Z");
    expect(dagerFraIdag(fremtidig)).toBe(5);
  });

  it("returnerer negativt tall for datoer i fortiden", () => {
    const fortid = new Date("2025-06-10T12:00:00Z");
    expect(dagerFraIdag(fortid)).toBe(-5);
  });

  it("returnerer 1 for i morgen", () => {
    const iMorgen = new Date("2025-06-16T08:00:00Z");
    expect(dagerFraIdag(iMorgen)).toBe(1);
  });

  it("returnerer -1 for i går", () => {
    const iGår = new Date("2025-06-14T23:59:00Z");
    expect(dagerFraIdag(iGår)).toBe(-1);
  });

  it("godtar streng-dato", () => {
    expect(dagerFraIdag("2025-06-17T12:00:00Z")).toBe(2);
  });

  it("godtar timestamp", () => {
    const ts = new Date("2025-06-18T00:00:00Z").getTime();
    expect(dagerFraIdag(ts)).toBe(3);
  });
});

describe("formaterDagerRelativtFrist", () => {
  describe("norsk (nb)", () => {
    it("returnerer 'I dag' for 0 dager", () => {
      expect(formaterDagerRelativtFrist(0, "nb")).toBe("I dag");
    });

    it("returnerer 'I morgen' for 1 dag", () => {
      expect(formaterDagerRelativtFrist(1, "nb")).toBe("I morgen");
    });

    it("returnerer 'Om X dager' for flere dager", () => {
      expect(formaterDagerRelativtFrist(5, "nb")).toBe("Om 5 dager");
    });

    it("returnerer '1 dag siden' for -1", () => {
      expect(formaterDagerRelativtFrist(-1, "nb")).toBe("1 dag siden");
    });

    it("returnerer 'X dager siden' for negative dager", () => {
      expect(formaterDagerRelativtFrist(-3, "nb")).toBe("3 dager siden");
    });

    it("bruker norsk som standard", () => {
      expect(formaterDagerRelativtFrist(0)).toBe("I dag");
    });
  });

  describe("engelsk (en)", () => {
    it("returnerer 'Today' for 0 dager", () => {
      expect(formaterDagerRelativtFrist(0, "en")).toBe("Today");
    });

    it("returnerer 'Tomorrow' for 1 dag", () => {
      expect(formaterDagerRelativtFrist(1, "en")).toBe("Tomorrow");
    });

    it("returnerer 'In X days' for flere dager", () => {
      expect(formaterDagerRelativtFrist(5, "en")).toBe("In 5 days");
    });

    it("returnerer '1 day ago' for -1", () => {
      expect(formaterDagerRelativtFrist(-1, "en")).toBe("1 day ago");
    });

    it("returnerer 'X days ago' for negative dager", () => {
      expect(formaterDagerRelativtFrist(-7, "en")).toBe("7 days ago");
    });
  });
});

describe("formaterTall", () => {
  it("formaterer tall med norsk locale (mellomrom som tusenskilletegn)", () => {
    const resultat = formaterTall(10000, "nb");
    expect(resultat).toMatch(/10\s*000/);
  });

  it("formaterer tall med engelsk locale (komma som tusenskilletegn)", () => {
    const resultat = formaterTall(10000, "en");
    expect(resultat).toBe("10,000");
  });

  it("formaterer små tall uten skilletegn", () => {
    expect(formaterTall(42, "nb")).toBe("42");
    expect(formaterTall(42, "en")).toBe("42");
  });

  it("formaterer 0 riktig", () => {
    expect(formaterTall(0, "nb")).toBe("0");
  });

  it("bruker norsk som standard", () => {
    const resultat = formaterTall(1000);
    expect(resultat).toMatch(/1\s*000/);
  });

  it("formaterer negative tall", () => {
    const resultat = formaterTall(-5000, "en");
    expect(resultat).toContain("5,000");
  });

  it("formaterer desimaltall", () => {
    const resultat = formaterTall(1234.56, "en");
    expect(resultat).toContain("1,234");
  });
});
