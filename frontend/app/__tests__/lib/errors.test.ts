// Tester for feilklasser og feilhierarki

import { describe, it, expect } from "vitest";
import {
  AppError,
  KIAuthError,
  KIConfigError,
  KIRateLimitError,
  KIServiceError,
  KITimeoutError,
  CanvasTokenMissingError,
  CanvasTokenInvalidError,
  CanvasPermissionError,
  CanvasResourceError,
  CanvasApiError,
  SessionExpiredError,
  ForbiddenError,
  UsernameConflictError,
} from "@/app/lib/errors";

describe("AppError.isAppError", () => {
  it("returnerer true for AppError-subklasser", () => {
    expect(AppError.isAppError(new KIAuthError())).toBe(true);
    expect(AppError.isAppError(new KIRateLimitError())).toBe(true);
    expect(AppError.isAppError(new KITimeoutError())).toBe(true);
    expect(AppError.isAppError(new KIConfigError())).toBe(true);
    expect(AppError.isAppError(new KIServiceError())).toBe(true);
    expect(AppError.isAppError(new CanvasTokenMissingError())).toBe(true);
    expect(AppError.isAppError(new CanvasTokenInvalidError())).toBe(true);
    expect(AppError.isAppError(new CanvasPermissionError())).toBe(true);
    expect(AppError.isAppError(new SessionExpiredError())).toBe(true);
    expect(AppError.isAppError(new ForbiddenError())).toBe(true);
  });

  it("returnerer false for vanlig Error", () => {
    expect(AppError.isAppError(new Error("vanlig feil"))).toBe(false);
  });

  it("returnerer false for null, undefined og primitive typer", () => {
    expect(AppError.isAppError(null)).toBe(false);
    expect(AppError.isAppError(undefined)).toBe(false);
    expect(AppError.isAppError("streng")).toBe(false);
    expect(AppError.isAppError(42)).toBe(false);
    expect(AppError.isAppError({})).toBe(false);
  });

  it("returnerer false for UsernameConflictError (arver ikke fra AppError)", () => {
    expect(AppError.isAppError(new UsernameConflictError("test"))).toBe(false);
  });
});

describe("requiresReauth", () => {
  it("returnerer true for auth-relaterte feil", () => {
    expect(new KIAuthError().requiresReauth()).toBe(true);
    expect(new SessionExpiredError().requiresReauth()).toBe(true);
    expect(new CanvasTokenInvalidError().requiresReauth()).toBe(true);
    expect(new CanvasTokenMissingError().requiresReauth()).toBe(true);
  });

  it("returnerer false for ikke-auth-feil", () => {
    expect(new KIRateLimitError().requiresReauth()).toBe(false);
    expect(new KITimeoutError().requiresReauth()).toBe(false);
    expect(new KIConfigError().requiresReauth()).toBe(false);
    expect(new KIServiceError().requiresReauth()).toBe(false);
    expect(new ForbiddenError().requiresReauth()).toBe(false);
    expect(new CanvasPermissionError().requiresReauth()).toBe(false);
  });
});

describe("isRateLimited", () => {
  it("returnerer true for rate-limit-feil", () => {
    expect(new KIRateLimitError().isRateLimited()).toBe(true);
  });

  it("returnerer true for CanvasApiError med rate_limited-kode", () => {
    const error = new CanvasApiError("rate_limited", "For mange forespørsler", 429);
    expect(error.isRateLimited()).toBe(true);
  });

  it("returnerer false for andre feil", () => {
    expect(new KIAuthError().isRateLimited()).toBe(false);
    expect(new KITimeoutError().isRateLimited()).toBe(false);
    expect(new ForbiddenError().isRateLimited()).toBe(false);
    expect(new SessionExpiredError().isRateLimited()).toBe(false);
  });
});

