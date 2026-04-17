/**
 * Tester for services/document.ts — magic byte-validering.
 *
 * Dette er den eneste forsvarslinjen mot polyglot-filer og MIME-spoofing.
 * Vi tester:
 *   - Korrekte magic bytes for hvert støttede format
 *   - Mismatch mellom deklarert MIME og faktisk innhold
 *   - Polyglot-forsøk (PDF maskert som JPG, ZIP som DOCX, etc.)
 *   - Edge cases: tomme buffere, for korte buffere, ukjente formater
 *   - text/* aksepterer kun ren tekst (ikke binært innhold)
 *   - Office ZIP-format-validering (DOCX/PPTX/XLSX deler PK-signatur)
 */
import { describe, it, expect } from "vitest";
import { validateFileMagicBytes } from "../../services/document.js";

// Hjelpefunksjoner for å bygge buffere med kjente magic bytes
const PDF_HEADER = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]); // JPEG/JFIF
const GIF_HEADER = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
const BMP_HEADER = Buffer.from([0x42, 0x4d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const WEBP_HEADER = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // size
  0x57, 0x45, 0x42, 0x50, // WEBP
]);
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK..
const DOC_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE2
const RTF_HEADER = Buffer.from([0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31]); // {\rtf1
const TIFF_LE_HEADER = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE_HEADER = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);

// Padder buffer til min 12 bytes (krav i getMimeFromMagicBytes)
function pad(buf: Buffer, totalLength = 16): Buffer {
  if (buf.length >= totalLength) return buf;
  return Buffer.concat([buf, Buffer.alloc(totalLength - buf.length)]);
}

// Lager en minimal "DOCX"-buffer som inneholder PK-signatur + word/-mappe-referanse
function makeFakeDocxBuffer(): Buffer {
  const header = ZIP_HEADER;
  const filler = Buffer.alloc(20);
  // ZIP central directory har filenames som ASCII-strenger — for testen
  // legger vi inn "word/document.xml" i bufferen så `latin1`-søket finner "word/"
  const internal = Buffer.from("word/document.xml" + "\0".repeat(50), "latin1");
  return Buffer.concat([header, filler, internal]);
}

function makeFakeXlsxBuffer(): Buffer {
  const header = ZIP_HEADER;
  const filler = Buffer.alloc(20);
  const internal = Buffer.from("xl/workbook.xml" + "\0".repeat(50), "latin1");
  return Buffer.concat([header, filler, internal]);
}

function makeFakePptxBuffer(): Buffer {
  const header = ZIP_HEADER;
  const filler = Buffer.alloc(20);
  const internal = Buffer.from("ppt/presentation.xml" + "\0".repeat(50), "latin1");
  return Buffer.concat([header, filler, internal]);
}

