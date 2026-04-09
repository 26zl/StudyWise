/*
 * Tester for standardisert API-feilhåndtering
 * Verifiserer at alle feiltyper sender korrekte HTTP-statuskoder og responser
 */

import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { ZodError, z } from "zod";
import {
  apiError,
  requireUserId,
  sendZodError,
  sendError,
  sendUnknownError,
} from "../../utils/apiError.js";

// Mock logger for å unngå konsollutskrift under tester
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/** Oppretter et minimalt mock Response-objekt for testing */
const lagMockRes = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
};

/** Oppretter et minimalt mock Request-objekt */
const lagMockReq = (user?: { id: string }) => {
  return { user } as unknown as Request;
};

describe("apiError", () => {
  // --- unauthorized (401) ---

  describe("unauthorized", () => {
    it("sender 401 med auth_error kode", () => {
      const res = lagMockRes();
      apiError.unauthorized(res);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ kode: "auth_error" }),
      );
    });

    it("bruker egendefinert melding når gitt", () => {
      const res = lagMockRes();
      apiError.unauthorized(res, "Token utløpt");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ melding: "Token utløpt" }),
      );
    });

    it("bruker standardmelding når ingen melding er gitt", () => {
      const res = lagMockRes();
      apiError.unauthorized(res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ feil: "Ikke autentisert" }),
      );
    });
  });

  // --- forbidden (403) ---

  describe("forbidden", () => {
    it("sender 403 med forbidden kode", () => {
      const res = lagMockRes();
      apiError.forbidden(res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ kode: "forbidden" }),
      );
    });

    it("bruker egendefinert melding", () => {
      const res = lagMockRes();
      apiError.forbidden(res, "Bare admin");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ melding: "Bare admin" }),
      );
    });
  });

  // --- badRequest (400) ---

  describe("badRequest", () => {
    it("sender 400 med validation_error kode", () => {
      const res = lagMockRes();
      apiError.badRequest(res, "Ugyldig e-post");
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          kode: "validation_error",
          feil: "Ugyldig e-post",
        }),
      );
    });

    it("inkluderer detaljer når gitt", () => {
      const res = lagMockRes();
      const detaljer = { felt: "email", grunn: "format" };
      apiError.badRequest(res, "Valideringsfeil", detaljer);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ detaljer }),
      );
    });
  });

  // --- notFound (404) ---

  describe("notFound", () => {
    it("sender 404 med not_found kode", () => {
      const res = lagMockRes();
      apiError.notFound(res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ kode: "not_found" }),
      );
    });

    it("inkluderer ressursnavn i feilmelding", () => {
      const res = lagMockRes();
      apiError.notFound(res, "Bruker");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ feil: "Bruker ble ikke funnet" }),
      );
    });

    it("bruker standard ressursnavn 'Ressurs'", () => {
      const res = lagMockRes();
      apiError.notFound(res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ feil: "Ressurs ble ikke funnet" }),
      );
    });
  });

  // --- conflict (409) ---

  describe("conflict", () => {
    it("sender 409 med conflict kode", () => {
      const res = lagMockRes();
      apiError.conflict(res, "E-post allerede i bruk");
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          kode: "conflict",
          melding: "E-post allerede i bruk",
        }),
      );
    });
  });

  // --- rateLimited (429) ---

  describe("rateLimited", () => {
    it("sender 429 med rate_limited kode", () => {
      const res = lagMockRes();
      apiError.rateLimited(res);
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ kode: "rate_limited" }),
      );
    });

    it("bruker egendefinert melding", () => {
      const res = lagMockRes();
      apiError.rateLimited(res, "Maks 10 per minutt");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ melding: "Maks 10 per minutt" }),
      );
    });

    it("bruker standardmelding når ingen er gitt", () => {
      const res = lagMockRes();
      apiError.rateLimited(res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ melding: "Vent litt og prøv igjen." }),
      );
    });
  });

  // --- timeout (504) ---

  describe("timeout", () => {
    it("sender 504 med timeout kode", () => {
      const res = lagMockRes();
      apiError.timeout(res);
      expect(res.status).toHaveBeenCalledWith(504);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ kode: "timeout" }),
      );
    });

    it("bruker egendefinert melding", () => {
      const res = lagMockRes();
      apiError.timeout(res, "Canvas svarer ikke");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ melding: "Canvas svarer ikke" }),
      );
    });
  });

  // --- serviceUnavailable (503) ---

  describe("serviceUnavailable", () => {
    it("sender 503 med service_unavailable kode", () => {
      const res = lagMockRes();
      apiError.serviceUnavailable(res);
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ kode: "service_unavailable" }),
      );
    });

    it("inkluderer tjenestenavn i melding", () => {
      const res = lagMockRes();
      apiError.serviceUnavailable(res, "Canvas");
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          melding: "Canvas er midlertidig utilgjengelig. Prøv igjen senere.",
        }),
      );
    });

    it("bruker generisk melding uten tjenestenavn", () => {
      const res = lagMockRes();
      apiError.serviceUnavailable(res);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ melding: "Prøv igjen senere." }),
      );
    });
  });

  // --- serverError (500) ---

  describe("serverError", () => {
    it("sender 500 med server_error kode", () => {
      const res = lagMockRes();
      apiError.serverError(res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ kode: "server_error" }),
      );
    });
  });
});

