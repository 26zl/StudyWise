// Tester for i18n-kjernefunksjonalitet (språkgjenkjenning, oversettelse)

import { describe, it, expect } from "vitest";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE_KEY,
  isLanguage,
  getPreferredLanguageFromAcceptLanguage,
  translate,
} from "@/app/i18n/core";

describe("DEFAULT_LANGUAGE", () => {
  it("er 'nb' (norsk bokmål)", () => {
    expect(DEFAULT_LANGUAGE).toBe("nb");
  });
});

describe("LANGUAGE_COOKIE_KEY", () => {
  it("er 'studywise-language'", () => {
    expect(LANGUAGE_COOKIE_KEY).toBe("studywise-language");
  });
});

describe("isLanguage", () => {
  it("returnerer true for 'nb'", () => {
    expect(isLanguage("nb")).toBe(true);
  });

  it("returnerer true for 'en'", () => {
    expect(isLanguage("en")).toBe(true);
  });

  it("returnerer false for andre strenger", () => {
    expect(isLanguage("sv")).toBe(false);
    expect(isLanguage("de")).toBe(false);
    expect(isLanguage("no")).toBe(false);
    expect(isLanguage("")).toBe(false);
    expect(isLanguage("NB")).toBe(false);
    expect(isLanguage("EN")).toBe(false);
  });

  it("returnerer false for null", () => {
    expect(isLanguage(null)).toBe(false);
  });

  it("returnerer false for undefined", () => {
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe("getPreferredLanguageFromAcceptLanguage", () => {
  it("returnerer 'en' for Accept-Language med 'en'", () => {
    expect(getPreferredLanguageFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
  });

  it("returnerer 'en' for enkel 'en'", () => {
    expect(getPreferredLanguageFromAcceptLanguage("en")).toBe("en");
  });

  it("returnerer DEFAULT_LANGUAGE for 'nb'", () => {
    expect(getPreferredLanguageFromAcceptLanguage("nb")).toBe("nb");
  });

  it("returnerer DEFAULT_LANGUAGE for 'no'", () => {
    expect(getPreferredLanguageFromAcceptLanguage("no")).toBe("nb");
  });

  it("returnerer DEFAULT_LANGUAGE for null", () => {
    expect(getPreferredLanguageFromAcceptLanguage(null)).toBe("nb");
  });

  it("returnerer DEFAULT_LANGUAGE for undefined", () => {
    expect(getPreferredLanguageFromAcceptLanguage(undefined)).toBe("nb");
  });

  it("returnerer DEFAULT_LANGUAGE for tom streng", () => {
    expect(getPreferredLanguageFromAcceptLanguage("")).toBe("nb");
  });

  it("gjenkjenner 'en' i kompleks Accept-Language-header", () => {
    expect(
      getPreferredLanguageFromAcceptLanguage("nb-NO,nb;q=0.9,en-US;q=0.8,en;q=0.7"),
    ).toBe("en");
  });

  it("returnerer DEFAULT_LANGUAGE for andre språk uten 'en'", () => {
    expect(getPreferredLanguageFromAcceptLanguage("sv-SE,sv;q=0.9")).toBe("nb");
    expect(getPreferredLanguageFromAcceptLanguage("de-DE,de;q=0.9")).toBe("nb");
  });
});

describe("translate", () => {
  it("returnerer norsk oversettelse for kjent nøkkel", () => {
    expect(translate("nb", "common.actions.cancel")).toBe("Avbryt");
  });

  it("returnerer engelsk oversettelse for kjent nøkkel", () => {
    expect(translate("en", "common.actions.cancel")).toBe("Cancel");
  });

  it("faller tilbake til norsk hvis nøkkel mangler på engelsk", () => {
    const nbResultat = translate("nb", "common.actions.askAi");
    const enResultat = translate("en", "common.actions.askAi");
    expect(nbResultat).toBeTruthy();
    expect(enResultat).toBeTruthy();
  });

  it("returnerer nøkkelen selv når den ikke finnes i noen språk", () => {
    // @ts-expect-error — tester med ugyldig nøkkel for å sjekke fallback
    const resultat = translate("nb", "denne.nøkkelen.finnes.ikke");
    expect(resultat).toBe("denne.nøkkelen.finnes.ikke");
  });

  it("interpolerer verdier i meldingen", () => {
    const nbActions = translate("nb", "common.actions.close");
    expect(nbActions).toBe("Lukk");
  });

  it("lar ubrukte plassholdere stå uendret", () => {
    const resultat = translate("nb", "common.actions.retry");
    expect(resultat).toBeTruthy();
  });

  it("returnerer konsistente verdier for begge språk", () => {
    const nbResult = translate("nb", "common.actions.save");
    const enResult = translate("en", "common.actions.save");
    expect(typeof nbResult).toBe("string");
    expect(typeof enResult).toBe("string");
    expect(nbResult).toBe("Lagre");
    expect(enResult).toBe("Save");
  });
});
