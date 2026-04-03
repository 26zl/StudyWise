/**
 * Tester for document-modulen – DocumentParseResultSchema med superRefine-logikk.
 */

import { describe, it, expect } from "vitest";
import { DocumentParseResultSchema } from "../document.js";

describe("DocumentParseResultSchema", () => {
  it("godtar vellykket parsing uten error", () => {
    const resultat = DocumentParseResultSchema.safeParse({
      success: true,
      text: "Innhold fra PDF-dokument",
      pages: 5,
      fileType: "pdf",
      redacted: false,
      truncated: false,
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar vellykket parsing med warning", () => {
    const resultat = DocumentParseResultSchema.safeParse({
      success: true,
      text: "OCR-tekst",
      pages: 1,
      fileType: "image",
      redacted: false,
      truncated: false,
      warning: "Lav OCR-konfidens",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser vellykket parsing med error-felt satt", () => {
    const resultat = DocumentParseResultSchema.safeParse({
      success: true,
      text: "Innhold",
      pages: 1,
      fileType: "pdf",
      redacted: false,
      truncated: false,
      error: "Denne skal ikke være her",
    });
    expect(resultat.success).toBe(false);
  });

  it("godtar feilet parsing med error-melding", () => {
    const resultat = DocumentParseResultSchema.safeParse({
      success: false,
      text: "",
      pages: 0,
      fileType: "pdf",
      redacted: false,
      truncated: false,
      error: "Kunne ikke lese filen",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser feilet parsing uten error-melding", () => {
    const resultat = DocumentParseResultSchema.safeParse({
      success: false,
      text: "",
      pages: 0,
      fileType: "pdf",
      redacted: false,
      truncated: false,
    });
    expect(resultat.success).toBe(false);
  });

  it("avviser feilet parsing med tom error-streng", () => {
    const resultat = DocumentParseResultSchema.safeParse({
      success: false,
      text: "",
      pages: 0,
      fileType: "pdf",
      redacted: false,
      truncated: false,
      error: "   ",
    });
    expect(resultat.success).toBe(false);
  });

  it("avviser negative sidetall", () => {
    const resultat = DocumentParseResultSchema.safeParse({
      success: true,
      text: "Innhold",
      pages: -1,
      fileType: "pdf",
      redacted: false,
      truncated: false,
    });
    expect(resultat.success).toBe(false);
  });

  it("avviser tom fileType", () => {
    const resultat = DocumentParseResultSchema.safeParse({
      success: true,
      text: "Innhold",
      pages: 1,
      fileType: "",
      redacted: false,
      truncated: false,
    });
    expect(resultat.success).toBe(false);
  });
});
