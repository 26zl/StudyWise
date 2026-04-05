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
import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "net";
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
  deleteStoredFileContent,
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

/** Maks størrelse på HTML/TXT som crawles (2 MB) */
const MAX_TEXT_CONTENT_SIZE_BYTES = 2 * 1024 * 1024;

/** Maks antall redirects per URL for å unngå redirect-loop og SSRF-kjeder */
const MAX_REDIRECTS = 3;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

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

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

interface SafeFetchResponse {
  status: number;
  ok: boolean;
  headers: IncomingHttpHeaders;
  body: IncomingMessage | null;
}

type PinnedLookupOptions = {
  family?: number | "IPv4" | "IPv6";
  all?: boolean;
  hints?: number;
  verbatim?: boolean;
};

type PinnedLookup = (
  hostname: string,
  options: PinnedLookupOptions | number,
  callback: (
    error: NodeJS.ErrnoException | null,
    address?: string | LookupAddress[],
    family?: number,
  ) => void,
) => void;

class BodyTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`BODY_TOO_LARGE:${maxBytes}`);
    this.name = "BodyTooLargeError";
    this.maxBytes = maxBytes;
  }
}

// ─── Hjelpefunksjoner ──────────────────────────────────────

/**
 * Sjekker om en ekstern URL er trygg for crawling.
 * Forhindrer SSRF mot lokale tjenester og vanlige AWS metadata-endepunkter.
 */
function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1").trim().toLowerCase();
}

function isSafeExternalUrlFormat(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    
    // Tillat kun http og https
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;

    const hostname = normalizeHostname(url.hostname);
    
    // Blokker opplagt localhost
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
      return false;
    }

    // Blokker private/loopback IP-adresser ved direkte IP i URL
    if (net.isIP(hostname)) {
      if (isBlockedIpAddress(hostname)) return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

function isBlockedIpv4Address(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) return true;

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [first, second] = octets;

  // 0.0.0.0/8, loopback, private, link-local og CGNAT/reserved ranges
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function expandIpv6(address: string): string {
  // Fjern bracket-notasjon
  let addr = address.replace(/^\[|\]$/g, "").toLowerCase();

  // Ekspander :: til fullstendig form
  const sides = addr.split("::");
  if (sides.length === 2) {
    const left = sides[0] ? sides[0].split(":") : [];
    const right = sides[1] ? sides[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(Math.max(0, missing)).fill("0000");
    addr = [...left, ...middle, ...right].join(":");
  }

  // Normaliser hvert segment til 4 hex-siffer
  return addr
    .split(":")
    .map((seg) => seg.padStart(4, "0"))
    .join(":");
}

function isBlockedIpv6Address(address: string): boolean {
  const expanded = expandIpv6(address);

  // Loopback ::1
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return true;
  // Unspecified ::
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return true;

  const firstSegment = expanded.slice(0, 4);

  // Unique local addresses fc00::/7 (fc00-fdff)
  if (firstSegment >= "fc00" && firstSegment <= "fdff") return true;
  // Link-local fe80::/10
  if (firstSegment >= "fe80" && firstSegment <= "febf") return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — sjekk dotted-form på original adresse
  const lower = address.toLowerCase();
  const mappedDotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted?.[1]) {
    return isBlockedIpv4Address(mappedDotted[1]);
  }
  // Hex-form av IPv4-mapped (f.eks. ::ffff:7f00:1 = 127.0.0.1)
  if (expanded.startsWith("0000:0000:0000:0000:0000:ffff:")) {
    const hexPart = expanded.slice(30); // "HHHH:HHHH"
    const hexSegments = hexPart.split(":");
    if (hexSegments.length === 2) {
      const high = parseInt(hexSegments[0], 16);
      const low = parseInt(hexSegments[1], 16);
      if (!isNaN(high) && !isNaN(low)) {
        const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
        return isBlockedIpv4Address(ipv4);
      }
    }
  }

  // IPv4-compatible (deprecated) ::x.x.x.x og ::HHHH:HHHH
  if (expanded.startsWith("0000:0000:0000:0000:0000:0000:")) {
    const hexPart = expanded.slice(30);
    const hexSegments = hexPart.split(":");
    if (hexSegments.length === 2) {
      const high = parseInt(hexSegments[0], 16);
      const low = parseInt(hexSegments[1], 16);
      if (!isNaN(high) && !isNaN(low)) {
        const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
        return isBlockedIpv4Address(ipv4);
      }
    }
  }

  // AWS metadata IPv6 variant
  if (lower.includes("fd00:ec2::254")) return true;

  return false;
}

function isBlockedIpAddress(address: string): boolean {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) return isBlockedIpv4Address(address);
  if (ipVersion === 6) return isBlockedIpv6Address(address);
  return true;
}

