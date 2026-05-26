/*
 * Tester for backend Canvas-feilbyggere (createCanvasError, getErrorResponse).
 * Verifiserer struktur, recoverable-flagg, og mapping av error-labels.
 */

import { describe, it, expect } from "vitest";
import { createCanvasError, getErrorResponse } from "../../../rutere/canvas/canvasErrors.js";

describe("createCanvasError", () => {
  it("oppretter feil med navn 'CanvasApiError' og kode", () => {
    const err = createCanvasError("token_invalid", "ugyldig");
    expect(err.name).toBe("CanvasApiError");
    expect(err.code).toBe("token_invalid");
    expect(err.message).toBe("ugyldig");
    expect(err).toBeInstanceOf(Error);
  });

  it("setter alle valgfrie felt fra options", () => {
    const err = createCanvasError("rate_limited", "for mange", {
      httpStatus: 429,
      endpoint: "/courses",
      details: "retry-after header satt",
      retryAfter: 42,
    });
    expect(err.httpStatus).toBe(429);
    expect(err.endpoint).toBe("/courses");
    expect(err.details).toBe("retry-after header satt");
    expect(err.retryAfter).toBe(42);
  });

  it("klassifiserer rate_limited som recoverable", () => {
    const err = createCanvasError("rate_limited", "x");
    expect(err.recoverable).toBe(true);
  });

  it("klassifiserer timeout som recoverable", () => {
    const err = createCanvasError("timeout", "x");
    expect(err.recoverable).toBe(true);
  });

  it("klassifiserer token_invalid som ikke-recoverable", () => {
    const err = createCanvasError("token_invalid", "x");
    expect(err.recoverable).toBe(false);
  });

  it("klassifiserer permission_denied som ikke-recoverable", () => {
    const err = createCanvasError("permission_denied", "x");
    expect(err.recoverable).toBe(false);
  });
});

describe("getErrorResponse", () => {
  it("mapper kjent kode til label + melding", () => {
    const resp = getErrorResponse("token_invalid");
    expect(resp.kode).toBe("token_invalid");
    expect(resp.feil).toBe("Ugyldig Canvas-token");
    expect(resp.melding).toBeTruthy();
    expect(typeof resp.melding).toBe("string");
  });

  it("inkluderer detaljer når angitt", () => {
    const resp = getErrorResponse("server_error", "Mongo nede");
    expect(resp.detaljer).toBe("Mongo nede");
  });

  it("setter detaljer til undefined når ikke angitt", () => {
    const resp = getErrorResponse("timeout");
    expect(resp.detaljer).toBeUndefined();
  });

  it("returnerer konsistent form for alle kjente koder", () => {
    const koder = [
      "token_invalid",
      "token_missing",
      "permission_denied",
      "resource_disabled",
      "resource_not_found",
      "rate_limited",
      "timeout",
      "server_error",
      "network_error",
      "validation_error",
      "unknown",
    ] as const;

    for (const kode of koder) {
      const resp = getErrorResponse(kode);
      expect(resp.kode).toBe(kode);
      expect(resp.feil).toBeTruthy();
      expect(resp.melding).toBeTruthy();
    }
  });
});
