// Tester for feilhåndtering og brukervennlige feilmeldinger

import { describe, it, expect } from "vitest";
import {
  erFatalUserDataFeilmelding,
  erTokenFeilmelding,
  identifiserFeiltype,
  extractApiErrorMessage,
  extractApiErrorPayload,
  lagBrukervennligFeilmelding,
} from "@/app/lib/errorUtils";

describe("erFatalUserDataFeilmelding", () => {
  it("gjenkjenner slettet konto", () => {
    expect(erFatalUserDataFeilmelding("Kontoen er slettet")).toBe(true);
  });

  it("gjenkjenner innloggingskonflikt", () => {
    expect(erFatalUserDataFeilmelding("Det er en innloggingskonflikt")).toBe(true);
  });

  it("gjenkjenner 'allerede en konto'", () => {
    expect(erFatalUserDataFeilmelding("Det finnes allerede en konto med denne e-posten")).toBe(true);
  });

  it("gjenkjenner brukernavn-konflikt", () => {
    expect(erFatalUserDataFeilmelding("Brukernavnet testuser er allerede tatt")).toBe(true);
  });

  it("gjenkjenner 'allerede koblet til en annen studywise-bruker'", () => {
    expect(erFatalUserDataFeilmelding("Denne kontoen er allerede koblet til en annen StudyWise-bruker")).toBe(true);
  });

  it("gjenkjenner manglende oauth-identifikator", () => {
    expect(erFatalUserDataFeilmelding("Mangler verifiserbar OAuth-identifikator")).toBe(true);
  });

  it("returnerer false for vanlige feilmeldinger", () => {
    expect(erFatalUserDataFeilmelding("Noe gikk galt")).toBe(false);
    expect(erFatalUserDataFeilmelding("Serverfeil")).toBe(false);
    expect(erFatalUserDataFeilmelding("Nettverksfeil")).toBe(false);
    expect(erFatalUserDataFeilmelding("")).toBe(false);
  });
});

describe("erTokenFeilmelding", () => {
  it("gjenkjenner ugyldig token", () => {
    expect(erTokenFeilmelding("Token er ugyldig")).toBe(true);
  });

  it("gjenkjenner manglende token", () => {
    expect(erTokenFeilmelding("Token mangler")).toBe(true);
  });

  it("gjenkjenner utløpt token", () => {
    expect(erTokenFeilmelding("Token er utløpt")).toBe(true);
  });

  it("returnerer false når 'token' mangler i meldingen", () => {
    expect(erTokenFeilmelding("Ugyldig forespørsel")).toBe(false);
  });

  it("returnerer false for vanlig feil uten token-kontekst", () => {
    expect(erTokenFeilmelding("Serverfeil")).toBe(false);
    expect(erTokenFeilmelding("")).toBe(false);
  });

  it("er case-insensitive", () => {
    expect(erTokenFeilmelding("TOKEN ER UGYLDIG")).toBe(true);
  });
});

