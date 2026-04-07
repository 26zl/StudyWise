/**
 * Kunnskapsbase – delte Zod-skjemaer og typer for personlige kunnskapsbaser.
 * Brukes av frontend og backend for validering av API-grenser.
 */

import { z } from "zod";

// ─── Konstantar ───────────────────────────────────────────

/** Maks antal baser per bruker */
export const KB_MAX_BASES_PER_USER = 20;

/** Maks antal lenker per base */
export const KB_MAX_LINKS_PER_BASE = 50;

/** Maks antal filer per base */
export const KB_MAX_FILES_PER_BASE = 30;

/** Maks filstørrelse i bytes (10 MB) */
export const KB_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maks lengde på basenavn */
export const KB_MAX_BASE_NAME_LENGTH = 100;

/** Maks lengde på lenketittel */
export const KB_MAX_LINK_TITLE_LENGTH = 200;

/** Maks lengde på URL */
export const KB_MAX_URL_LENGTH = 2000;

// ─── Crawl-konfigurasjon ──────────────────────────────────

/** Maks crawl-dybde (0 = kun seed-URL) */
export const KB_CRAWL_MAX_DEPTH = 2;

/** Maks antall HTML-sider per crawl */
export const KB_CRAWL_MAX_PAGES = 25;

/** Maks antall dokumenter (PDF, DOCX) per crawl */
export const KB_CRAWL_MAX_DOCUMENTS = 10;

/** Timeout per enkelt-request (ms) */
export const KB_CRAWL_REQUEST_TIMEOUT_MS = 15_000;

/** Maks total tid for en crawl-jobb (ms) */
export const KB_CRAWL_TOTAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutter

/** Concurrent requests under crawling */
export const KB_CRAWL_CONCURRENCY = 2;

/** Crawl-status-verdier */
export const KB_CRAWL_STATUS = {
  PENDING: "pending",
  CRAWLING: "crawling",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type KBCrawlStatus = (typeof KB_CRAWL_STATUS)[keyof typeof KB_CRAWL_STATUS];

/** Tillatte filtyper for opplasting */
export const KB_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

// ─── Skjemaer ─────────────────────────────────────────────

/** Opprett ny kunnskapsbase */
export const KBCreateBaseSchema = z.object({
  navn: z.string().trim().min(1, "Navn er påkrevd").max(KB_MAX_BASE_NAME_LENGTH),
});

/** Oppdater navn på kunnskapsbase */
export const KBUpdateBaseSchema = z.object({
  navn: z.string().trim().min(1, "Navn er påkrevd").max(KB_MAX_BASE_NAME_LENGTH),
});

/** Legg til lenke i base */
export const KBAddLinkSchema = z.object({
  url: z.string().url("Ugyldig URL").max(KB_MAX_URL_LENGTH),
  tittel: z.string().trim().max(KB_MAX_LINK_TITLE_LENGTH).optional(),
  /** Crawl-konfigurasjon (valgfritt) */
  crawlOptions: z
    .object({
      /** Maks dybde (0 = kun seed-URL, maks 3) */
      maxDepth: z.number().int().min(0).max(3).optional(),
      /** Maks antall sider å crawle */
      maxPages: z.number().int().min(1).max(50).optional(),
      /** Maks antall dokumenter (PDF, DOCX) */
      maxDocuments: z.number().int().min(0).max(20).optional(),
      /** Begrens til samme path-prefiks */
      samePathOnly: z.boolean().optional(),
      /** Include-patterns (regex-strenger) */
      includePatterns: z.array(z.string()).max(5).optional(),
      /** Exclude-patterns (regex-strenger) */
      excludePatterns: z.array(z.string()).max(5).optional(),
    })
    .optional(),
});

/** Lenke i respons */
export const KBLinkSchema = z.object({
  id: z.string(),
  url: z.string(),
  tittel: z.string(),
  opprettetDato: z.string(),
  /** Crawl-status */
  crawlStatus: z.enum(["pending", "crawling", "completed", "failed"]).optional(),
  /** Antall crawlede sider */
  crawledPages: z.number().optional(),
  /** Antall crawlede dokumenter */
  crawledDocuments: z.number().optional(),
  /** Feilmelding hvis crawl feilet */
  crawlError: z.string().optional(),
  /** Sist crawlet */
  lastCrawledAt: z.string().optional(),
});

/** Fil i respons */
export const KBFileSchema = z.object({
  id: z.string(),
  filnavn: z.string(),
  mimeType: z.string(),
  storrelse: z.number(),
  opprettetDato: z.string(),
});

/** Base i respons (oversikt) */
export const KBBaseSummarySchema = z.object({
  id: z.string(),
  navn: z.string(),
  antallLenker: z.number(),
  antallFiler: z.number(),
  opprettetDato: z.string(),
  oppdatertDato: z.string(),
});

/** Base med innhold (detaljer) */
export const KBBaseDetailSchema = z.object({
  id: z.string(),
  navn: z.string(),
  lenker: z.array(KBLinkSchema),
  filer: z.array(KBFileSchema),
  opprettetDato: z.string(),
  oppdatertDato: z.string(),
});

/** Liste over baser */
export const KBBaseListResponseSchema = z.object({
  baser: z.array(KBBaseSummarySchema),
});

// ─── Typer ────────────────────────────────────────────────

export type KBCreateBase = z.infer<typeof KBCreateBaseSchema>;
export type KBUpdateBase = z.infer<typeof KBUpdateBaseSchema>;
export type KBAddLink = z.infer<typeof KBAddLinkSchema>;
export type KBLink = z.infer<typeof KBLinkSchema>;
export type KBFile = z.infer<typeof KBFileSchema>;
export type KBBaseSummary = z.infer<typeof KBBaseSummarySchema>;
export type KBBaseDetail = z.infer<typeof KBBaseDetailSchema>;
export type KBBaseListResponse = z.infer<typeof KBBaseListResponseSchema>;
