/**
 * ExternalUrl Crawler Service
 *
 * Henter innhold fra eksterne URL-er i Canvas-kurs og indekserer til Pinecone.
 * Kjøres etter Canvas sync har oppdatert MongoDB.
 *
 * Funksjoner:
 * - Henter HTML med timeout og User-Agent
 * - Parser med cheerio for ren tekst (fjerner nav, footer, scripts, styles)
 * - Oppdager PDF-lenker og indekserer dem
 * - Bruker eksisterende chunking og Pinecone upsert
 * - Hopper over uendret innhold basert på hash-sammenligning
 */

import crypto from "crypto";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { logger } from "../utils/logger.js";
import {
  CanvasStructureModel,
  type ICanvasStructure,
} from "../database/models/CanvasStructure.js";
import { createChunksFromContent } from "./chunk.service.js";
import {
  upsertStoredFileContent,
  isEmbeddingAvailable,
} from "./embedding.service.js";
import { parseDocument } from "./document.js";

// ─── Konstanter ────────────────────────────────────────────

/** Timeout for HTTP-forespørsler (ms) */
const FETCH_TIMEOUT_MS = 15000;

/** Maks samtidige URL-hentinger */
const CRAWLER_CONCURRENCY = 3;

/** Maks PDF-er per ekstern side */
const MAX_PDFS_PER_PAGE = 5;

/** Maks størrelse på PDF-fil (10 MB) */
const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

/** User-Agent for crawler-forespørsler */
const CRAWLER_USER_AGENT = "StudyWise/1.0 ExternalUrl-Crawler";

// ─── Typer ─────────────────────────────────────────────────

export interface CrawlResult {
  /** Antall URL-er som ble crawlet */
  crawled: number;
  /** Antall URL-er som var uendret (hoppet over) */
  skipped: number;
  /** Antall URL-er som feilet */
  failed: number;
  /** Antall PDF-er som ble indeksert */
  pdfsIndexed: number;
}

interface CrawlCourseExternalUrlsInput {
  userId: string;
  courseId: string;
  courseName: string;
  moduler: Array<{
    id: number;
    name: string;
    items?: Array<{
      id?: number;
      title: string;
      type: string;
      external_url?: string;
      contentHash?: string;
      crawledHash?: string;
      crawledAt?: Date;
      crawledPdfs?: string[];
    }>;
  }>;
}

interface ExternalUrlItem {
  moduleId: number;
  moduleName: string;
  itemId: number;
  title: string;
  externalUrl: string;
  contentHash?: string;
  crawledHash?: string;
  crawledAt?: Date;
  crawledPdfs?: string[];
}

interface CrawlExternalUrlOptions {
  changedItemIds?: Set<number>;
}

type FetchExternalResult =
  | { kind: "html"; html: string }
  | { kind: "pdf"; buffer: Buffer }
  | { kind: "skip" }
  | { kind: "failed" };

// ─── Hjelpefunksjoner ──────────────────────────────────────

/**
 * Genererer SHA-256 hash av en streng.
 */
function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Henter HTML fra en URL med timeout.
 */
async function fetchExternalContent(url: string): Promise<FetchExternalResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": CRAWLER_USER_AGENT },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { url, status: response.status },
        "ExternalUrl henting feilet",
      );
      return { kind: "failed" };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/pdf")) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return { kind: "pdf", buffer };
    }
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      logger.info(
        { url, contentType },
        "ExternalUrl er ikke HTML — hopper over",
      );
      return { kind: "skip" };
    }

    return { kind: "html", html: await response.text() };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn({ url }, "ExternalUrl crawl tidsavbrutt");
    } else {
      logger.warn({ err: error, url }, "Feil ved henting av ExternalUrl");
    }
    return { kind: "failed" };
  }
}

/**
 * Parser HTML og ekstraherer ren tekst.
 * Fjerner nav, footer, header, scripts, styles og andre uønskede elementer.
 */
function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);

  // Fjern uønskede elementer
  $("script, style, noscript, nav, footer, header, aside, iframe, form").remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  $(".nav, .navbar, .footer, .header, .sidebar, .menu, .advertisement, .ad").remove();

  // Hent hovedinnholdet
  let content = "";
  const mainSelectors = ["main", "article", '[role="main"]', ".content", "#content", ".main"];

  for (const selector of mainSelectors) {
    const main = $(selector);
    if (main.length > 0) {
      content = main.text();
      break;
    }
  }

  // Fallback til body hvis ingen hovedinnhold ble funnet
  if (!content.trim()) {
    content = $("body").text();
  }

  // Rens teksten
  return content
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

/**
 * Finner alle PDF-lenker på en side.
 */