describe("identifiserFeiltype", () => {
  describe("basert på error.name", () => {
    it("gjenkjenner KIAuthError", () => {
      const error = new Error("test");
      error.name = "KIAuthError";
      expect(identifiserFeiltype(error)).toBe("auth");
    });

    it("gjenkjenner CanvasTokenMissingError", () => {
      const error = new Error("test");
      error.name = "CanvasTokenMissingError";
      expect(identifiserFeiltype(error)).toBe("auth");
    });

    it("gjenkjenner SessionExpiredError", () => {
      const error = new Error("test");
      error.name = "SessionExpiredError";
      expect(identifiserFeiltype(error)).toBe("auth");
    });

    it("gjenkjenner KIRateLimitError", () => {
      const error = new Error("test");
      error.name = "KIRateLimitError";
      expect(identifiserFeiltype(error)).toBe("rate_limit");
    });

    it("gjenkjenner KITimeoutError", () => {
      const error = new Error("test");
      error.name = "KITimeoutError";
      expect(identifiserFeiltype(error)).toBe("timeout");
    });

    it("gjenkjenner KIServiceError", () => {
      const error = new Error("test");
      error.name = "KIServiceError";
      expect(identifiserFeiltype(error)).toBe("server");
    });
  });

  describe("basert på HTTP-status", () => {
    it("401 → auth", () => {
      expect(identifiserFeiltype(new Error(""), 401)).toBe("auth");
    });

    it("403 → forbidden", () => {
      expect(identifiserFeiltype(new Error(""), 403)).toBe("forbidden");
    });

    it("404 → not_found", () => {
      expect(identifiserFeiltype(new Error(""), 404)).toBe("not_found");
    });

    it("409 → conflict", () => {
      expect(identifiserFeiltype(new Error(""), 409)).toBe("conflict");
    });

    it("429 → rate_limit", () => {
      expect(identifiserFeiltype(new Error(""), 429)).toBe("rate_limit");
    });

    it("504 → timeout", () => {
      expect(identifiserFeiltype(new Error(""), 504)).toBe("timeout");
    });

    it("408 → timeout", () => {
      expect(identifiserFeiltype(new Error(""), 408)).toBe("timeout");
    });

    it("500 → server", () => {
      expect(identifiserFeiltype(new Error(""), 500)).toBe("server");
    });

    it("502 → server", () => {
      expect(identifiserFeiltype(new Error(""), 502)).toBe("server");
    });
  });

  describe("basert på feilmelding", () => {
    it("gjenkjenner nettverksfeil", () => {
      expect(identifiserFeiltype("network error")).toBe("network");
      expect(identifiserFeiltype("fetch failed")).toBe("network");
      expect(identifiserFeiltype("nettverksfeil")).toBe("network");
    });

    it("gjenkjenner auth-feil fra melding", () => {
      expect(identifiserFeiltype("401 unauthorized")).toBe("auth");
      expect(identifiserFeiltype("ikke autentisert")).toBe("auth");
    });

    it("gjenkjenner forbidden fra melding", () => {
      expect(identifiserFeiltype("403 forbidden")).toBe("forbidden");
      expect(identifiserFeiltype("ingen tilgang")).toBe("forbidden");
    });

    it("gjenkjenner not_found fra melding", () => {
      expect(identifiserFeiltype("404 not found")).toBe("not_found");
      expect(identifiserFeiltype("finnes ikke")).toBe("not_found");
    });

    it("gjenkjenner rate_limit fra melding", () => {
      expect(identifiserFeiltype("429 too many requests")).toBe("rate_limit");
      expect(identifiserFeiltype("for mange forespørsler")).toBe("rate_limit");
      expect(identifiserFeiltype("grensen for forespørsler er nådd")).toBe("rate_limit");
      expect(identifiserFeiltype("vennligst prøv igjen senere")).toBe("rate_limit");
    });

    it("gjenkjenner timeout fra melding", () => {
      expect(identifiserFeiltype("request timeout")).toBe("timeout");
      expect(identifiserFeiltype("tok for lang tid")).toBe("timeout");
    });

    it("gjenkjenner token-feil fra melding (klassifiseres som auth pga erTokenFeilmelding-sjekk)", () => {
      expect(identifiserFeiltype("token mangler")).toBe("auth");
      expect(identifiserFeiltype("token missing")).toBe("token");
    });

    it("gjenkjenner validering fra melding", () => {
      expect(identifiserFeiltype("ugyldig format")).toBe("validation");
      expect(identifiserFeiltype("canvas-url er feil")).toBe("validation");
      expect(identifiserFeiltype("må være en canvas-instans")).toBe("validation");
    });

    it("gjenkjenner konflikt fra melding", () => {
      expect(identifiserFeiltype("eksisterer allerede")).toBe("conflict");
      expect(identifiserFeiltype("finnes allerede")).toBe("conflict");
    });

    it("returnerer 'unknown' for ukjente feil", () => {
      expect(identifiserFeiltype("noe helt annet")).toBe("unknown");
    });
  });

  it("håndterer null input", () => {
    expect(identifiserFeiltype(null)).toBe("unknown");
  });

  it("håndterer streng-input", () => {
    expect(identifiserFeiltype("unauthorized")).toBe("auth");
  });
});

