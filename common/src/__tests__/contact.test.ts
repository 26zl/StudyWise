/**
 * Tester for contact-modulen – kontaktskjema, vedlegg og konstanter.
 */

import { describe, it, expect } from "vitest";
import {
  KontaktRequestSchema,
  KontaktAttachmentSchema,
  KONTAKT_ALLOWED_ATTACHMENT_TYPES,
  KONTAKT_MAX_ATTACHMENTS,
  KONTAKT_MAX_ATTACHMENT_SIZE_BYTES,
} from "../contact.js";

// ─── Konstanter ─────────────────────────────────────────────────────────────

describe("Kontakt-konstanter", () => {
  it("KONTAKT_MAX_ATTACHMENTS er 3", () => {
    expect(KONTAKT_MAX_ATTACHMENTS).toBe(3);
  });

  it("KONTAKT_MAX_ATTACHMENT_SIZE_BYTES er 5 MB", () => {
    expect(KONTAKT_MAX_ATTACHMENT_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("KONTAKT_ALLOWED_ATTACHMENT_TYPES inneholder bildtyper", () => {
    expect(KONTAKT_ALLOWED_ATTACHMENT_TYPES).toContain("image/jpeg");
    expect(KONTAKT_ALLOWED_ATTACHMENT_TYPES).toContain("image/png");
    expect(KONTAKT_ALLOWED_ATTACHMENT_TYPES).toContain("image/webp");
  });
});

// ─── KontaktRequestSchema ───────────────────────────────────────────────────

describe("KontaktRequestSchema", () => {
  const gyldig = {
    navn: "Ola Nordmann",
    epost: "ola@example.com",
    emne: "Spørsmål om appen",
    melding: "Hei, jeg lurer på noe viktig om StudyWise.",
    turnstileToken: "gyldig-token-123",
  };

  it("godtar gyldig forespørsel", () => {
    expect(KontaktRequestSchema.safeParse(gyldig).success).toBe(true);
  });

  it("avviser manglende navn", () => {
    const { navn: _, ...uten } = gyldig;
    expect(KontaktRequestSchema.safeParse(uten).success).toBe(false);
  });

  it("avviser for kort navn (under 2 tegn)", () => {
    expect(
      KontaktRequestSchema.safeParse({ ...gyldig, navn: "O" }).success,
    ).toBe(false);
  });

  it("avviser manglende epost", () => {
    const { epost: _, ...uten } = gyldig;
    expect(KontaktRequestSchema.safeParse(uten).success).toBe(false);
  });

  it("avviser ugyldig epost", () => {
    expect(
      KontaktRequestSchema.safeParse({ ...gyldig, epost: "ikke-epost" }).success,
    ).toBe(false);
  });

  it("avviser for kort emne (under 3 tegn)", () => {
    expect(
      KontaktRequestSchema.safeParse({ ...gyldig, emne: "Hi" }).success,
    ).toBe(false);
  });

  it("avviser for kort melding (under 10 tegn)", () => {
    expect(
      KontaktRequestSchema.safeParse({ ...gyldig, melding: "Kort" }).success,
    ).toBe(false);
  });

  it("avviser melding over 5000 tegn", () => {
    expect(
      KontaktRequestSchema.safeParse({ ...gyldig, melding: "a".repeat(5001) }).success,
    ).toBe(false);
  });

  it("avviser manglende turnstileToken", () => {
    const { turnstileToken: _, ...uten } = gyldig;
    expect(KontaktRequestSchema.safeParse(uten).success).toBe(false);
  });

  it("avviser tom turnstileToken", () => {
    expect(
      KontaktRequestSchema.safeParse({ ...gyldig, turnstileToken: "" }).success,
    ).toBe(false);
  });

  it("godtar valgfri nettsted (honeypot)", () => {
    const resultat = KontaktRequestSchema.safeParse({ ...gyldig, nettsted: "" });
    expect(resultat.success).toBe(true);
  });

  it("godtar valgfri sideUrl", () => {
    const resultat = KontaktRequestSchema.safeParse({
      ...gyldig,
      sideUrl: "https://studywize.page/kontakt",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser ugyldig sideUrl", () => {
    expect(
      KontaktRequestSchema.safeParse({ ...gyldig, sideUrl: "ftp://ugyldig" }).success,
    ).toBe(false);
  });
});

// ─── KontaktAttachmentSchema ────────────────────────────────────────────────

describe("KontaktAttachmentSchema", () => {
  it("godtar gyldig vedlegg", () => {
    const resultat = KontaktAttachmentSchema.safeParse({
      filnavn: "bilde.png",
      mimeType: "image/png",
      størrelse: 1024,
      innholdBase64: "iVBORw0KGgoAAAANS...",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar alle tillatte MIME-typer", () => {
    for (const type of KONTAKT_ALLOWED_ATTACHMENT_TYPES) {
      const resultat = KontaktAttachmentSchema.safeParse({
        filnavn: "fil.ext",
        mimeType: type,
        størrelse: 100,
        innholdBase64: "data",
      });
      expect(resultat.success).toBe(true);
    }
  });

  it("avviser ugyldig MIME-type", () => {
    expect(
      KontaktAttachmentSchema.safeParse({
        filnavn: "dokument.pdf",
        mimeType: "application/pdf",
        størrelse: 1024,
        innholdBase64: "data",
      }).success,
    ).toBe(false);
  });

  it("avviser størrelse over 5 MB", () => {
    expect(
      KontaktAttachmentSchema.safeParse({
        filnavn: "stor.png",
        mimeType: "image/png",
        størrelse: KONTAKT_MAX_ATTACHMENT_SIZE_BYTES + 1,
        innholdBase64: "data",
      }).success,
    ).toBe(false);
  });

  it("avviser tom filnavn", () => {
    expect(
      KontaktAttachmentSchema.safeParse({
        filnavn: "",
        mimeType: "image/png",
        størrelse: 100,
        innholdBase64: "data",
      }).success,
    ).toBe(false);
  });

  it("avviser tom innholdBase64", () => {
    expect(
      KontaktAttachmentSchema.safeParse({
        filnavn: "bilde.png",
        mimeType: "image/png",
        størrelse: 100,
        innholdBase64: "",
      }).success,
    ).toBe(false);
  });

  it("avviser størrelse 0 (must be positive)", () => {
    expect(
      KontaktAttachmentSchema.safeParse({
        filnavn: "bilde.png",
        mimeType: "image/png",
        størrelse: 0,
        innholdBase64: "data",
      }).success,
    ).toBe(false);
  });
});
