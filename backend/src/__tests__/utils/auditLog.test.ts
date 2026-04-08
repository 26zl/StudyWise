/*
 * Tester for auditLog utility.
 * Dekker: getDeletedAuditActorId, audit() happy path,
 * metadata-sanitisering (redakting av hemmeligheter, PII, dybdekutt).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request } from "express";

// Mock AuditLog-modellen slik at vi ikke trenger Mongo
const createMock = vi.fn(async (doc: unknown) => ({
  _id: { toString: () => "audit-id-123" },
  ...(doc as object),
}));
const updateManyMock = vi.fn(async (..._args: unknown[]) => ({ modifiedCount: 0 }));

vi.mock("../../database/models/AuditLog.js", () => ({
  AuditLog: {
    create: (doc: unknown) => createMock(doc),
    updateMany: (filter: unknown, update: unknown) => updateManyMock(filter, update),
  },
  AUTH_PROVIDER_CLERK: "clerk",
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  audit,
  getDeletedAuditActorId,
  AUDIT_ACTIONS,
  anonymizeAuditTrailForDeletedUser,
} from "../../utils/auditLog.js";

describe("getDeletedAuditActorId", () => {
  it("legger på 'deleted:'-prefiks", () => {
    expect(getDeletedAuditActorId("abc123")).toBe("deleted:abc123");
  });

  it("håndterer tomme strenger", () => {
    expect(getDeletedAuditActorId("")).toBe("deleted:");
  });
});

describe("AUDIT_ACTIONS", () => {
  it("eksponerer forventede kritiske handlinger", () => {
    expect(AUDIT_ACTIONS.ACCOUNT_DELETED).toBe("account_deleted");
    expect(AUDIT_ACTIONS.RATE_LIMIT_EXCEEDED).toBe("rate_limit_exceeded");
    expect(AUDIT_ACTIONS.ACCESS_DENIED).toBe("access_denied");
    expect(AUDIT_ACTIONS.SIGN_OUT).toBe("sign_out");
  });
});

describe("audit()", () => {
  beforeEach(() => {
    createMock.mockClear();
  });

  it("skriver dokument til AuditLog med alle basisfelt", async () => {
    await audit({
      actorUserId: "u1",
      action: "test_action",
      category: "auth",
      outcome: "success",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const doc = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.actorUserId).toBe("u1");
    expect(doc.action).toBe("test_action");
    expect(doc.category).toBe("auth");
    expect(doc.outcome).toBe("success");
    expect(doc.authProvider).toBe("clerk");
  });

  it("plukker opp request-kontekst (ip, user-agent) fra req", async () => {
    const req = {
      ip: "10.0.0.1",
      socket: { remoteAddress: "10.0.0.1" },
      get: (h: string) => (h.toLowerCase() === "user-agent" ? "Mozilla/5.0" : undefined),
    } as unknown as Request;

    await audit({
      actorUserId: "u2",
      action: "login",
      category: "auth",
      outcome: "success",
      req,
    });

    const doc = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(doc.ip).toBe("10.0.0.1");
    expect(doc.userAgent).toBe("Mozilla/5.0");
  });

  it("redakter hemmeligheter i metadata (token, password, apiKey)", async () => {
    await audit({
      actorUserId: "u3",
      action: "x",
      category: "security",
      outcome: "failure",
      metadata: {
        harmless: "ok",
        token: "bearer-xyz",
        password: "hemmelig",
        apiKey: "sk-abc",
      },
    });

    const doc = createMock.mock.calls[0][0] as Record<string, unknown>;
    const meta = doc.metadata as Record<string, string>;
    expect(meta.harmless).toBe("ok");
    expect(meta.token).toBe("[redacted]");
    expect(meta.password).toBe("[redacted]");
    expect(meta.apiKey).toBe("[redacted]");
  });

  it("redakter PII-nøkler (email, firstName, phone)", async () => {
    await audit({
      actorUserId: "u4",
      action: "x",
      category: "auth",
      outcome: "success",
      metadata: {
        email: "user@example.com",
        firstName: "Laurent",
        phone: "+4712345678",
        allowed: 42,
      },
    });

    const doc = createMock.mock.calls[0][0] as Record<string, unknown>;
    const meta = doc.metadata as Record<string, unknown>;
    expect(meta.email).toBe("[redacted]");
    expect(meta.firstName).toBe("[redacted]");
    expect(meta.phone).toBe("[redacted]");
    expect(meta.allowed).toBe(42);
  });

  it("trunkerer lange strenger i metadata", async () => {
    const langStreng = "a".repeat(1000);
    await audit({
      actorUserId: "u5",
      action: "x",
      category: "auth",
      outcome: "success",
      metadata: { notat: langStreng },
    });

    const doc = createMock.mock.calls[0][0] as Record<string, unknown>;
    const meta = doc.metadata as Record<string, string>;
    expect(meta.notat.length).toBeLessThan(langStreng.length);
    expect(meta.notat).toContain("[truncated]");
  });

  it("feiler stille når AuditLog.create kaster", async () => {
    createMock.mockRejectedValueOnce(new Error("Mongo nede"));
    await expect(
      audit({
        actorUserId: "u6",
        action: "x",
        category: "auth",
        outcome: "success",
      }),
    ).resolves.toBeUndefined();
  });

  it("sanitiserer rekursivt i nestede objekter", async () => {
    await audit({
      actorUserId: "u7",
      action: "x",
      category: "auth",
      outcome: "success",
      metadata: {
        context: {
          request: {
            headers: { authorization: "Bearer xyz" },
            ok: true,
          },
        },
      },
    });

    const doc = createMock.mock.calls[0][0] as Record<string, unknown>;
    const meta = doc.metadata as {
      context: { request: { headers: Record<string, string>; ok: boolean } };
    };
    expect(meta.context.request.headers.authorization).toBe("[redacted]");
    expect(meta.context.request.ok).toBe(true);
  });
});

describe("anonymizeAuditTrailForDeletedUser", () => {
  it("kaller updateMany to ganger (actor + target)", async () => {
    updateManyMock.mockClear();
    await anonymizeAuditTrailForDeletedUser("user-42");
    expect(updateManyMock).toHaveBeenCalledTimes(2);
  });
});