describe("extractApiErrorMessage", () => {
  it("returnerer melding-feltet hvis det finnes", () => {
    expect(extractApiErrorMessage({ melding: "Feil oppsto" })).toBe("Feil oppsto");
  });

  it("returnerer feil-feltet hvis melding mangler", () => {
    expect(extractApiErrorMessage({ feil: "Serverfeil" })).toBe("Serverfeil");
  });

  it("returnerer fallback for tomt objekt", () => {
    expect(extractApiErrorMessage({})).toBe("API feil");
  });

  it("returnerer egendefinert fallback", () => {
    expect(extractApiErrorMessage({}, "Tilpasset feil")).toBe("Tilpasset feil");
  });

  it("returnerer fallback for null", () => {
    expect(extractApiErrorMessage(null)).toBe("API feil");
  });

  it("returnerer fallback for undefined", () => {
    expect(extractApiErrorMessage(undefined)).toBe("API feil");
  });

  it("returnerer fallback for streng", () => {
    expect(extractApiErrorMessage("bare en streng")).toBe("API feil");
  });

  it("returnerer fallback for tall", () => {
    expect(extractApiErrorMessage(42)).toBe("API feil");
  });

  it("prioriterer melding over feil", () => {
    expect(extractApiErrorMessage({ melding: "Melding", feil: "Feil" })).toBe("Melding");
  });

  it("ignorerer tomme strenger i melding", () => {
    expect(extractApiErrorMessage({ melding: "", feil: "Feil" })).toBe("Feil");
  });

  it("ignorerer whitespace-only melding", () => {
    expect(extractApiErrorMessage({ melding: "   ", feil: "Feil" })).toBe("Feil");
  });

  it("henter valideringsdetaljer fra array", () => {
    const payload = {
      detaljer: [{ feil: "Feltet er påkrevd" }],
    };
    expect(extractApiErrorMessage(payload)).toBe("Feltet er påkrevd");
  });

  it("henter valideringsdetaljer fra streng", () => {
    const payload = {
      detaljer: "Valideringsfeil oppsto",
    };
    expect(extractApiErrorMessage(payload)).toBe("Valideringsfeil oppsto");
  });
});

describe("extractApiErrorPayload", () => {
  it("returnerer null for ikke-objekt", () => {
    expect(extractApiErrorPayload(null)).toBe(null);
    expect(extractApiErrorPayload(undefined)).toBe(null);
    expect(extractApiErrorPayload("streng")).toBe(null);
    expect(extractApiErrorPayload(42)).toBe(null);
  });

  it("returnerer payload for gyldig objekt", () => {
    const payload = { melding: "Test", kode: "test_error" };
    expect(extractApiErrorPayload(payload)).toEqual(payload);
  });

  it("returnerer tomt objekt som gyldig payload", () => {
    expect(extractApiErrorPayload({})).toEqual({});
  });

  it("returnerer array som gyldig payload (array er objekt)", () => {
    expect(extractApiErrorPayload([])).toEqual([]);
  });
});