async function resolveSafeHostnameAddresses(hostname: string): Promise<ResolvedAddress[] | null> {
  const normalizedHostname = normalizeHostname(hostname);
  const ipVersion = net.isIP(normalizedHostname);
  if (ipVersion !== 0) {
    return isBlockedIpAddress(normalizedHostname)
      ? null
      : [{ address: normalizedHostname, family: ipVersion as 4 | 6 }];
  }

  try {
    const addresses = await lookup(normalizedHostname, { all: true, verbatim: true });
    if (addresses.length === 0) return null;
    const mapped = addresses.map((entry) => ({
      address: entry.address,
      family: entry.family as 4 | 6,
    }));
    return mapped.every((entry) => !isBlockedIpAddress(entry.address)) ? mapped : null;
  } catch {
    return null;
  }
}

function resolveRedirectUrl(currentUrl: string, location: string): string | null {
  try {
    return new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
}

function getHeaderValue(headers: IncomingHttpHeaders, name: string): string | null {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw.join(", ");
  }
  return typeof raw === "string" ? raw : null;
}

function discardResponseBody(response: SafeFetchResponse): void {
  response.body?.resume();
}

function selectResolvedAddress(
  addresses: ResolvedAddress[],
  preferredFamily?: number,
): ResolvedAddress | null {
  if (preferredFamily === 4 || preferredFamily === 6) {
    return addresses.find((entry) => entry.family === preferredFamily) ?? null;
  }
  return addresses[0] ?? null;
}

function normalizeLookupFamily(family: number | "IPv4" | "IPv6" | undefined): number {
  if (family === "IPv4") return 4;
  if (family === "IPv6") return 6;
  return typeof family === "number" ? family : 0;
}