// --- requireUserId ---

describe("requireUserId", () => {
  it("returnerer userId når req.user finnes", () => {
    const res = lagMockRes();
    const req = lagMockReq({ id: "bruker-123" });
    const resultat = requireUserId(req, res);
    expect(resultat).toBe("bruker-123");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returnerer null og sender 401 når req.user mangler", () => {
    const res = lagMockRes();
    const req = lagMockReq();
    const resultat = requireUserId(req, res);
    expect(resultat).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returnerer null når req.user er undefined", () => {
    const res = lagMockRes();
    const req = { user: undefined } as unknown as Request;
    const resultat = requireUserId(req, res);
    expect(resultat).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// --- sendZodError ---

describe("sendZodError", () => {
  it("sender 400 med validation_error kode for Zod-feil", () => {
    const res = lagMockRes();
    const schema = z.object({ epost: z.email() });

    try {
      schema.parse({ epost: "ugyldig" });
    } catch (error) {
      sendZodError(res, error as ZodError);
    }

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ kode: "validation_error" }),
    );
  });

  it("inkluderer kontekst i feilmelding når gitt", () => {
    const res = lagMockRes();
    const schema = z.object({ navn: z.string().min(1) });

    try {
      schema.parse({ navn: "" });
    } catch (error) {
      sendZodError(res, error as ZodError, "Opprett bruker");
    }

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ feil: "Valideringsfeil: Opprett bruker" }),
    );
  });

  it("inkluderer felt-detaljer i respons", () => {
    const res = lagMockRes();
    const schema = z.object({ alder: z.number().min(18) });

    try {
      schema.parse({ alder: 10 });
    } catch (error) {
      sendZodError(res, error as ZodError);
    }

    const jsonKall = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(jsonKall.detaljer).toBeInstanceOf(Array);
    expect(jsonKall.detaljer[0]).toHaveProperty("felt", "alder");
    expect(jsonKall.detaljer[0]).toHaveProperty("feil");
  });

  it("bruker standard feilmelding uten kontekst", () => {
    const res = lagMockRes();
    const schema = z.object({ x: z.number() });

    try {
      schema.parse({ x: "ikke-tall" });
    } catch (error) {
      sendZodError(res, error as ZodError);
    }

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ feil: "Valideringsfeil i forespørsel" }),
    );
  });
});

// --- sendError ---

describe("sendError", () => {
  it("sender korrekt statuskode basert på feilkode", () => {
    const res = lagMockRes();
    sendError(res, "not_found");
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("kan overstyre statuskode via options", () => {
    const res = lagMockRes();
    sendError(res, "server_error", { status: 502 });
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("inkluderer kode i responsen", () => {
    const res = lagMockRes();
    sendError(res, "forbidden");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ kode: "forbidden" }),
    );
  });
});

// --- sendUnknownError ---

describe("sendUnknownError", () => {
  it("sender 500 for ukjente feil", () => {
    const res = lagMockRes();
    sendUnknownError(res, new Error("uventet"));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ kode: "server_error" }),
    );
  });

  it("bruker egendefinert brukermelding fra logContext", () => {
    const res = lagMockRes();
    sendUnknownError(res, new Error("db-feil"), {
      melding: "Kunne ikke hente data",
      kontekst: "hentBruker",
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ melding: "Kunne ikke hente data" }),
    );
  });

  it("bruker standardmelding når ingen brukermelding er gitt", () => {
    const res = lagMockRes();
    sendUnknownError(res, new Error("x"));
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        melding: "Noe gikk galt. Prøv igjen senere.",
      }),
    );
  });

  it("håndterer ikke-Error objekter", () => {
    const res = lagMockRes();
    sendUnknownError(res, "en strengfeil");
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