describe("KIAuthError", () => {
  it("har riktig standardmelding", () => {
    expect(new KIAuthError().message).toBe("Ikke autentisert");
  });

  it("har riktig kode", () => {
    expect(new KIAuthError().code).toBe("ki_auth");
  });

  it("har riktig HTTP-status", () => {
    expect(new KIAuthError().httpStatus).toBe(401);
  });

  it("er ikke retryable", () => {
    expect(new KIAuthError().retryable).toBe(false);
  });

  it("har riktig name", () => {
    expect(new KIAuthError().name).toBe("KIAuthError");
  });

  it("godtar egendefinert melding", () => {
    expect(new KIAuthError("Egendefinert").message).toBe("Egendefinert");
  });
});

describe("KIConfigError", () => {
  it("har riktig standardmelding", () => {
    expect(new KIConfigError().message).toBe("KI-tjenesten er ikke konfigurert riktig");
  });

  it("har riktig kode og status", () => {
    expect(new KIConfigError().code).toBe("ki_config");
    expect(new KIConfigError().httpStatus).toBe(500);
  });

  it("er ikke retryable", () => {
    expect(new KIConfigError().retryable).toBe(false);
  });
});

describe("KIRateLimitError", () => {
  it("har riktig standardmelding", () => {
    expect(new KIRateLimitError().message).toBe("For mange forespørsler");
  });

  it("har riktig kode", () => {
    expect(new KIRateLimitError().code).toBe("ki_rate_limit");
  });

  it("har HTTP-status 429", () => {
    expect(new KIRateLimitError().httpStatus).toBe(429);
  });

  it("er retryable", () => {
    expect(new KIRateLimitError().retryable).toBe(true);
  });

  it("har riktig name", () => {
    expect(new KIRateLimitError().name).toBe("KIRateLimitError");
  });
});

describe("KIServiceError", () => {
  it("har riktig standardmelding", () => {
    expect(new KIServiceError().message).toBe("KI-tjenesten er utilgjengelig");
  });

  it("har riktig kode og status", () => {
    expect(new KIServiceError().code).toBe("ki_service");
    expect(new KIServiceError().httpStatus).toBe(503);
  });

  it("er retryable", () => {
    expect(new KIServiceError().retryable).toBe(true);
  });
});

describe("KITimeoutError", () => {
  it("har riktig standardmelding", () => {
    expect(new KITimeoutError().message).toBe("Forespørselen tok for lang tid");
  });

  it("har riktig kode og status", () => {
    expect(new KITimeoutError().code).toBe("ki_timeout");
    expect(new KITimeoutError().httpStatus).toBe(504);
  });

  it("er retryable", () => {
    expect(new KITimeoutError().retryable).toBe(true);
  });

  it("har riktig name", () => {
    expect(new KITimeoutError().name).toBe("KITimeoutError");
  });
});

describe("CanvasTokenMissingError", () => {
  it("har riktig standardmelding", () => {
    expect(new CanvasTokenMissingError().message).toBe("Canvas-token mangler");
  });

  it("har riktig kode", () => {
    expect(new CanvasTokenMissingError().code).toBe("token_missing");
  });

  it("har HTTP-status 403", () => {
    expect(new CanvasTokenMissingError().httpStatus).toBe(403);
  });

  it("er ikke retryable", () => {
    expect(new CanvasTokenMissingError().retryable).toBe(false);
  });

  it("krever reauth", () => {
    expect(new CanvasTokenMissingError().requiresReauth()).toBe(true);
  });
});

describe("CanvasTokenInvalidError", () => {
  it("har riktig standardmelding", () => {
    expect(new CanvasTokenInvalidError().message).toBe("Canvas-token er ugyldig eller utløpt");
  });

  it("har riktig kode", () => {
    expect(new CanvasTokenInvalidError().code).toBe("token_invalid");
  });

  it("har HTTP-status 401", () => {
    expect(new CanvasTokenInvalidError().httpStatus).toBe(401);
  });

  it("krever reauth", () => {
    expect(new CanvasTokenInvalidError().requiresReauth()).toBe(true);
  });
});