function findPdfLinks(html: string, baseUrl: string): Array<{ url: string; title: string }> {
  const $ = cheerio.load(html);
  const pdfLinks: Array<{ url: string; title: string }> = [];
  const seenUrls = new Set<string>();

  $('a[href$=".pdf"], a[href*=".pdf?"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      // Løs relativ URL mot base URL
      const absoluteUrl = new URL(href, baseUrl).toString();

      // Unngå duplikater
      if (seenUrls.has(absoluteUrl)) return;
      seenUrls.add(absoluteUrl);

      // Hent tittel fra lenketekst eller filnavn
      let title = $(el).text().trim();
      if (!title) {
        const urlPath = new URL(absoluteUrl).pathname;
        title = decodeURIComponent(urlPath.split("/").pop() ?? "dokument.pdf");
      }

      pdfLinks.push({ url: absoluteUrl, title });
    } catch {
      // Ugyldig URL — ignorer
    }
  });

  return pdfLinks.slice(0, MAX_PDFS_PER_PAGE);
}

/**
 * Laster ned og prosesserer en PDF-fil.
 */
async function downloadAndProcessPdf(
  pdfUrl: string,
): Promise<{ content: string; hash: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 2);

  try {
    const response = await fetch(pdfUrl, {
      signal: controller.signal,
      headers: { "User-Agent": CRAWLER_USER_AGENT },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { url: pdfUrl, status: response.status },
        "PDF-nedlasting feilet",
      );
      return null;
    }

    // Sjekk størrelse via Content-Length header
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_PDF_SIZE_BYTES) {
      logger.warn(
        { url: pdfUrl, size: contentLength },
        "PDF for stor — hopper over",
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Dobbeltsjekk størrelse etter nedlasting
    if (buffer.length > MAX_PDF_SIZE_BYTES) {
      logger.warn(
        { url: pdfUrl, size: buffer.length },
        "PDF for stor — hopper over",
      );
      return null;
    }

    return parsePdfBuffer(buffer, pdfUrl);
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      logger.warn({ url: pdfUrl }, "PDF-nedlasting tidsavbrutt");
    } else {
      logger.warn({ err: error, url: pdfUrl }, "Feil ved PDF-nedlasting");
    }
    return null;
  }
}

async function parsePdfBuffer(
  buffer: Buffer,
  sourceUrl: string,
): Promise<{ content: string; hash: string } | null> {
  const result = await parseDocument(buffer, "application/pdf", "external.pdf");
  if (!result.success || !result.text.trim()) {
    logger.info({ url: sourceUrl }, "PDF inneholder ingen lesbar tekst");
    return null;
  }
  const hash = sha256(result.text);
  return { content: result.text, hash };
}

// ─── Hovedfunksjoner ───────────────────────────────────────

/**
 * Crawler alle ExternalUrl-items i et kurs og indekserer innhold til Pinecone.
 *
 * @param courseDoc - Canvas-strukturdokument fra MongoDB
 * @param changedItemIds - Set med item-ID-er som har endret contentHash (valgfritt)
 */
export async function crawlCourseExternalUrls(
  courseDoc: ICanvasStructure | CrawlCourseExternalUrlsInput,
  options?: CrawlExternalUrlOptions,
): Promise<CrawlResult> {
  const result: CrawlResult = {
    crawled: 0,
    skipped: 0,
    failed: 0,
    pdfsIndexed: 0,
  };

  if (!isEmbeddingAvailable()) {
    logger.info(
      { courseId: courseDoc.courseId },
      "Pinecone ikke tilgjengelig — hopper over ExternalUrl-crawling",
    );
    return result;
  }

  // Samle alle ExternalUrl-items
  const externalItems: ExternalUrlItem[] = [];
  for (const mod of courseDoc.moduler ?? []) {
    for (const item of mod.items ?? []) {
      if (item.type === "ExternalUrl" && item.external_url && item.id != null) {
        // Hvis changedItemIds er gitt, kun crawler endrede items
        if (options?.changedItemIds && !options.changedItemIds.has(item.id)) {
          result.skipped++;
          continue;
        }

        externalItems.push({
          moduleId: mod.id,
          moduleName: mod.name,
          itemId: item.id,
          title: item.title,
          externalUrl: item.external_url,
          contentHash: item.contentHash,
          crawledHash: item.crawledHash,
          crawledAt: item.crawledAt,
          crawledPdfs: item.crawledPdfs,
        });
      }
    }
  }

  if (externalItems.length === 0) {
    logger.info(
      { courseId: courseDoc.courseId },
      "Ingen ExternalUrl-items å crawle",
    );
    return result;
  }

  logger.info(
    { courseId: courseDoc.courseId, itemCount: externalItems.length },
    "Starter ExternalUrl-crawling for kurs",
  );

  const limit = pLimit(CRAWLER_CONCURRENCY);

  await Promise.allSettled(
    externalItems.map((item) =>
      limit(async () => {
        const crawlItemResult = await crawlExternalUrlItem(
          courseDoc.userId,
          courseDoc.courseId,
          courseDoc.courseName,
          item,
        );

        result.crawled += crawlItemResult.crawled;
        result.skipped += crawlItemResult.skipped;
        result.failed += crawlItemResult.failed;
        result.pdfsIndexed += crawlItemResult.pdfsIndexed;
      }),
    ),
  );

  logger.info(
    {
      courseId: courseDoc.courseId,
      ...result,
    },
    "ExternalUrl-crawling fullført for kurs",
  );

  return result;
}

