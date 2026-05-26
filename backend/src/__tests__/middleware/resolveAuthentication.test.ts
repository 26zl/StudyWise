/**
 * Tester for middleware/auth.ts `resolveAuthentication`.
 *
 * Bjelken i hele auth-modellen. Vi mocker Clerk SDK + DB-laget og verifiserer
 * at hver av de 11 mulige status-utfallene returneres korrekt:
 *
 *   - missing_token            (ingen Authorization-header)
 *   - invalid_or_expired       (Clerk avviser tokenet)
 *   - account_conflict         (e-post matches eksisterende konto)
 *   - turnstile_required       (mangler Turnstile-cookie)
 *   - oauth_account_conflict   (OAuth-konto allerede koblet)
 *   - oauth_metadata_missing   (OAuth uten provider-id)
 *   - username_conflict        (brukernavnet er tatt)
 *   - user_deleted             (soft-deleted bruker)
 *   - user_locked              (admin-låst bruker, både fra findOrCreate og defense-in-depth)
 *   - user_sync_failed         (findOrCreate returnerte null)
 *   - authenticated            (alt OK)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request } from "express";

// vi.mock må stå før import av modulen som testes — den hijacker modulen ved import-tid
vi.mock("../../rutere/auth/clerkAuth.js", () => ({
  findOrCreateUserByClerkId: vi.fn(),
  getClerkUserIdFromToken: vi.fn(),
  getFactorVerificationAgeFromTokenCache: vi.fn(),
  getClerkSessionCreatedAt: vi.fn(),
  getSessionIdFromTokenCache: vi.fn(),
  isAccountConflict: (r: unknown): boolean =>
    r !== null && typeof r === "object" && "__accountConflict" in r,
  isTurnstileRequired: (r: unknown): boolean =>
    r !== null && typeof r === "object" && "__turnstileRequired" in r,
  isOAuthAccountConflict: (r: unknown): boolean =>
    r !== null && typeof r === "object" && "__oauthAccountConflict" in r,
  isOAuthMetadataMissing: (r: unknown): boolean =>
    r !== null && typeof r === "object" && "__oauthMetadataMissing" in r,
  isUserDeleted: (r: unknown): boolean =>
    r !== null && typeof r === "object" && "__userDeleted" in r,
  isUserLocked: (r: unknown): boolean => r !== null && typeof r === "object" && "__userLocked" in r,
  isUsernameConflict: (r: unknown): boolean =>
    r !== null && typeof r === "object" && "__usernameConflict" in r,
  deleteClerkUserById: vi.fn(),
  markSessionTurnstileVerified: vi.fn(),
  isSessionTurnstileVerified: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../utils/authTurnstileCookie.js", () => ({
  clearAuthTurnstileCookie: vi.fn(),
  isValidAuthTurnstileCookieValue: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../utils/auditLog.js", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {
    TOKEN_VERIFICATION_FAILURE: "auth.token_verification_failure",
    USER_CREATED: "auth.user_created",
  },
}));

vi.mock("../../utils/securityAlert.js", () => ({
  checkSecurityThresholds: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../database/models/User.js", () => ({
  User: {
    findOne: vi.fn(),
  },
}));

import { resolveAuthentication } from "../../middleware/auth.js";
import {
  findOrCreateUserByClerkId,
  getClerkUserIdFromToken,
  getFactorVerificationAgeFromTokenCache,
} from "../../rutere/auth/clerkAuth.js";

const mockedFindOrCreate = findOrCreateUserByClerkId as ReturnType<typeof vi.fn>;
const mockedGetClerkUserId = getClerkUserIdFromToken as ReturnType<typeof vi.fn>;
const mockedGetFactorVerificationAge = getFactorVerificationAgeFromTokenCache as ReturnType<
  typeof vi.fn
>;

function buildRequest(overrides: Partial<Record<string, unknown>> = {}): Request {
  const req = {
    headers: { authorization: "Bearer test-token" },
    query: {},
    originalUrl: "/api/test",
    ip: "127.0.0.1",
    get: (name: string) => (req.headers as Record<string, string>)[name.toLowerCase()],
    ...overrides,
  };
  return req as unknown as Request;
}

describe("resolveAuthentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetClerkUserId.mockResolvedValue("user_clerk123");
    mockedGetFactorVerificationAge.mockReturnValue([0, 0]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returnerer missing_token når Authorization-header mangler", async () => {
    const req = buildRequest({ headers: {} });
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("missing_token");
  });

  it("returnerer missing_token når header har feil format", async () => {
    const req = buildRequest({ headers: { authorization: "NotBearer xyz" } });
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("missing_token");
  });

  it("returnerer invalid_or_expired når Clerk avviser tokenet", async () => {
    mockedGetClerkUserId.mockResolvedValue(null);
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("invalid_or_expired");
  });

  it("returnerer account_conflict ved e-post-konflikt", async () => {
    mockedFindOrCreate.mockResolvedValue({ __accountConflict: true });
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("account_conflict");
    if (result.status === "account_conflict") {
      expect(result.clerkUserId).toBe("user_clerk123");
    }
  });

  it("returnerer turnstile_required når Turnstile-cookie mangler", async () => {
    mockedFindOrCreate.mockResolvedValue({ __turnstileRequired: true });
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("turnstile_required");
  });

  it("returnerer oauth_account_conflict med provider-info", async () => {
    mockedFindOrCreate.mockResolvedValue({
      __oauthAccountConflict: true,
      provider: "google",
      conflictingUserId: "old-user-id",
    });
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("oauth_account_conflict");
    if (result.status === "oauth_account_conflict") {
      expect(result.provider).toBe("google");
    }
  });

  it("returnerer oauth_metadata_missing med provider-info", async () => {
    mockedFindOrCreate.mockResolvedValue({
      __oauthMetadataMissing: true,
      provider: "microsoft",
    });
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("oauth_metadata_missing");
    if (result.status === "oauth_metadata_missing") {
      expect(result.provider).toBe("microsoft");
    }
  });

  it("returnerer username_conflict med brukernavn", async () => {
    mockedFindOrCreate.mockResolvedValue({
      __usernameConflict: true,
      username: "ola",
    });
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("username_conflict");
    if (result.status === "username_conflict") {
      expect(result.username).toBe("ola");
    }
  });

  it("returnerer user_deleted for soft-deletet bruker", async () => {
    mockedFindOrCreate.mockResolvedValue({ __userDeleted: true });
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("user_deleted");
  });

  it("returnerer user_locked med begrunnelse fra findOrCreate", async () => {
    mockedFindOrCreate.mockResolvedValue({
      __userLocked: true,
      lockedAt: new Date(),
      lockedReason: "Brudd på vilkår",
    });
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("user_locked");
    if (result.status === "user_locked") {
      expect(result.lockedReason).toBe("Brudd på vilkår");
    }
  });

  it("returnerer user_locked uten begrunnelse hvis ikke satt", async () => {
    mockedFindOrCreate.mockResolvedValue({
      __userLocked: true,
      lockedAt: new Date(),
    });
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("user_locked");
    if (result.status === "user_locked") {
      expect(result.lockedReason).toBeUndefined();
    }
  });

  it("returnerer user_sync_failed når findOrCreate returnerer null", async () => {
    mockedFindOrCreate.mockResolvedValue(null);
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("user_sync_failed");
  });

  it("returnerer authenticated for gyldig bruker", async () => {
    const fakeUser = {
      _id: "507f1f77bcf86cd799439011",
      role: "user",
      email: "ola@example.com",
      username: "ola",
      canvasApiToken: undefined,
      canvasBaseUrl: undefined,
    };
    mockedFindOrCreate.mockResolvedValue(fakeUser);
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("authenticated");
    if (result.status === "authenticated") {
      expect(result.clerkUserId).toBe("user_clerk123");
    }
    expect(req.clerkFactorVerificationAge).toEqual([0, 0]);
  });

  // Defense-in-depth: bruker som ble låst ETTER innlogging
  it("returnerer user_locked når innlogget bruker har lockedAt satt (defense-in-depth)", async () => {
    const fakeLockedUser = {
      _id: "507f1f77bcf86cd799439011",
      role: "user",
      email: "ola@example.com",
      username: "ola",
      lockedAt: new Date(),
      lockedReason: "Admin låste meg etter innlogging",
    };
    mockedFindOrCreate.mockResolvedValue(fakeLockedUser);
    const req = buildRequest();
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("user_locked");
    if (result.status === "user_locked") {
      expect(result.lockedReason).toBe("Admin låste meg etter innlogging");
    }
  });

  // Sikkerhet: clerkUserId fra body/query skal ALDRI brukes
  it("ignorerer userId fra query/body — kun token avgjør identitet", async () => {
    mockedFindOrCreate.mockResolvedValue({
      _id: "real-user-id",
      role: "user",
      email: "ola@example.com",
    });
    const req = buildRequest({
      query: { userId: "attacker-tries-to-spoof" },
      body: { userId: "another-spoof-attempt" },
    });
    const result = await resolveAuthentication(req);
    expect(result.status).toBe("authenticated");
    // Verifiser at findOrCreate ble kalt med Clerk-token-resultatet, IKKE med spoofed userId
    expect(mockedFindOrCreate).toHaveBeenCalledWith("user_clerk123", expect.any(Object));
  });
});
