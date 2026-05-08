import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { requireRole } from "../../middleware/require-role.js";

vi.mock("../../utils/auditLog.js", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  AUDIT_ACTIONS: {
    ACCESS_DENIED: "security.access_denied",
  },
}));

vi.mock("../../utils/securityAlert.js", () => ({
  checkSecurityThresholds: vi.fn().mockResolvedValue(undefined),
}));

function buildReq(overrides: Partial<Request> = {}): Request {
  return {
    user: { id: "user-1" },
    actorRole: "admin",
    clerkFactorVerificationAge: [0, 0],
    path: "/api/admin/test",
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as unknown as Request;
}

function buildRes(): Response & { statusCodeValue?: number; jsonValue?: unknown } {
  const res = {
    statusCodeValue: undefined as number | undefined,
    jsonValue: undefined as unknown,
    status: vi.fn((statusCode: number) => {
      res.statusCodeValue = statusCode;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      res.jsonValue = payload;
      return res;
    }),
  };
  return res as unknown as Response & { statusCodeValue?: number; jsonValue?: unknown };
}

describe("requireRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("slipper admin videre når Clerk-sesjonen har verifisert second factor", async () => {
    const req = buildReq({ clerkFactorVerificationAge: [3, 1] });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    await requireRole("admin")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("blokkerer admin når Clerk-sesjonen mangler second factor-verifisering", async () => {
    const req = buildReq({ clerkFactorVerificationAge: [3, -1] });
    const res = buildRes();
    const next = vi.fn() as NextFunction;

    await requireRole("admin")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.jsonValue).toMatchObject({
      error: "mfa_required",
      kode: "mfa_required",
    });
  });
});
