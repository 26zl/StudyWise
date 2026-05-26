/*
 * Tester for cloudflare-only middleware.
 * Verifiserer at requireCloudflare:
 *   - blokkerer requests uten X-Forwarded-For peer-IP i Cloudflare-range
 *   - krever CF-Connecting-IP-header
 *   - tillater /health og /ready for Heroku liveness
 *   - blokkerer /health/dependencies (admin-only)
 *
 * NB: Tester X-Forwarded-For ikke req.socket.remoteAddress — på Heroku er
 * remoteAddress alltid Heroku-routerens interne IP.
 */

import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../../utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../utils/apiError.js", () => ({
  sendError: vi.fn((res: Response) => {
    (res as Response & { _statusCode?: number })._statusCode = 403;
    return res;
  }),
}));

const { requireCloudflare, _internal } = await import("../../middleware/cloudflare-only.js");

function makeReq(opts: { path?: string; cfHeader?: string; xff?: string }): Request {
  const headers: Record<string, string | undefined> = {
    "cf-connecting-ip": opts.cfHeader,
    "x-forwarded-for": opts.xff,
  };
  return {
    path: opts.path ?? "/v1/admin",
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function makeRes(): Response & { _statusCode?: number } {
  return {} as Response & { _statusCode?: number };
}

describe("requireCloudflare middleware", () => {
  it("tillater /health uten Cloudflare-headers (Heroku liveness)", () => {
    const req = makeReq({ path: "/health" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._statusCode).toBeUndefined();
  });

  it("tillater /ready uten Cloudflare-headers", () => {
    const req = makeReq({ path: "/ready" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("blokkerer /health/dependencies (admin-only — ikke bypass)", () => {
    const req = makeReq({ path: "/health/dependencies" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(403);
  });

  it("blokkerer request uten CF-Connecting-IP header", () => {
    const req = makeReq({ xff: "1.2.3.4, 104.16.0.1" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(403);
  });

  it("blokkerer request uten X-Forwarded-For", () => {
    const req = makeReq({ cfHeader: "1.2.3.4" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(403);
  });

  it("blokkerer når peer-IP (siste hop) IKKE er Cloudflare", () => {
    // Angriper kunne ha satt CF-Connecting-IP og falsk XFF, men peer-IP
    // (siste hop) er Heroku ingress = ikke CF
    const req = makeReq({ cfHeader: "1.2.3.4", xff: "1.2.3.4, 8.8.8.8" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(403);
  });

  it("tillater request fra Cloudflare-IPv4-edge (siste XFF-hop)", () => {
    // Heroku Router appender Cloudflare-edge IP som siste hop i XFF
    const req = makeReq({ cfHeader: "1.2.3.4", xff: "1.2.3.4, 104.16.0.1" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("tillater Cloudflare IPv6-range som siste XFF-hop", () => {
    const req = makeReq({ cfHeader: "1.2.3.4", xff: "1.2.3.4, 2400:cb00::1" });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("blokkerer attacker-spoofet XFF når peer (siste hop) ikke er CF", () => {
    // Angriper prøver å snike inn CF-IP foran i kjeden — siste hop er fortsatt Heroku-direct peer
    const req = makeReq({
      cfHeader: "1.2.3.4",
      xff: "104.16.0.1, 54.73.53.134",
    });
    const res = makeRes();
    const next: NextFunction = vi.fn();
    requireCloudflare(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._statusCode).toBe(403);
  });
});

describe("isCloudflareIp helper", () => {
  it("matcher kjente Cloudflare-IPv4", () => {
    expect(_internal.isCloudflareIp("104.16.0.1")).toBe(true);
    expect(_internal.isCloudflareIp("172.64.0.1")).toBe(true);
    expect(_internal.isCloudflareIp("188.114.96.1")).toBe(true);
  });

  it("avviser ikke-Cloudflare-IPv4", () => {
    expect(_internal.isCloudflareIp("8.8.8.8")).toBe(false);
    expect(_internal.isCloudflareIp("1.1.1.1")).toBe(false);
    expect(_internal.isCloudflareIp("54.73.53.134")).toBe(false); // Heroku ingress
  });

  it("matcher Cloudflare-IPv6", () => {
    expect(_internal.isCloudflareIp("2400:cb00::1")).toBe(true);
    expect(_internal.isCloudflareIp("2606:4700::1")).toBe(true);
  });

  it("avviser ugyldige IPs", () => {
    expect(_internal.isCloudflareIp("999.999.999.999")).toBe(false);
    expect(_internal.isCloudflareIp("not-an-ip")).toBe(false);
    expect(_internal.isCloudflareIp("")).toBe(false);
  });
});

describe("getPeerIp helper", () => {
  it("returnerer siste hop fra X-Forwarded-For", () => {
    const req = {
      get: (n: string) => (n === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8, 104.16.0.1" : undefined),
    } as unknown as Request;
    expect(_internal.getPeerIp(req)).toBe("104.16.0.1");
  });

  it("returnerer null når header mangler", () => {
    const req = { get: () => undefined } as unknown as Request;
    expect(_internal.getPeerIp(req)).toBeNull();
  });

  it("trimmer whitespace rundt hops", () => {
    const req = {
      get: (n: string) => (n === "x-forwarded-for" ? "  1.2.3.4 ,  104.16.0.1  " : undefined),
    } as unknown as Request;
    expect(_internal.getPeerIp(req)).toBe("104.16.0.1");
  });
});
