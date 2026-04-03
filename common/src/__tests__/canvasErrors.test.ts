/**
 * Tester for canvasErrors-modulen – feilklassifisering og hjelpefunksjoner.
 */

import { describe, it, expect } from "vitest";
import {
  classifyHttpStatus,
  requiresReauth,
  isRecoverableError,
  getErrorMessage,
  getHttpStatusForCode,
  CanvasErrorCodeSchema,
} from "../canvasErrors.js";
import type { CanvasErrorCode } from "../canvasErrors.js";

// ─── classifyHttpStatus ─────────────────────────────────────────────────────

describe("classifyHttpStatus", () => {
  it("klassifiserer 401 som token_invalid", () => {
    expect(classifyHttpStatus(401)).toBe("token_invalid");
  });

  it("klassifiserer 403 som permission_denied (standard)", () => {
    expect(classifyHttpStatus(403)).toBe("permission_denied");
  });

  it("klassifiserer 403 med 'token mangler' som token_missing", () => {
    expect(classifyHttpStatus(403, "Canvas token mangler i profilen")).toBe("token_missing");
  });

  it("klassifiserer 403 med 'unauthorized' som permission_denied", () => {
    expect(classifyHttpStatus(403, "Unauthorized access")).toBe("permission_denied");
  });

  it("klassifiserer 404 som resource_not_found", () => {
    expect(classifyHttpStatus(404)).toBe("resource_not_found");
  });

  it("klassifiserer 404 med 'deaktivert' som resource_disabled", () => {
    expect(classifyHttpStatus(404, "Ressursen er deaktivert")).toBe("resource_disabled");
  });

  it("klassifiserer 404 med 'disabled' som resource_disabled", () => {
    expect(classifyHttpStatus(404, "Tab is disabled for this course")).toBe("resource_disabled");
  });

  it("klassifiserer 429 som rate_limited", () => {
    expect(classifyHttpStatus(429)).toBe("rate_limited");
  });

  it("klassifiserer 408 som timeout", () => {
    expect(classifyHttpStatus(408)).toBe("timeout");
  });

  it("klassifiserer 504 som timeout", () => {
    expect(classifyHttpStatus(504)).toBe("timeout");
  });

  it("klassifiserer 500 som server_error", () => {
    expect(classifyHttpStatus(500)).toBe("server_error");
  });

  it("klassifiserer 503 som server_error", () => {
    expect(classifyHttpStatus(503)).toBe("server_error");
  });

  it("klassifiserer ukjent status som unknown", () => {
    expect(classifyHttpStatus(418)).toBe("unknown");
  });

  it("klassifiserer 200 som unknown", () => {
    expect(classifyHttpStatus(200)).toBe("unknown");
  });
});

// ─── requiresReauth ─────────────────────────────────────────────────────────

describe("requiresReauth", () => {
  it("returnerer true for token_invalid", () => {
    expect(requiresReauth("token_invalid")).toBe(true);
  });

  it("returnerer true for token_missing", () => {
    expect(requiresReauth("token_missing")).toBe(true);
  });

  it("returnerer false for permission_denied", () => {
    expect(requiresReauth("permission_denied")).toBe(false);
  });

  it("returnerer false for rate_limited", () => {
    expect(requiresReauth("rate_limited")).toBe(false);
  });

  it("returnerer false for server_error", () => {
    expect(requiresReauth("server_error")).toBe(false);
  });

  it("returnerer false for unknown", () => {
    expect(requiresReauth("unknown")).toBe(false);
  });
});

// ─── isRecoverableError ─────────────────────────────────────────────────────

describe("isRecoverableError", () => {
  it("returnerer true for rate_limited", () => {
    expect(isRecoverableError("rate_limited")).toBe(true);
  });

  it("returnerer true for timeout", () => {
    expect(isRecoverableError("timeout")).toBe(true);
  });

  it("returnerer true for server_error", () => {
    expect(isRecoverableError("server_error")).toBe(true);
  });

  it("returnerer true for network_error", () => {
    expect(isRecoverableError("network_error")).toBe(true);
  });

  it("returnerer false for token_invalid", () => {
    expect(isRecoverableError("token_invalid")).toBe(false);
  });

  it("returnerer false for permission_denied", () => {
    expect(isRecoverableError("permission_denied")).toBe(false);
  });

  it("returnerer false for resource_not_found", () => {
    expect(isRecoverableError("resource_not_found")).toBe(false);
  });

  it("returnerer false for unknown", () => {
    expect(isRecoverableError("unknown")).toBe(false);
  });
});

// ─── getErrorMessage ────────────────────────────────────────────────────────

describe("getErrorMessage", () => {
  const koder: CanvasErrorCode[] = [
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
  ];

  for (const kode of koder) {
    it(`returnerer ikke-tom melding for ${kode}`, () => {
      const melding = getErrorMessage(kode);
      expect(melding).toBeTruthy();
      expect(typeof melding).toBe("string");
      expect(melding.length).toBeGreaterThan(0);
    });
  }

  it("inkluderer ressursnavn i melding", () => {
    const melding = getErrorMessage("permission_denied", "files");
    expect(melding).toContain("filer");
  });
});

// ─── getHttpStatusForCode ───────────────────────────────────────────────────

describe("getHttpStatusForCode", () => {
  it("returnerer 401 for token_invalid", () => {
    expect(getHttpStatusForCode("token_invalid")).toBe(401);
  });

  it("returnerer 403 for token_missing", () => {
    expect(getHttpStatusForCode("token_missing")).toBe(403);
  });

  it("returnerer 403 for permission_denied", () => {
    expect(getHttpStatusForCode("permission_denied")).toBe(403);
  });

  it("returnerer 404 for resource_not_found", () => {
    expect(getHttpStatusForCode("resource_not_found")).toBe(404);
  });

  it("returnerer 404 for resource_disabled", () => {
    expect(getHttpStatusForCode("resource_disabled")).toBe(404);
  });

  it("returnerer 429 for rate_limited", () => {
    expect(getHttpStatusForCode("rate_limited")).toBe(429);
  });

  it("returnerer 504 for timeout", () => {
    expect(getHttpStatusForCode("timeout")).toBe(504);
  });

  it("returnerer 502 for network_error", () => {
    expect(getHttpStatusForCode("network_error")).toBe(502);
  });

  it("returnerer 502 for server_error", () => {
    expect(getHttpStatusForCode("server_error")).toBe(502);
  });

  it("returnerer 500 for validation_error", () => {
    expect(getHttpStatusForCode("validation_error")).toBe(500);
  });

  it("returnerer 500 for unknown", () => {
    expect(getHttpStatusForCode("unknown")).toBe(500);
  });
});

// ─── CanvasErrorCodeSchema ──────────────────────────────────────────────────

describe("CanvasErrorCodeSchema", () => {
  it("godtar alle gyldige koder", () => {
    const gyldige = [
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
    ];

    for (const kode of gyldige) {
      expect(CanvasErrorCodeSchema.safeParse(kode).success).toBe(true);
    }
  });

  it("avviser ugyldig kode", () => {
    expect(CanvasErrorCodeSchema.safeParse("ugyldig_kode").success).toBe(false);
    expect(CanvasErrorCodeSchema.safeParse("").success).toBe(false);
    expect(CanvasErrorCodeSchema.safeParse(123).success).toBe(false);
  });
});
