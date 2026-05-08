import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerkMock = vi.hoisted(() => ({
  createClerkClient: vi.fn(() => ({
    sessions: { getSession: vi.fn() },
    users: { getUser: vi.fn() },
  })),
  verifyToken: vi.fn(),
}));

const redisMock = vi.hoisted(() => ({
  getCache: vi.fn(),
  setCache: vi.fn(),
}));

vi.mock("@clerk/backend", () => clerkMock);

vi.mock("../../../cache/redis.js", () => ({
  getCache: redisMock.getCache,
  setCache: redisMock.setCache,
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../../utils/auditLog.js", () => ({
  audit: vi.fn(),
  AUDIT_ACTIONS: {},
}));

vi.mock("../../../database/models/User.js", () => ({
  User: {},
  sanitizeUsername: (value: string) => value,
}));

vi.mock("../../../database/models/DeletedUserTombstone.js", () => ({
  DeletedUserTombstone: {},
}));

function tokenVerificationError(reason: string): Error & { reason: string } {
  const err = new Error(reason) as Error & { reason: string };
  err.name = "TokenVerificationError";
  err.reason = reason;
  return err;
}

async function loadAuthModule() {
  return import("../../../rutere/auth/clerkAuth.js");
}

describe("clerkAuth token cache stale fallback", () => {
  const baseTime = new Date("2026-01-01T00:00:00.000Z");

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);
    process.env.CLERK_SECRET_KEY = "sk_test_token_cache";
    delete process.env.WEB_ORIGINS;
    clerkMock.verifyToken.mockReset();
    redisMock.getCache.mockReset();
    redisMock.getCache.mockResolvedValue(null);
    redisMock.setCache.mockReset();
    redisMock.setCache.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.WEB_ORIGINS;
  });

  it("godtar en tidligere verifisert token ved Clerk JWKS-fetch-feil", async () => {
    const { getClerkUserIdFromToken } = await loadAuthModule();
    const jwtExpSeconds = Math.floor((baseTime.getTime() + 60_000) / 1000);

    clerkMock.verifyToken.mockResolvedValueOnce({
      sub: "user_clerk_1",
      sid: "sess_1",
      exp: jwtExpSeconds,
      fva: [0, 0],
    });

    await expect(getClerkUserIdFromToken("bearer-token-1")).resolves.toBe("user_clerk_1");

    vi.setSystemTime(baseTime.getTime() + 31_000);
    clerkMock.verifyToken.mockRejectedValueOnce(
      tokenVerificationError("jwk-remote-failed-to-load"),
    );

    await expect(getClerkUserIdFromToken("bearer-token-1")).resolves.toBe("user_clerk_1");
    expect(clerkMock.verifyToken).toHaveBeenCalledTimes(2);
  });

  it("godtar ikke stale cache når Clerk avviser tokenet som ugyldig", async () => {
    const { getClerkUserIdFromToken } = await loadAuthModule();
    const jwtExpSeconds = Math.floor((baseTime.getTime() + 60 * 60 * 1000) / 1000);

    clerkMock.verifyToken.mockResolvedValueOnce({
      sub: "user_clerk_2",
      sid: "sess_2",
      exp: jwtExpSeconds,
    });

    await expect(getClerkUserIdFromToken("bearer-token-2")).resolves.toBe("user_clerk_2");

    vi.setSystemTime(baseTime.getTime() + 31_000);
    clerkMock.verifyToken.mockRejectedValueOnce(tokenVerificationError("token-invalid"));

    await expect(getClerkUserIdFromToken("bearer-token-2")).resolves.toBeNull();
  });

  it("måler stale-grace fra faktisk JWT-exp, ikke fra lokal cache-TTL", async () => {
    const { getClerkUserIdFromToken } = await loadAuthModule();
    const jwtExpMs = baseTime.getTime() + 5 * 60 * 1000;
    const jwtExpSeconds = Math.floor(jwtExpMs / 1000);

    clerkMock.verifyToken.mockResolvedValueOnce({
      sub: "user_clerk_3",
      sid: "sess_3",
      exp: jwtExpSeconds,
    });

    await expect(getClerkUserIdFromToken("bearer-token-3")).resolves.toBe("user_clerk_3");

    vi.setSystemTime(baseTime.getTime() + 31 * 60 * 1000);
    clerkMock.verifyToken.mockRejectedValueOnce(
      tokenVerificationError("jwk-remote-failed-to-load"),
    );

    await expect(getClerkUserIdFromToken("bearer-token-3")).resolves.toBe("user_clerk_3");

    vi.setSystemTime(jwtExpMs + 30 * 60 * 1000 + 1);
    clerkMock.verifyToken.mockRejectedValueOnce(
      tokenVerificationError("jwk-remote-failed-to-load"),
    );

    await expect(getClerkUserIdFromToken("bearer-token-3")).resolves.toBeNull();
  });
});
