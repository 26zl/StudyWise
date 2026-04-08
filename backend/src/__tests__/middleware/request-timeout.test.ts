/*
 * Tester for requestTimeout middleware.
 * Dekker: SSE-bypass, path-spesifikke timeouts, AbortController-signal,
 * cleanup ved finish/close, og tidlig klient-abort.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { EventEmitter } from "node:events";

vi.mock("../../utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { requestTimeout } from "../../middleware/request-timeout.js";

/** Bygg et minimalt Request-objekt med EventEmitter (close-event). */
function lagReq(opts: {
  method?: string;
  path?: string;
  originalUrl?: string;
  destroyed?: boolean;
}): Request {
  const emitter = new EventEmitter();
  const req = Object.assign(emitter, {
    method: opts.method ?? "GET",
    path: opts.path ?? "/api/ping",
    originalUrl: opts.originalUrl ?? opts.path ?? "/api/ping",
    url: opts.originalUrl ?? opts.path ?? "/api/ping",
    destroyed: opts.destroyed ?? false,
  }) as unknown as Request;
  return req;
}

/** Bygg et minimalt Response-objekt med EventEmitter og spybare metoder. */
function lagRes(): Response & { _statusCode?: number; _json?: unknown } {
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    headersSent: false,
    writableEnded: false,
    _statusCode: undefined as number | undefined,
    _json: undefined as unknown,
    status(code: number) {
      this._statusCode = code;
      return this;
    },
    json(body: unknown) {
      this._json = body;
      return this;
    },
    setHeader: vi.fn(),
  }) as unknown as Response & { _statusCode?: number; _json?: unknown };
  return res;
}

describe("requestTimeout middleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.useFakeTimers();
    next = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hopper over SSE-endepunkt POST /api/ki/chat uten å sette signal", () => {
    const req = lagReq({ method: "POST", path: "/api/ki/chat" });
    const res = lagRes();
    requestTimeout(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.timeoutSignal).toBeUndefined();
  });

  it("hopper over SSE-endepunkt POST /api/ki/analyze-document", () => {
    const req = lagReq({ method: "POST", path: "/api/ki/analyze-document" });
    const res = lagRes();
    requestTimeout(req, res, next);
    expect(req.timeoutSignal).toBeUndefined();
  });

  it("setter timeoutSignal på vanlige requests", () => {
    const req = lagReq({ path: "/api/ping" });
    const res = lagRes();
    requestTimeout(req, res, next);
    expect(req.timeoutSignal).toBeInstanceOf(AbortSignal);
    expect(req.timeoutAborted).toBe(false);
    expect(next).toHaveBeenCalled();
  });

  it("sender 504 etter default timeout (30s) på vanlig request", () => {
    const req = lagReq({ path: "/api/ping" });
    const res = lagRes();
    requestTimeout(req, res, next);

    vi.advanceTimersByTime(29_999);
    expect(res._statusCode).toBeUndefined();

    vi.advanceTimersByTime(2);
    expect(res._statusCode).toBe(504);
    expect(req.timeoutAborted).toBe(true);
    expect(req.timeoutSignal?.aborted).toBe(true);
  });

  it("bruker lengre timeout (3 min) for KI chat GET (ikke-SSE-path)", () => {
    const req = lagReq({ method: "GET", path: "/api/ki/chat/history" });
    const res = lagRes();
    requestTimeout(req, res, next);

    // Ved 30s skal fortsatt ingen timeout være trigget
    vi.advanceTimersByTime(30_000);
    expect(res._statusCode).toBeUndefined();

    // Ved 3 min skal timeout trigges
    vi.advanceTimersByTime(150_001);
    expect(res._statusCode).toBe(504);
  });

  it("bruker 2 min timeout for weekly-plan", () => {
    const req = lagReq({ method: "POST", path: "/api/ki/weekly-plan" });
    const res = lagRes();
    requestTimeout(req, res, next);

    vi.advanceTimersByTime(119_999);
    expect(res._statusCode).toBeUndefined();
    vi.advanceTimersByTime(2);
    expect(res._statusCode).toBe(504);
  });

  it("bruker 3 min timeout for Canvas-fil-nedlasting", () => {
    const req = lagReq({
      method: "GET",
      path: "/api/canvas/filer/12345/download",
    });
    const res = lagRes();
    requestTimeout(req, res, next);

    vi.advanceTimersByTime(179_999);
    expect(res._statusCode).toBeUndefined();
    vi.advanceTimersByTime(2);
    expect(res._statusCode).toBe(504);
  });

  it("avbryter ikke når response allerede er ferdig (finish)", () => {
    const req = lagReq({ path: "/api/ping" });
    const res = lagRes();
    requestTimeout(req, res, next);

    // Simuler ferdig respons
    res.emit("finish");

    vi.advanceTimersByTime(60_000);
    // Ingen 504 fordi timer er ryddet opp
    expect(res._statusCode).toBeUndefined();
  });

  it("rydder timer når close emittes på response", () => {
    const req = lagReq({ path: "/api/ping" });
    const res = lagRes();
    requestTimeout(req, res, next);

    res.emit("close");
    vi.advanceTimersByTime(60_000);
    expect(res._statusCode).toBeUndefined();
  });

  it("avbryter request når klient kobler fra (req.destroyed=true)", () => {
    const req = lagReq({ path: "/api/ping", destroyed: true });
    const res = lagRes();
    requestTimeout(req, res, next);

    (req as unknown as EventEmitter).emit("close");
    expect(req.timeoutSignal?.aborted).toBe(true);
    expect(req.timeoutAborted).toBe(true);
  });

  it("avbryter ikke når req.close emittes uten at klient er destroyed", () => {
    const req = lagReq({ path: "/api/ping", destroyed: false });
    const res = lagRes();
    requestTimeout(req, res, next);

    (req as unknown as EventEmitter).emit("close");
    expect(req.timeoutSignal?.aborted).toBe(false);
  });

  it("sender ikke respons hvis headers allerede er sendt ved timeout", () => {
    const req = lagReq({ path: "/api/ping" });
    const res = lagRes();
    res.headersSent = true;
    requestTimeout(req, res, next);

    vi.advanceTimersByTime(31_000);
    expect(res._statusCode).toBeUndefined();
    // Men signalet skal fortsatt være abortet
    expect(req.timeoutSignal?.aborted).toBe(true);
  });
});