function createPinnedLookup(addresses: ResolvedAddress[]): PinnedLookup {
  return (
    _hostname: string,
    options: PinnedLookupOptions | number,
    callback: (
      error: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    const family =
      typeof options === "number"
        ? options
        : normalizeLookupFamily(options?.family);
    const selected = selectResolvedAddress(addresses, family);
    if (!selected) {
      callback(new Error("Ingen trygg DNS-adresse tilgjengelig"));
      return;
    }

    if (typeof options === "object" && options?.all) {
      callback(null, [{ address: selected.address, family: selected.family } satisfies LookupAddress]);
      return;
    }

    callback(null, selected.address, selected.family);
  };
}

async function performPinnedRequest(
  targetUrl: string,
  timeoutMs: number,
  resolvedAddresses: ResolvedAddress[],
): Promise<SafeFetchResponse | null> {
  const parsedUrl = new URL(targetUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await new Promise<SafeFetchResponse | null>((resolve) => {
      const requestFn = parsedUrl.protocol === "https:" ? httpsRequest : httpRequest;
      const request = requestFn(
        parsedUrl,
        {
          method: "GET",
          headers: {
            "User-Agent": CRAWLER_USER_AGENT,
            "Accept-Encoding": "identity",
          },
          lookup: createPinnedLookup(resolvedAddresses) as never,
          signal: controller.signal,
          ...(parsedUrl.protocol === "https:" ? { servername: normalizeHostname(parsedUrl.hostname) } : {}),
        },
        (response) => {
          resolve({
            status: response.statusCode ?? 0,
            ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
            headers: response.headers,
            body: response,
          });
        },
      );

      request.on("error", (error) => {
        if (error instanceof Error && error.name === "AbortError") {
          logger.warn({ url: targetUrl }, "ExternalUrl crawl tidsavbrutt");
        } else {
          logger.warn({ err: error, url: targetUrl }, "Feil ved henting av ExternalUrl");
        }
        resolve(null);
      });

      request.end();
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithSafeRedirects(url: string, timeoutMs: number): Promise<SafeFetchResponse | null> {
  let currentUrl = url;

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    const parsedUrl = new URL(currentUrl);
    const resolvedAddresses = await resolveSafeHostnameAddresses(parsedUrl.hostname);
    if (!isSafeExternalUrlFormat(currentUrl) || !resolvedAddresses) {
      logger.warn({ url: currentUrl }, "ExternalUrl avvist (SSRF-beskyttelse)");
      return null;
    }

    const response = await performPinnedRequest(currentUrl, timeoutMs, resolvedAddresses);
    if (!response) {
      return null;
    }

    if (REDIRECT_STATUS_CODES.has(response.status)) {
      const location = getHeaderValue(response.headers, "location");
      if (!location) {
        discardResponseBody(response);
        logger.warn({ url: currentUrl, status: response.status }, "Redirect uten Location-header");
        return null;
      }

      const redirectedUrl = resolveRedirectUrl(currentUrl, location);
      if (!redirectedUrl) {
        discardResponseBody(response);
        logger.warn({ url: currentUrl, location }, "Ugyldig redirect-url mottatt");
        return null;
      }

      discardResponseBody(response);
      currentUrl = redirectedUrl;
      continue;
    }

    return response;
  }

  logger.warn({ url }, "For mange redirects ved ExternalUrl-crawl");
  return null;
}

async function readResponseBodyWithLimit(response: SafeFetchResponse, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of response.body) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bufferChunk.length;
    if (totalBytes > maxBytes) {
      response.body.destroy();
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(bufferChunk);
  }

  return Buffer.concat(chunks);
}

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
  const response = await fetchWithSafeRedirects(url, FETCH_TIMEOUT_MS);
  if (!response) {
    return { kind: "failed" };
  }

  try {
    if (!response.ok) {
      discardResponseBody(response);
      logger.warn(
        { url, status: response.status },
        "ExternalUrl henting feilet",
      );
      return { kind: "failed" };
    }

    const contentType = getHeaderValue(response.headers, "content-type") ?? "";
    if (contentType.includes("application/pdf")) {
      const buffer = await readResponseBodyWithLimit(response, MAX_PDF_SIZE_BYTES);
      return { kind: "pdf", buffer };
    }
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      discardResponseBody(response);
      logger.info(
        { url, contentType },
        "ExternalUrl er ikke HTML — hopper over",
      );
      return { kind: "skip" };
    }

    const textBuffer = await readResponseBodyWithLimit(response, MAX_TEXT_CONTENT_SIZE_BYTES);
    return { kind: "html", html: textBuffer.toString("utf8") };
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      logger.warn({ url, maxBytes: error.maxBytes }, "ExternalUrl innhold for stort — hopper over");
      return { kind: "skip" };
    }
    if (error instanceof Error) {
      logger.warn({ err: error, url }, "Feil ved henting av ExternalUrl");
    } else {
      logger.warn({ url }, "Feil ved henting av ExternalUrl");
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
  const response = await fetchWithSafeRedirects(pdfUrl, FETCH_TIMEOUT_MS * 2);
  if (!response) {
    return null;
  }

  try {
    if (!response.ok) {
      discardResponseBody(response);
      logger.warn(
        { url: pdfUrl, status: response.status },
        "PDF-nedlasting feilet",
      );
      return null;
    }

    // Sjekk størrelse via Content-Length header
    const contentLength = getHeaderValue(response.headers, "content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_PDF_SIZE_BYTES) {
      discardResponseBody(response);
      logger.warn(
        { url: pdfUrl, size: contentLength },
        "PDF for stor — hopper over",
      );
      return null;
    }

    const buffer = await readResponseBodyWithLimit(response, MAX_PDF_SIZE_BYTES);

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
    if (error instanceof BodyTooLargeError) {
      logger.warn({ url: pdfUrl, maxBytes: MAX_PDF_SIZE_BYTES }, "PDF for stor — hopper over");
      return null;
    }
    if (error instanceof Error) {
      logger.warn({ err: error, url: pdfUrl }, "Feil ved PDF-nedlasting");
    } else {
      logger.warn({ url: pdfUrl }, "Feil ved PDF-nedlasting");
    }
    return null;
  }
}

function createStableFileId(source: string): number {
  const digest = crypto.createHash("sha256").update(source, "utf8").digest();
  const high = digest.readUInt32BE(0) & 0x001fffff; // behold 21 bit
  const low = digest.readUInt32BE(4); // behold 32 bit
  return high * 0x100000000 + low; // 53-bit safe integer
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
    const pdfFileId = createStableFileId(item.externalUrl);
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
        fullText: directPdf.content,
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
        fullText: text,
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
    const pdfFileId = createStableFileId(pdf.url);

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
          fullText: pdfResult.content,
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

  // Rydd opp PDF-er som har forsvunnet fra kildesiden
  const currentPdfUrls = new Set(pdfLinks.map((p) => p.url));
  const removedPdfUrls = [...previouslyIndexedPdfs].filter((url) => !currentPdfUrls.has(url));
  for (const removedUrl of removedPdfUrls) {
    try {
      const removedFileId = createStableFileId(removedUrl);
      await deleteStoredFileContent(userId, courseId, removedFileId);
      // Fjern fra listen
      const idx = newlyIndexedPdfs.indexOf(removedUrl);
      if (idx !== -1) newlyIndexedPdfs.splice(idx, 1);
      logger.info(
        { url: removedUrl, parentUrl: item.externalUrl },
        "Fjernet PDF-chunks for PDF som ikke lenger finnes på kildesiden",
      );
    } catch (error) {
      logger.warn(
        { err: error, url: removedUrl },
        "Feil ved opprydding av fjernet PDF",
      );
    }
  }

  // Oppdater listen over indekserte PDF-er
  const listChanged = newlyIndexedPdfs.length !== previouslyIndexedPdfs.size ||
    !newlyIndexedPdfs.every((url) => previouslyIndexedPdfs.has(url));
  if (listChanged) {
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

