/**
 * Tester for eksportskjemaer – lenker og segmentinvarianter.
 */

import { describe, it, expect } from "vitest";
import { ExportDocumentSchema, TextSegmentSchema } from "../export.js";

describe("TextSegmentSchema", () => {
  it("godtar lenkesegment med https-lenke", () => {
    const resultat = TextSegmentSchema.safeParse({
      text: "StudyWise",
      styles: ["link"],
      href: "https://studwise.page",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar lenkesegment med http-lenke", () => {
    const resultat = TextSegmentSchema.safeParse({
      text: "Lokal ressurs",
      styles: ["link"],
      href: "http://localhost:3000/docs",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser href uten link-stil", () => {
    const resultat = TextSegmentSchema.safeParse({
      text: "Ikke lenke",
      href: "https://example.com",
    });
    expect(resultat.success).toBe(false);
  });

  it("avviser link-stil uten href", () => {
    const resultat = TextSegmentSchema.safeParse({
      text: "Mangler href",
      styles: ["link"],
    });
    expect(resultat.success).toBe(false);
  });

  it("avviser javascript-lenke", () => {
    const resultat = TextSegmentSchema.safeParse({
      text: "Farlig lenke",
      styles: ["link"],
      href: "javascript:alert(1)",
    });
    expect(resultat.success).toBe(false);
  });
});

describe("ExportDocumentSchema", () => {
  it("godtar dokument med gyldig lenkesegment", () => {
    const resultat = ExportDocumentSchema.safeParse({
      title: "Eksport",
      blocks: [
        {
          type: "paragraph",
          segments: [
            { text: "Se " },
            {
              text: "dokumentasjonen",
              styles: ["link"],
              href: "https://example.com/docs",
            },
          ],
        },
      ],
    });
    expect(resultat.success).toBe(true);
  });
});