describe("lagBrukervennligFeilmelding", () => {
  describe("generiske meldinger (uten kontekst)", () => {
    it("returnerer auth-melding for auth-feil", () => {
      const resultat = lagBrukervennligFeilmelding("unauthorized");
      expect(resultat).toContain("logge inn");
    });

    it("returnerer rate-limit-melding", () => {
      const resultat = lagBrukervennligFeilmelding("429 too many requests");
      expect(resultat).toContain("mange forespørsler");
    });

    it("returnerer timeout-melding", () => {
      const resultat = lagBrukervennligFeilmelding("request timeout");
      expect(resultat).toContain("lang tid");
    });

    it("returnerer nettverksmelding", () => {
      const resultat = lagBrukervennligFeilmelding("network error");
      expect(resultat).toContain("internettforbindelsen");
    });

    it("returnerer server-feilmelding", () => {
      const error = new Error("test");
      error.name = "KIServiceError";
      const resultat = lagBrukervennligFeilmelding(error);
      expect(resultat).toContain("Prøv igjen");
    });

    it("returnerer fallback for ukjente feil", () => {
      expect(lagBrukervennligFeilmelding(null)).toBe("Noe gikk galt. Prøv igjen.");
    });

    it("bruker egendefinert fallback", () => {
      expect(lagBrukervennligFeilmelding(null, {}, "Tilpasset feil")).toBe("Tilpasset feil");
    });

    it("viser kort feilmelding direkte for 'unknown' type", () => {
      expect(lagBrukervennligFeilmelding("En kort feilmelding")).toBe("En kort feilmelding");
    });

    it("bruker fallback for svært lang feilmelding", () => {
      const langMelding = "x".repeat(250);
      expect(lagBrukervennligFeilmelding(langMelding)).toBe("Noe gikk galt. Prøv igjen.");
    });
  });

  describe("Canvas-kontekst", () => {
    it("gir Canvas-spesifikk token-melding for auth-feil", () => {
      const resultat = lagBrukervennligFeilmelding("unauthorized", { canvas: true });
      expect(resultat).toContain("Canvas-token");
    });

    it("gir Canvas rate-limit-melding", () => {
      const resultat = lagBrukervennligFeilmelding("429", { canvas: true });
      expect(resultat).toContain("Canvas");
    });

    it("gir Canvas timeout-melding", () => {
      const resultat = lagBrukervennligFeilmelding("timeout", { canvas: true });
      expect(resultat).toContain("Canvas");
    });

    it("gir Canvas nettverksmelding", () => {
      const resultat = lagBrukervennligFeilmelding("network error", { canvas: true });
      expect(resultat).toContain("Canvas");
    });

    it("gir Canvas not-found-melding", () => {
      const resultat = lagBrukervennligFeilmelding("404 not found", { canvas: true });
      expect(resultat).toContain("Canvas");
    });
  });

  describe("KI-kontekst", () => {
    it("gir KI-spesifikk auth-melding", () => {
      const resultat = lagBrukervennligFeilmelding("unauthorized", { ki: true });
      expect(resultat).toContain("KI-assistenten");
    });

    it("gir KI rate-limit-melding", () => {
      const resultat = lagBrukervennligFeilmelding("429", { ki: true });
      expect(resultat).toContain("forespørsler");
    });

    it("gir KI server-melding", () => {
      const error = new Error("test");
      error.name = "KIServiceError";
      const resultat = lagBrukervennligFeilmelding(error, { ki: true });
      expect(resultat).toContain("KI-tjenesten");
    });
  });

  describe("Auth-kontekst", () => {
    it("gir auth-melding i auth-kontekst", () => {
      const resultat = lagBrukervennligFeilmelding("ikke autentisert", { auth: true });
      expect(resultat).toContain("Sesjonen har utløpt");
    });

    it("gir forbidden-melding", () => {
      const resultat = lagBrukervennligFeilmelding("403 forbidden", { auth: true });
      expect(resultat).toContain("tilgang");
    });

    it("gir conflict-melding", () => {
      const resultat = lagBrukervennligFeilmelding("409 conflict", { auth: true });
      expect(resultat).toContain("finnes allerede");
    });

    it("gir rate-limit-melding i auth-kontekst", () => {
      const resultat = lagBrukervennligFeilmelding("429", { auth: true });
      expect(resultat).toContain("forsøk");
    });
  });
});