describe("validateFileMagicBytes", () => {
  // ── Happy path: matching magic bytes ──────────────────────────────────────
  describe("happy path — matching MIME and magic bytes", () => {
    it("aksepterer PDF med riktig signatur", () => {
      expect(validateFileMagicBytes(pad(PDF_HEADER), "application/pdf")).toBeNull();
    });

    it("aksepterer PNG", () => {
      expect(validateFileMagicBytes(pad(PNG_HEADER), "image/png")).toBeNull();
    });

    it("aksepterer JPEG", () => {
      expect(validateFileMagicBytes(pad(JPEG_HEADER), "image/jpeg")).toBeNull();
    });

    it("aksepterer GIF", () => {
      expect(validateFileMagicBytes(pad(GIF_HEADER), "image/gif")).toBeNull();
    });

    it("aksepterer BMP", () => {
      expect(validateFileMagicBytes(pad(BMP_HEADER), "image/bmp")).toBeNull();
    });

    it("aksepterer WebP (RIFF + WEBP-marker)", () => {
      expect(validateFileMagicBytes(pad(WEBP_HEADER), "image/webp")).toBeNull();
    });

    it("aksepterer TIFF little-endian", () => {
      expect(validateFileMagicBytes(pad(TIFF_LE_HEADER), "image/tiff")).toBeNull();
    });

    it("aksepterer TIFF big-endian", () => {
      expect(validateFileMagicBytes(pad(TIFF_BE_HEADER), "image/tiff")).toBeNull();
    });

    it("aksepterer DOCX (ZIP + word/-mappe)", () => {
      expect(
        validateFileMagicBytes(
          makeFakeDocxBuffer(),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).toBeNull();
    });

    it("aksepterer XLSX (ZIP + xl/-mappe)", () => {
      expect(
        validateFileMagicBytes(
          makeFakeXlsxBuffer(),
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
      ).toBeNull();
    });

    it("aksepterer PPTX (ZIP + ppt/-mappe)", () => {
      expect(
        validateFileMagicBytes(
          makeFakePptxBuffer(),
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
      ).toBeNull();
    });

    it("aksepterer eldre .doc (OLE2-signatur)", () => {
      expect(validateFileMagicBytes(pad(DOC_HEADER), "application/msword")).toBeNull();
    });

    it("aksepterer RTF (selv om magic bytes ikke matcher Wikipedia eksakt)", () => {
      expect(validateFileMagicBytes(pad(RTF_HEADER), "application/rtf")).toBeNull();
    });
  });

  // ── MIME-spoofing / mismatch ──────────────────────────────────────────────
  describe("MIME spoofing detection", () => {
    it("avviser PDF deklarert som image/png", () => {
      const result = validateFileMagicBytes(pad(PDF_HEADER), "image/png");
      expect(result).toContain("matcher ikke");
      expect(result).toContain("application/pdf");
    });

    it("avviser PNG deklarert som application/pdf", () => {
      const result = validateFileMagicBytes(pad(PNG_HEADER), "application/pdf");
      expect(result).toContain("matcher ikke");
    });

    it("avviser JPEG deklarert som image/png", () => {
      const result = validateFileMagicBytes(pad(JPEG_HEADER), "image/png");
      expect(result).toContain("matcher ikke");
    });

    it("avviser ZIP deklarert som PDF", () => {
      const result = validateFileMagicBytes(pad(ZIP_HEADER), "application/pdf");
      expect(result).toContain("matcher ikke");
    });

    it("avviser eldre .doc deklarert som DOCX (OLE2 vs PK)", () => {
      const result = validateFileMagicBytes(
        pad(DOC_HEADER),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(result).toContain("matcher ikke");
    });
  });

  // ── Polyglot detection ────────────────────────────────────────────────────
  describe("polyglot file detection", () => {
    it("avviser PDF deklarert som JPEG (klassisk polyglot)", () => {
      // En polyglot-fil starter typisk med PDF-header for å bli kjørt som PDF
      // men er deklarert som bildet for å passere bilde-uploads
      const result = validateFileMagicBytes(pad(PDF_HEADER), "image/jpeg");
      expect(result).toContain("matcher ikke");
    });

    it("avviser ZIP deklarert som image/png (zip-bombe via bilde-upload)", () => {
      const result = validateFileMagicBytes(pad(ZIP_HEADER), "image/png");
      expect(result).toContain("matcher ikke");
    });

    it("avviser DOCX-buffer deklarert som ekte XLSX (intern struktur sjekk)", () => {
      // ZIP-headeren er den samme, men intern struktur skal avsløre formatet
      const docxBuf = makeFakeDocxBuffer();
      const result = validateFileMagicBytes(
        docxBuf,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(result).toContain("xl/");
    });

    it("avviser XLSX-buffer deklarert som ekte DOCX", () => {
      const xlsxBuf = makeFakeXlsxBuffer();
      const result = validateFileMagicBytes(
        xlsxBuf,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      expect(result).toContain("word/");
    });
  });

  // ── text/* validering ─────────────────────────────────────────────────────
  describe("text/* MIME types", () => {
    it("aksepterer ren tekst som text/plain", () => {
      const buf = Buffer.from("Dette er en helt vanlig tekstfil med flere tegn.");
      expect(validateFileMagicBytes(buf, "text/plain")).toBeNull();
    });

    it("aksepterer ren tekst som text/markdown", () => {
      const buf = Buffer.from("# Markdown header\n\nNoe innhold her.");
      expect(validateFileMagicBytes(buf, "text/markdown")).toBeNull();
    });

    it("aksepterer ren tekst som text/csv", () => {
      const buf = Buffer.from("col1,col2,col3\n1,2,3\n4,5,6\n");
      expect(validateFileMagicBytes(buf, "text/csv")).toBeNull();
    });

    it("avviser PDF-innhold deklarert som text/plain", () => {
      const result = validateFileMagicBytes(pad(PDF_HEADER), "text/plain");
      expect(result).toContain("binært");
      expect(result).toContain("application/pdf");
    });

    it("avviser PNG-innhold deklarert som text/markdown", () => {
      const result = validateFileMagicBytes(pad(PNG_HEADER), "text/markdown");
      expect(result).toContain("binært");
    });

    it("avviser DOCX-innhold deklarert som text/csv", () => {
      const result = validateFileMagicBytes(makeFakeDocxBuffer(), "text/csv");
      expect(result).toContain("binært");
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("returnerer feil ved buffer kortere enn 12 bytes for binær type", () => {
      const buf = Buffer.from([0x25, 0x50]); // "%P" — for kort
      const result = validateFileMagicBytes(buf, "application/pdf");
      expect(result).toContain("Kunne ikke bekrefte");
    });

    it("aksepterer kort buffer for text/plain (ingen magic-byte-krav)", () => {
      const buf = Buffer.from("hi");
      expect(validateFileMagicBytes(buf, "text/plain")).toBeNull();
    });

    it("aksepterer tom buffer for text/plain", () => {
      expect(validateFileMagicBytes(Buffer.alloc(0), "text/plain")).toBeNull();
    });

    it("returnerer feil ved tom buffer for binær type", () => {
      const result = validateFileMagicBytes(Buffer.alloc(0), "application/pdf");
      expect(result).toContain("Kunne ikke bekrefte");
    });

    it("aksepterer RTF også uten magic bytes (legacy unntak)", () => {
      const garbageBuf = pad(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
      // RTF har egen unntakslogikk — skal ikke kaste feil
      expect(validateFileMagicBytes(garbageBuf, "application/rtf")).toBeNull();
    });

    it("returnerer feil for ukjent binær type uten kjent signatur", () => {
      const garbageBuf = pad(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
      const result = validateFileMagicBytes(garbageBuf, "application/octet-stream");
      expect(result).toContain("Kunne ikke bekrefte");
    });

    it("er case-insensitive på MIME-deklarasjonen", () => {
      expect(validateFileMagicBytes(pad(PDF_HEADER), "APPLICATION/PDF")).toBeNull();
      expect(validateFileMagicBytes(pad(PNG_HEADER), "Image/PNG")).toBeNull();
    });

    it("trimmer whitespace fra MIME-deklarasjonen", () => {
      expect(validateFileMagicBytes(pad(PDF_HEADER), "  application/pdf  ")).toBeNull();
    });

    it("avviser RIFF som ikke er WebP (RIFF brukes også av WAV/AVI)", () => {
      // RIFF med "WAVE" istedenfor "WEBP"
      const wavLike = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00,
        0x57, 0x41, 0x56, 0x45, // WAVE
      ]);
      const result = validateFileMagicBytes(wavLike, "image/webp");
      // Skal ikke kjenne igjen som WebP siden WEBP-markøren mangler
      expect(result).toContain("Kunne ikke bekrefte");
    });
  });
});

// ── sanitizeText: PII-maskering via parseDocument ───────────────────────────
// sanitizeText er intern, men kjøres som del av parseDocument for tekst-innhold.
// Vi tester gjennom parseDocument med en text/plain-buffer.
describe("sanitizeText via parseDocument (PII-maskering)", () => {
  // parseDocument importeres lazy for å unngå sirkulære import-sekvenser i testen
  async function parse(text: string) {
    const { parseDocument } = await import("../../services/document.js");
    const buf = Buffer.from(text, "utf-8");
    return parseDocument(buf, "text/plain", "test.txt");
  }

  describe("personnavn-maskering", () => {
    it("maskerer navn etter 'Mvh'", async () => {
      const r = await parse("Takk for hjelpen.\n\nMvh Ola Nordmann");
      expect(r.success).toBe(true);
      expect(r.text).toContain("[REDACTED_NAME]");
      expect(r.text).not.toContain("Ola Nordmann");
      expect(r.redacted).toBe(true);
    });

    it("maskerer navn etter 'Med vennlig hilsen'", async () => {
      const r = await parse("Bla bla.\n\nMed vennlig hilsen, Kari Nordmann");
      expect(r.text).toContain("[REDACTED_NAME]");
      expect(r.text).not.toContain("Kari Nordmann");
    });

    it("maskerer navn i 'Navn:'-felt", async () => {
      const r = await parse("Navn: Ola Nordmann\nKurs: INF101");
      expect(r.text).toContain("[REDACTED_NAME]");
      expect(r.text).not.toContain("Ola Nordmann");
    });

    it("maskerer navn i 'Student:'-felt", async () => {
      const r = await parse("Student: Kari Nordmann");
      expect(r.text).toContain("[REDACTED_NAME]");
    });

    it("maskerer navn etter 'Skrevet av'", async () => {
      const r = await parse("Skrevet av Ola Nordmann, 2026");
      expect(r.text).toContain("[REDACTED_NAME]");
      expect(r.text).not.toContain("Ola Nordmann");
    });

    it("maskerer doble fornavn/etternavn-kombinasjoner", async () => {
      const r = await parse("Mvh Ola Per Nordmann");
      expect(r.text).toContain("[REDACTED_NAME]");
      expect(r.text).not.toContain("Ola Per Nordmann");
    });

    it("maskerer engelsk 'Regards' + navn", async () => {
      const r = await parse("Thanks.\n\nRegards, John Smith");
      expect(r.text).toContain("[REDACTED_NAME]");
      expect(r.text).not.toContain("John Smith");
    });

    it("rører ikke faglig innhold uten navn-kontekst", async () => {
      const r = await parse("VRIO-modellen består av Value, Rarity, Imitability og Organization.");
      expect(r.text).toContain("VRIO");
      expect(r.text).toContain("Value");
      expect(r.text).not.toContain("[REDACTED_NAME]");
    });
  });

  describe("studentnummer-maskering krever kontekst", () => {
    it("maskerer 's123456'", async () => {
      const r = await parse("Studentnr s123456 leverte inn.");
      expect(r.text).toContain("[REDACTED_STUDENT_ID]");
      expect(r.text).not.toContain("s123456");
    });

    it("maskerer 'studentnr: 1234567'", async () => {
      const r = await parse("studentnr: 1234567");
      expect(r.text).toContain("[REDACTED_STUDENT_ID]");
    });

    it("maskerer IKKE vilkårlige 7-sifrede tall uten kontekst", async () => {
      const r = await parse("Port 8080 og timeout 1234567 ms.");
      expect(r.text).not.toContain("[REDACTED_STUDENT_ID]");
      expect(r.text).toContain("1234567");
    });
  });
});
