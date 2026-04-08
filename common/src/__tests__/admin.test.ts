/**
 * Tester for common/admin.ts — admin-API Zod-skjemaer.
 *
 * Privacy-prinsipp: brukerdetalj-skjemaet er bevisst snevert. Vi tester
 * at det IKKE aksepterer ekstra felter som chat-innhold eller tokens.
 */
import { describe, it, expect } from "vitest";
import {
  AdminBrukerSchema,
  AdminBrukereStatusFilterSchema,
  AdminBrukereQuerySchema,
  AdminLockUserSchema,
  AdminLockUserResponseSchema,
  AdminUnlockUserResponseSchema,
  AdminContactMessageSchema,
  AdminContactMessageQuerySchema,
  AdminContactMessageUpdateSchema,
  ContactMessageStatusSchema,
  AdminBrukerDetaljSchema,
  AdminBrukerDetaljAuditEntrySchema,
  AdminAuditQuerySchema,
} from "../admin.js";

describe("common/admin.ts schemas", () => {
  // ── AdminBrukereStatusFilterSchema ────────────────────────────────────────
  describe("AdminBrukereStatusFilterSchema", () => {
    it("aksepterer alle fire status-verdier", () => {
      expect(AdminBrukereStatusFilterSchema.parse("all")).toBe("all");
      expect(AdminBrukereStatusFilterSchema.parse("active")).toBe("active");
      expect(AdminBrukereStatusFilterSchema.parse("locked")).toBe("locked");
      expect(AdminBrukereStatusFilterSchema.parse("deleted")).toBe("deleted");
    });

    it("avviser ukjente verdier", () => {
      expect(() => AdminBrukereStatusFilterSchema.parse("invalid")).toThrow();
      expect(() => AdminBrukereStatusFilterSchema.parse("pending")).toThrow();
      expect(() => AdminBrukereStatusFilterSchema.parse("")).toThrow();
    });
  });

  // ── AdminBrukereQuerySchema ───────────────────────────────────────────────
  describe("AdminBrukereQuerySchema", () => {
    it("aksepterer query med kun status", () => {
      const result = AdminBrukereQuerySchema.parse({ status: "active" });
      expect(result.status).toBe("active");
    });

    it("aksepterer tomt object (alle felter er optional)", () => {
      expect(AdminBrukereQuerySchema.parse({})).toEqual({});
    });

    it("aksepterer fullstendig query", () => {
      const result = AdminBrukereQuerySchema.parse({
        limit: "50",
        offset: "100",
        search: "ola",
        status: "locked",
      });
      expect(result.limit).toBe("50");
      expect(result.search).toBe("ola");
    });

    it("avviser ikke-numerisk limit", () => {
      expect(() => AdminBrukereQuerySchema.parse({ limit: "abc" })).toThrow();
    });

    it("avviser limit lengre enn 6 tegn", () => {
      expect(() => AdminBrukereQuerySchema.parse({ limit: "1234567" })).toThrow();
    });

    it("avviser ugyldig status", () => {
      expect(() => AdminBrukereQuerySchema.parse({ status: "invalid" })).toThrow();
    });

    it("trimmer search-feltet", () => {
      const result = AdminBrukereQuerySchema.parse({ search: "  ola  " });
      expect(result.search).toBe("ola");
    });

    it("avviser search lengre enn 200 tegn", () => {
      expect(() =>
        AdminBrukereQuerySchema.parse({ search: "a".repeat(201) }),
      ).toThrow();
    });
  });

  // ── AdminBrukerSchema (lock + delete-felter) ──────────────────────────────
  describe("AdminBrukerSchema", () => {
    const validBruker = {
      id: "507f1f77bcf86cd799439011",
      email: "test@example.com",
      rolle: "user" as const,
      harCanvasToken: false,
      opprettet: new Date("2024-01-01"),
      locked: false,
    };

    it("aksepterer minimal aktiv bruker", () => {
      const result = AdminBrukerSchema.parse(validBruker);
      expect(result.email).toBe("test@example.com");
      expect(result.locked).toBe(false);
    });

    it("aksepterer låst bruker med begrunnelse", () => {
      const result = AdminBrukerSchema.parse({
        ...validBruker,
        locked: true,
        lockedAt: new Date("2024-06-01"),
        lockedReason: "Brudd på vilkår",
      });
      expect(result.locked).toBe(true);
      expect(result.lockedReason).toBe("Brudd på vilkår");
    });

    it("aksepterer slettet bruker", () => {
      const result = AdminBrukerSchema.parse({
        ...validBruker,
        deletedAt: new Date("2024-08-01"),
      });
      expect(result.deletedAt).toBeInstanceOf(Date);
    });

    it("avviser ugyldig e-post", () => {
      expect(() =>
        AdminBrukerSchema.parse({ ...validBruker, email: "ikke-en-epost" }),
      ).toThrow();
    });

    it("avviser lockedReason lengre enn 500 tegn", () => {
      expect(() =>
        AdminBrukerSchema.parse({
          ...validBruker,
          locked: true,
          lockedReason: "x".repeat(501),
        }),
      ).toThrow();
    });

    it("avviser ugyldig rolle", () => {
      expect(() =>
        AdminBrukerSchema.parse({ ...validBruker, rolle: "superadmin" }),
      ).toThrow();
    });

    it("aksepterer rolle admin", () => {
      const result = AdminBrukerSchema.parse({ ...validBruker, rolle: "admin" });
      expect(result.rolle).toBe("admin");
    });
  });

  // ── AdminLockUserSchema ───────────────────────────────────────────────────
  describe("AdminLockUserSchema", () => {
    it("aksepterer tom body (begrunnelse er valgfri)", () => {
      expect(AdminLockUserSchema.parse({})).toEqual({});
    });

    it("aksepterer body med begrunnelse", () => {
      const result = AdminLockUserSchema.parse({ reason: "Mistenkelig aktivitet" });
      expect(result.reason).toBe("Mistenkelig aktivitet");
    });

    it("trimmer begrunnelsen", () => {
      const result = AdminLockUserSchema.parse({ reason: "  årsak  " });
      expect(result.reason).toBe("årsak");
    });

    it("avviser begrunnelse lengre enn 500 tegn", () => {
      expect(() =>
        AdminLockUserSchema.parse({ reason: "a".repeat(501) }),
      ).toThrow();
    });
  });

  describe("AdminLockUserResponseSchema", () => {
    it("aksepterer låst respons", () => {
      const result = AdminLockUserResponseSchema.parse({
        id: "507f1f77bcf86cd799439011",
        locked: true,
        lockedAt: new Date(),
        lockedReason: "test",
      });
      expect(result.locked).toBe(true);
    });

    it("avviser locked: false", () => {
      // Lock-respons skal ALLTID være locked: true (literal)
      expect(() =>
        AdminLockUserResponseSchema.parse({
          id: "507f1f77bcf86cd799439011",
          locked: false,
          lockedAt: new Date(),
        }),
      ).toThrow();
    });
  });

  describe("AdminUnlockUserResponseSchema", () => {
    it("aksepterer unlock-respons", () => {
      const result = AdminUnlockUserResponseSchema.parse({
        id: "507f1f77bcf86cd799439011",
        locked: false,
      });
      expect(result.locked).toBe(false);
    });

    it("avviser locked: true", () => {
      expect(() =>
        AdminUnlockUserResponseSchema.parse({
          id: "507f1f77bcf86cd799439011",
          locked: true,
        }),
      ).toThrow();
    });
  });

  // ── ContactMessage-skjemaer ───────────────────────────────────────────────
  describe("ContactMessageStatusSchema", () => {
    it("aksepterer alle tre statuser", () => {
      expect(ContactMessageStatusSchema.parse("unread")).toBe("unread");
      expect(ContactMessageStatusSchema.parse("read")).toBe("read");
      expect(ContactMessageStatusSchema.parse("replied")).toBe("replied");
    });

    it("avviser ukjent status", () => {
      expect(() => ContactMessageStatusSchema.parse("archived")).toThrow();
    });
  });

  describe("AdminContactMessageSchema", () => {
    const validMessage = {
      id: "507f1f77bcf86cd799439011",
      navn: "Ola Nordmann",
      epost: "ola@example.com",
      emne: "Spørsmål om...",
      melding: "Hei, jeg lurer på...",
      attachmentCount: 0,
      status: "unread" as const,
      createdAt: new Date(),
    };

    it("aksepterer minimal melding", () => {
      const result = AdminContactMessageSchema.parse(validMessage);
      expect(result.status).toBe("unread");
      expect(result.attachmentCount).toBe(0);
    });

    it("aksepterer melding med vedlegg-summary", () => {
      const result = AdminContactMessageSchema.parse({
        ...validMessage,
        attachmentCount: 2,
        attachmentSummary: [
          { filnavn: "test.pdf", sizeBytes: 1024, mimeType: "application/pdf" },
          { filnavn: "img.jpg", sizeBytes: 2048, mimeType: "image/jpeg" },
        ],
      });
      expect(result.attachmentSummary).toHaveLength(2);
    });

    it("avviser ugyldig e-post", () => {
      expect(() =>
        AdminContactMessageSchema.parse({ ...validMessage, epost: "invalid" }),
      ).toThrow();
    });

    it("avviser negativ attachmentCount", () => {
      expect(() =>
        AdminContactMessageSchema.parse({ ...validMessage, attachmentCount: -1 }),
      ).toThrow();
    });
  });

  describe("AdminContactMessageQuerySchema", () => {
    it("aksepterer status 'all'", () => {
      const result = AdminContactMessageQuerySchema.parse({ status: "all" });
      expect(result.status).toBe("all");
    });

    it("aksepterer ContactMessageStatus", () => {
      const result = AdminContactMessageQuerySchema.parse({ status: "unread" });
      expect(result.status).toBe("unread");
    });

    it("aksepterer tomt object", () => {
      expect(AdminContactMessageQuerySchema.parse({})).toEqual({});
    });
  });

  describe("AdminContactMessageUpdateSchema", () => {
    it("krever status-felt", () => {
      expect(() => AdminContactMessageUpdateSchema.parse({})).toThrow();
    });

    it("aksepterer gyldig status", () => {
      const result = AdminContactMessageUpdateSchema.parse({ status: "replied" });
      expect(result.status).toBe("replied");
    });
  });

  // ── AdminAuditQuerySchema (utvidet med outcome + targetUserId) ────────────
  describe("AdminAuditQuerySchema", () => {
    it("aksepterer minimal query", () => {
      expect(AdminAuditQuerySchema.parse({})).toEqual({});
    });

    it("aksepterer outcome-filter", () => {
      const result = AdminAuditQuerySchema.parse({ outcome: "failure" });
      expect(result.outcome).toBe("failure");
    });

    it("avviser ugyldig outcome", () => {
      expect(() => AdminAuditQuerySchema.parse({ outcome: "pending" })).toThrow();
    });

    it("aksepterer targetUserId-filter", () => {
      const result = AdminAuditQuerySchema.parse({
        targetUserId: "507f1f77bcf86cd799439011",
      });
      expect(result.targetUserId).toBe("507f1f77bcf86cd799439011");
    });

    it("avviser targetUserId lengre enn 64 tegn", () => {
      expect(() =>
        AdminAuditQuerySchema.parse({ targetUserId: "x".repeat(65) }),
      ).toThrow();
    });
  });

  // ── AdminBrukerDetaljSchema (privacy-respekterende) ───────────────────────
  describe("AdminBrukerDetaljSchema", () => {
    const validDetalj = {
      id: "507f1f77bcf86cd799439011",
      email: "ola@example.com",
      rolle: "user" as const,
      opprettet: new Date(),
      oppdatert: new Date(),
      mfaEnabled: false,
      oauthAccountCount: 1,
      locked: false,
      deleted: false,
      canvasConnected: false,
      canvasUserCached: false,
      counts: {
        chatHistory: 5,
        sharedChats: 0,
        taskBreakdowns: 2,
        arbeidsplaner: 1,
        contentEmbeddings: 100,
        canvasStructures: 0,
        knowledgeBases: 0,
        knowledgeBaseChunks: 0,
        webPushSubscriptions: 1,
      },
      syncConflictCount: 0,
      recentAuditEntries: [],
      auditFailureCount30d: 0,
      notionConfigured: false,
    };

    it("aksepterer minimal detalj-respons", () => {
      const result = AdminBrukerDetaljSchema.parse(validDetalj);
      expect(result.locked).toBe(false);
      expect(result.counts.chatHistory).toBe(5);
    });

    it("aksepterer detalj med audit-historikk", () => {
      const result = AdminBrukerDetaljSchema.parse({
        ...validDetalj,
        recentAuditEntries: [
          {
            id: "audit1",
            action: "login",
            category: "auth",
            outcome: "success",
            createdAt: new Date(),
          },
        ],
      });
      expect(result.recentAuditEntries).toHaveLength(1);
    });

    it("avviser negative tellinger", () => {
      expect(() =>
        AdminBrukerDetaljSchema.parse({
          ...validDetalj,
          counts: { ...validDetalj.counts, chatHistory: -1 },
        }),
      ).toThrow();
    });

    it("avviser non-integer tellinger", () => {
      expect(() =>
        AdminBrukerDetaljSchema.parse({
          ...validDetalj,
          counts: { ...validDetalj.counts, chatHistory: 5.5 },
        }),
      ).toThrow();
    });

    it("aksepterer låst+slettet bruker (forensisk)", () => {
      const result = AdminBrukerDetaljSchema.parse({
        ...validDetalj,
        locked: true,
        lockedAt: new Date(),
        lockedReason: "spam",
        lockedBy: "admin-id",
        deleted: true,
        deletedAt: new Date(),
      });
      expect(result.locked).toBe(true);
      expect(result.deleted).toBe(true);
    });

    it("aksepterer Canvas-tilkobling med base URL", () => {
      const result = AdminBrukerDetaljSchema.parse({
        ...validDetalj,
        canvasConnected: true,
        canvasBaseUrl: "https://ntnu.instructure.com",
        canvasUserCached: true,
      });
      expect(result.canvasConnected).toBe(true);
    });
  });

  describe("AdminBrukerDetaljAuditEntrySchema", () => {
    it("aksepterer gyldig audit entry", () => {
      const result = AdminBrukerDetaljAuditEntrySchema.parse({
        id: "audit1",
        action: "user.login",
        category: "auth",
        outcome: "success",
        createdAt: new Date(),
      });
      expect(result.action).toBe("user.login");
    });

    it("avviser manglende felter", () => {
      expect(() =>
        AdminBrukerDetaljAuditEntrySchema.parse({
          id: "audit1",
          action: "user.login",
        }),
      ).toThrow();
    });
  });
});
