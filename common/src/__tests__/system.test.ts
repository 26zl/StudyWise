/**
 * Tester for common/system.ts — schemaer for systemstatus og globale meldinger.
 *
 * Viktigste invariant: `AdminAnnouncementStateSchema` må tillate tom `melding`
 * når `active: false` (siden admin-panelets GET-respons returnerer en tom
 * "ingen melding publisert"-tilstand), mens `SystemAnnouncementSchema` (brukt
 * av public banner) må kreve ikke-tom melding.
 */
import { describe, it, expect } from "vitest";
import {
  SystemAnnouncementSchema,
  AdminAnnouncementStateSchema,
  PublishAnnouncementRequestSchema,
  AnnouncementResponseSchema,
  DependenciesHealthSchema,
} from "../system.js";

describe("SystemAnnouncementSchema", () => {
  it("aksepterer en gyldig aktiv melding", () => {
    const result = SystemAnnouncementSchema.safeParse({
      active: true,
      severity: "warning",
      melding: "KI-tjenesten er utilgjengelig",
      oppdatertAt: "2026-04-17T12:00:00.000Z",
      dismissible: true,
    });
    expect(result.success).toBe(true);
  });

  it("avviser tom melding (public banner skal aldri rendre tom streng)", () => {
    const result = SystemAnnouncementSchema.safeParse({
      active: false,
      severity: "info",
      melding: "",
      oppdatertAt: "2026-04-17T12:00:00.000Z",
      dismissible: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("AdminAnnouncementStateSchema", () => {
  it("aksepterer 'ingen melding publisert'-tilstand fra admin-GET", () => {
    // Backend returnerer dette når det ikke finnes noen rad i DB —
    // admin-panelet skal kunne parse det og vise tom form.
    const result = AdminAnnouncementStateSchema.safeParse({
      active: false,
      severity: "info",
      melding: "",
      oppdatertAt: new Date(0).toISOString(),
      dismissible: true,
    });
    expect(result.success).toBe(true);
  });

  it("aksepterer en aktiv melding", () => {
    const result = AdminAnnouncementStateSchema.safeParse({
      active: true,
      severity: "critical",
      melding: "Databasen er nede",
      oppdatertAt: "2026-04-17T12:00:00.000Z",
      dismissible: false,
    });
    expect(result.success).toBe(true);
  });

  it("avviser melding over 500 tegn", () => {
    const result = AdminAnnouncementStateSchema.safeParse({
      active: true,
      severity: "info",
      melding: "a".repeat(501),
      oppdatertAt: "2026-04-17T12:00:00.000Z",
      dismissible: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("PublishAnnouncementRequestSchema", () => {
  it("krever ikke-tom melding ved publisering", () => {
    const result = PublishAnnouncementRequestSchema.safeParse({
      severity: "info",
      melding: "",
      dismissible: true,
    });
    expect(result.success).toBe(false);
  });

  it("defaulter dismissible til true", () => {
    const result = PublishAnnouncementRequestSchema.safeParse({
      severity: "info",
      melding: "Vedlikehold pågår",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dismissible).toBe(true);
    }
  });

  it("trimmer whitespace og avviser hvis kun whitespace", () => {
    const result = PublishAnnouncementRequestSchema.safeParse({
      severity: "info",
      melding: "   ",
      dismissible: true,
    });
    expect(result.success).toBe(false);
  });
});

describe("AnnouncementResponseSchema (public)", () => {
  it("aksepterer 'ingen aktiv melding'-indikator", () => {
    const result = AnnouncementResponseSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
  });

  it("aksepterer en aktiv melding", () => {
    const result = AnnouncementResponseSchema.safeParse({
      active: true,
      severity: "warning",
      melding: "Vedlikehold pågår",
      oppdatertAt: "2026-04-17T12:00:00.000Z",
      dismissible: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("DependenciesHealthSchema", () => {
  it("aksepterer full helserespons med alle 7 tjenester", () => {
    const result = DependenciesHealthSchema.safeParse({
      ok: true,
      type: "dependencies",
      timestamp: "2026-04-17T12:00:00.000Z",
      checkedAt: "2026-04-17T12:00:00.000Z",
      dependencies: {
        mongo: { ok: true, status: "up", critical: true },
        redis: { ok: true, status: "up", critical: false },
        bullmq: { ok: true, status: "up", critical: false },
        anthropic: { ok: true, status: "up", critical: true },
        cohere: { ok: true, status: "up", critical: false },
        clerk: { ok: true, status: "up", critical: true },
        pinecone: { ok: true, status: "up", critical: false },
      },
    });
    expect(result.success).toBe(true);
  });

  it("aksepterer nullbar checkedAt (før første sjekk)", () => {
    const result = DependenciesHealthSchema.safeParse({
      ok: false,
      type: "dependencies",
      timestamp: "2026-04-17T12:00:00.000Z",
      checkedAt: null,
      dependencies: {
        mongo: { ok: true, status: "up", critical: true },
        redis: { ok: false, status: "down", critical: false },
        bullmq: { ok: null, status: "unknown", critical: false },
        anthropic: { ok: true, status: "up", critical: true },
        cohere: { ok: true, status: "up", critical: false },
        clerk: { ok: null, status: "unknown", critical: true },
        pinecone: { ok: null, status: "unknown", critical: false },
      },
    });
    expect(result.success).toBe(true);
  });
});