/**
 * Crawler én ExternalUrl-item.
 */
async function crawlExternalUrlItem(
  userId: string,
  courseId: string,
  courseName: string,
  item: ExternalUrlItem,
): Promise<CrawlResult> {
  const result: CrawlResult = {
    crawled: 0,
    skipped: 0,
    failed: 0,
    pdfsIndexed: 0,
  };

  const externalContent = await fetchExternalContent(item.externalUrl);
  if (externalContent.kind === "failed") {
    result.failed++;
    return result;
  }
  if (externalContent.kind === "skip") {
    result.skipped++;
    return result;
  }
  if (externalContent.kind === "pdf") {
    const directPdf = await parsePdfBuffer(externalContent.buffer, item.externalUrl);
    if (!directPdf) {
      result.failed++;
      return result;
    }
    const pdfFileId = Math.abs(hashCode(item.externalUrl));
    const chunks = createChunksFromContent(directPdf.content, {
      courseId,
      courseName,
      moduleTitle: item.moduleName,
      fileName: item.title || "external.pdf",
      fileId: pdfFileId,
    });
    if (chunks.length > 0) {
      await upsertStoredFileContent({
        userId,
        courseId,
        courseName,
        moduleId: item.moduleId,
        moduleTitle: item.moduleName,
        fileName: item.title || "external.pdf",
        fileId: pdfFileId,
        fileHash: directPdf.hash,
        chunks,
      });
      result.pdfsIndexed++;
      await updateItemCrawlStatus(userId, courseId, item.moduleId, item.itemId, directPdf.hash);
    }
    result.crawled++;
    return result;
  }

  const html = externalContent.html;

  // Ekstraher tekst
  const text = extractTextFromHtml(html);
  if (!text.trim()) {
    logger.info(
      { url: item.externalUrl },
      "ExternalUrl inneholder ingen lesbar tekst",
    );
    result.failed++;
    return result;
  }

  // Beregn hash og sammenlign
  const contentHash = sha256(text);

  if (item.crawledHash === contentHash) {
    logger.info(
      { userId, url: item.externalUrl },
      "ExternalUrl uendret etter crawl, hopper over Pinecone",
    );
    result.skipped++;

    return result;
  }

  logger.info(
    { userId, url: item.externalUrl },
    "ExternalUrl innhold endret, re-indekserer",
  );

  // Chunk og indekser teksten
  const chunks = createChunksFromContent(text, {
    courseId,
    courseName,
    moduleTitle: item.moduleName,
    fileName: item.title,
    fileId: item.itemId,
  });

  if (chunks.length > 0) {
    try {
      await upsertStoredFileContent({
        userId,
        courseId,
        courseName,
        moduleId: item.moduleId,
        moduleTitle: item.moduleName,
        fileName: item.title,
        fileId: item.itemId,
        fileHash: contentHash,
        chunks,
      });

      result.crawled++;
    } catch (error) {
      logger.warn(
        { err: error, url: item.externalUrl },
        "Feil ved Pinecone-upsert for ExternalUrl",
      );
      result.failed++;
    }
  }

  // Oppdater crawledHash/crawledAt før PDF-prosessering slik at HTML-indeksering
  // ikke kjøres på nytt hvis en senere PDF-lenke feiler.
  await updateItemCrawlStatus(
    userId,
    courseId,
    item.moduleId,
    item.itemId,
    contentHash,
  );

  // Prosesser PDF-lenker
  await processPdfLinks(
    html,
    item,
    userId,
    courseId,
    courseName,
    result,
  );

  return result;
}

/**
 * Prosesserer PDF-lenker funnet på en ekstern side.
 */
