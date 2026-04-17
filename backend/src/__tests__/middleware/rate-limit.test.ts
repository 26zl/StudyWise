/*
 * Tester for rate-limit middleware.
 * Fokus: createRateLimiter factory, consume, .reward() refund, 429-respons,
 * og in-memory fallback når Redis ikke er klar.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Tving in-memory-pathen
vi.mock("../../cache/redis.js", () => ({
  default: {},
  isRedisReady: () => false,
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const auditSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("../../utils/auditLog.js", () => ({
  audit: (...args: unknown[]) => auditSpy(...args),
  AUDIT_ACTIONS: { RATE_LIMIT_EXCEEDED: "rate_limit_exceeded" },
}));

// Mock apiError.rateLimited slik at vi kan se at den ble kalt
const rateLimitedSpy = vi.fn((res: Response, melding: string) => {
  (res as Response & { _statusCode?: number })._statusCode = 429;
  (res as Response & { _body?: unknown })._body = { melding };
  return res;
});
vi.mock("../../utils/apiError.js", () => ({
  apiError: { rateLimited: (res: Response, melding: string) => rateLimitedSpy(res, melding) },
  sendError: vi.fn(),
}));

import { createRateLimiter } from "../../middleware/rate-limit.js";

function lagReq(ip = "1.2.3.4"): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
    path: "/test",
    method: "GET",
    get: vi.fn(() => undefined),
    user: undefined,
  } as unknown as Request;
}

function lagRes(): Response {
  const headers: Record<string, string> = {};
  return {
    setHeader: vi.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    getHeader: vi.fn((k: string) => headers[k]),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("createRateLimiter", () => {
  beforeEach(() => {
    auditSpy.mockClear();
    rateLimitedSpy.mockClear();
  });

  it("returnerer middleware med .reward()-funksjon", () => {
    const mw = createRateLimiter({ points: 3, duration: 60, keyPrefix: "test:a" });
    expect(typeof mw).toBe("function");
    expect(typeof mw.reward).toBe("function");
  });

  it("kaller next() og setter rate-limit-headers innenfor limit", async () => {
    const mw = createRateLimiter({ points: 3, duration: 60, keyPrefix: "test:b" });
    const req = lagReq();
    const res = lagRes();
    const next = vi.fn() as unknown as NextFunction;

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "3");
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "2");
  });

  it("returnerer 429 og auditer når limit overskrides", async () => {
    const mw = createRateLimiter({ points: 2, duration: 60, keyPrefix: "test:c" });
    const req = lagReq("9.9.9.9");
    const res = lagRes();
    const next = vi.fn() as unknown as NextFunction;

    await mw(req, res, next);
    await mw(req, res, next);
    await mw(req, res, next); // tredje skal blokkeres

    expect(next).toHaveBeenCalledTimes(2);
    expect(rateLimitedSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const auditArg = auditSpy.mock.calls[0][0] as { action: string; outcome: string };
    expect(auditArg.action).toBe("rate_limit_exceeded");
    expect(auditArg.outcome).toBe("failure");
  });

  it("isolerer state per keyPrefix (ingen lekkasje mellom limitere)", async () => {
    const mwA = createRateLimiter({ points: 1, duration: 60, keyPrefix: "test:iso-a" });
    const mwB = createRateLimiter({ points: 1, duration: 60, keyPrefix: "test:iso-b" });
    const req = lagReq("5.5.5.5");
    const res = lagRes();
    const next = vi.fn() as unknown as NextFunction;

    await mwA(req, res, next);
    await mwB(req, res, next);
    // Begge skal ha passert siden de bruker ulike prefiks
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("isolerer state per nøkkel (IP)", async () => {
    const mw = createRateLimiter({ points: 1, duration: 60, keyPrefix: "test:ipiso" });
    const next = vi.fn() as unknown as NextFunction;

    await mw(lagReq("1.1.1.1"), lagRes(), next);
    await mw(lagReq("2.2.2.2"), lagRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("reward() refunderer ett token slik at neste request lykkes", async () => {
    const mw = createRateLimiter({ points: 2, duration: 60, keyPrefix: "test:reward" });
    const req = lagReq("4.4.4.4");
    const next = vi.fn() as unknown as NextFunction;

    await mw(req, lagRes(), next);
    await mw(req, lagRes(), next);
    // Nå er vi på limit — neste ville blitt 429

    // Refunder — viktig: dette må operere på SAMME interne limiter-instans
    await mw.reward(req);

    await mw(req, lagRes(), next);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("reward() feiler stille hvis refund kaster (best-effort)", async () => {
    const mw = createRateLimiter({ points: 5, duration: 60, keyPrefix: "test:reward-fail" });
    const req = lagReq("7.7.7.7");
    // Kall reward uten å ha consumeret først — limiter tolererer dette
    await expect(mw.reward(req)).resolves.toBeUndefined();
  });

  it("bruker custom keyGenerator (f.eks. userId)", async () => {
    const mw = createRateLimiter({
      points: 1,
      duration: 60,
      keyPrefix: "test:userkey",
      keyGenerator: (req) => (req as Request & { user?: { id: string } }).user?.id ?? "anon",
    });
    const reqUserA = {
      ...lagReq("1.1.1.1"),
      user: { id: "user-alice" },
    } as unknown as Request;
    const reqUserB = {
      ...lagReq("1.1.1.1"), // SAMME ip, men ulike brukere
      user: { id: "user-bob" },
    } as unknown as Request;
    const next = vi.fn() as unknown as NextFunction;

    await mw(reqUserA, lagRes(), next);
    await mw(reqUserB, lagRes(), next); // ulik nøkkel → passerer
    expect(next).toHaveBeenCalledTimes(2);
  });
});