describe("CanvasPermissionError", () => {
  it("har riktig standardmelding", () => {
    expect(new CanvasPermissionError().message).toBe("Du har ikke tilgang til denne ressursen");
  });

  it("har riktig kode og status", () => {
    expect(new CanvasPermissionError().code).toBe("permission_denied");
    expect(new CanvasPermissionError().httpStatus).toBe(403);
  });

  it("krever ikke reauth", () => {
    expect(new CanvasPermissionError().requiresReauth()).toBe(false);
  });
});

describe("CanvasResourceError", () => {
  it("opprettes med resource_disabled", () => {
    const error = new CanvasResourceError("resource_disabled", "Deaktivert ressurs");
    expect(error.code).toBe("resource_disabled");
    expect(error.message).toBe("Deaktivert ressurs");
    expect(error.httpStatus).toBe(404);
  });

  it("opprettes med resource_not_found", () => {
    const error = new CanvasResourceError("resource_not_found", "Ikke funnet");
    expect(error.code).toBe("resource_not_found");
    expect(error.message).toBe("Ikke funnet");
  });

  it("har riktig name", () => {
    expect(new CanvasResourceError("resource_not_found", "test").name).toBe("CanvasResourceError");
  });
});

describe("CanvasApiError", () => {
  it("opprettes med kode, melding og status", () => {
    const error = new CanvasApiError("server_error", "Serverfeil", 500);
    expect(error.code).toBe("server_error");
    expect(error.message).toBe("Serverfeil");
    expect(error.httpStatus).toBe(500);
  });

  it("er retryable for rate_limited", () => {
    const error = new CanvasApiError("rate_limited", "For mange", 429);
    expect(error.retryable).toBe(true);
  });

  it("er retryable for timeout", () => {
    const error = new CanvasApiError("timeout", "Tidsavbrudd", 504);
    expect(error.retryable).toBe(true);
  });

  it("er ikke retryable for andre koder", () => {
    const error = new CanvasApiError("server_error", "Feil", 500);
    expect(error.retryable).toBe(false);
  });
});

describe("SessionExpiredError", () => {
  it("har riktig standardmelding", () => {
    expect(new SessionExpiredError().message).toBe("Sesjonen har utløpt. Logg inn på nytt.");
  });

  it("har riktig kode", () => {
    expect(new SessionExpiredError().code).toBe("auth_expired");
  });

  it("har HTTP-status 401", () => {
    expect(new SessionExpiredError().httpStatus).toBe(401);
  });

  it("krever reauth", () => {
    expect(new SessionExpiredError().requiresReauth()).toBe(true);
  });

  it("har riktig name", () => {
    expect(new SessionExpiredError().name).toBe("SessionExpiredError");
  });
});

describe("ForbiddenError", () => {
  it("har riktig standardmelding", () => {
    expect(new ForbiddenError().message).toBe("Du har ikke tilgang til denne ressursen.");
  });

  it("har riktig kode og status", () => {
    expect(new ForbiddenError().code).toBe("forbidden");
    expect(new ForbiddenError().httpStatus).toBe(403);
  });

  it("krever ikke reauth", () => {
    expect(new ForbiddenError().requiresReauth()).toBe(false);
  });

  it("godtar egendefinert melding", () => {
    expect(new ForbiddenError("Ingen tilgang her").message).toBe("Ingen tilgang her");
  });
});

describe("UsernameConflictError", () => {
  it("inkluderer brukernavn i melding", () => {
    const error = new UsernameConflictError("testbruker");
    expect(error.message).toContain("testbruker");
    expect(error.message).toContain("allerede tatt");
  });

  it("lagrer brukernavn", () => {
    const error = new UsernameConflictError("minbruker");
    expect(error.username).toBe("minbruker");
  });

  it("har riktig name", () => {
    expect(new UsernameConflictError("test").name).toBe("UsernameConflictError");
  });

  it("er en vanlig Error, ikke AppError", () => {
    const error = new UsernameConflictError("test");
    expect(error instanceof Error).toBe(true);
    expect(AppError.isAppError(error)).toBe(false);
  });
});