async function processPdfLinks(
  html: string,
  item: ExternalUrlItem,
  userId: string,
  courseId: string,
  courseName: string,
  result: CrawlResult,
): Promise<void> {
  const pdfLinks = findPdfLinks(html, item.externalUrl);
  if (pdfLinks.length === 0) return;

  const previouslyIndexedPdfs = new Set(item.crawledPdfs ?? []);
  const newlyIndexedPdfs: string[] = [...previouslyIndexedPdfs];

  for (const pdf of pdfLinks) {
    // Hopp over allerede indekserte PDF-er
    if (previouslyIndexedPdfs.has(pdf.url)) {
      logger.info(
        { url: pdf.url, parentUrl: item.externalUrl },
        "PDF allerede indeksert — hopper over",
      );
      continue;
    }

    // Last ned og prosesser PDF
    const pdfResult = await downloadAndProcessPdf(pdf.url);
    if (!pdfResult) continue;

    // Chunk og indekser PDF-innhold
    // Generer unik fileId for PDF-en basert på URL-hash
    const pdfFileId = Math.abs(hashCode(pdf.url));

    const chunks = createChunksFromContent(pdfResult.content, {
      courseId,
      courseName,
      moduleTitle: item.moduleName,
      fileName: pdf.title,
      fileId: pdfFileId,
    });

    if (chunks.length > 0) {
      try {
        await upsertStoredFileContent({
          userId,
          courseId,
          courseName,
          moduleId: item.moduleId,
          moduleTitle: item.moduleName,
          fileName: pdf.title,
          fileId: pdfFileId,
          fileHash: pdfResult.hash,
          chunks,
        });

        newlyIndexedPdfs.push(pdf.url);
        result.pdfsIndexed++;

        logger.info(
          { url: pdf.url, parentUrl: item.externalUrl, chunkCount: chunks.length },
          "PDF fra ekstern side indeksert",
        );
      } catch (error) {
        logger.warn(
          { err: error, url: pdf.url },
          "Feil ved Pinecone-upsert for PDF",
        );
      }
    }
  }

  // Oppdater listen over indekserte PDF-er
  if (newlyIndexedPdfs.length > previouslyIndexedPdfs.size) {
    await updateItemCrawledPdfs(
      userId,
      courseId,
      item.moduleId,
      item.itemId,
      newlyIndexedPdfs,
    );
  }
}

/**
 * Enkel hash-funksjon for å generere en numerisk ID fra en streng.
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Konverter til 32-bit integer
  }
  return hash;
}

/**
 * Oppdaterer crawledHash og crawledAt for et item i MongoDB.
 */
async function updateItemCrawlStatus(
  userId: string,
  courseId: string,
  moduleId: number,
  itemId: number,
  crawledHash: string,
): Promise<void> {
  try {
    await CanvasStructureModel.updateOne(
      { userId, courseId },
      {
        $set: {
          "moduler.$[mod].items.$[item].crawledHash": crawledHash,
          "moduler.$[mod].items.$[item].crawledAt": new Date(),
        },
      },
      {
        arrayFilters: [{ "mod.id": moduleId }, { "item.id": itemId }],
      },
    );
  } catch (error) {
    logger.warn(
      { err: error, userId, courseId, moduleId, itemId },
      "Kunne ikke oppdatere crawledHash for ExternalUrl",
    );
  }
}

/**
 * Oppdaterer listen over crawlede PDF-er for et item i MongoDB.
 */
async function updateItemCrawledPdfs(
  userId: string,
  courseId: string,
  moduleId: number,
  itemId: number,
  crawledPdfs: string[],
): Promise<void> {
  try {
    await CanvasStructureModel.updateOne(
      { userId, courseId },
      {
        $set: {
          "moduler.$[mod].items.$[item].crawledPdfs": crawledPdfs,
        },
      },
      {
        arrayFilters: [{ "mod.id": moduleId }, { "item.id": itemId }],
      },
    );
  } catch (error) {
    logger.warn(
      { err: error, userId, courseId, moduleId, itemId },
      "Kunne ikke oppdatere crawledPdfs for ExternalUrl",
    );
  }
}

/**
 * Convenience-funksjon for å crawle ExternalUrl-items basert på courseId.
 */
export async function crawlExternalUrlsByCourseId(
  userId: string,
  courseId: string,
  options?: CrawlExternalUrlOptions,
): Promise<CrawlResult> {
  const courseDoc = await CanvasStructureModel.findOne({ userId, courseId }).lean();
  if (!courseDoc) {
    logger.warn(
      { userId, courseId },
      "Kunne ikke finne kurs for ExternalUrl-crawling",
    );
    return { crawled: 0, skipped: 0, failed: 0, pdfsIndexed: 0 };
  }

  return crawlCourseExternalUrls(courseDoc as ICanvasStructure, options);
}
