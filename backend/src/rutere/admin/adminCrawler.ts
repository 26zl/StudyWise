/**
 * Admin crawler-vedlikehold.
 * Monteres under /api/admin (beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkt:
 *   GET /crawler/stats – Aggregerte nøkkeltall for ExternalUrl-crawling.
 *
 * Crawleren lagrer ikke egne logger; metadata ligger per-item i
 * CanvasStructure.moduler[].items[]. Endepunktet aggregerer på tvers av
 * alle strukturer og eksponerer tall + en liste over stale/ukrawlede
 * lenker admin kan manuelt trigge re-sync for.
 */
import { Router } from "express";
import { AdminCrawlerStatsResponseSchema } from "common/admin";
import { CanvasStructureModel } from "../../database/models/CanvasStructure.js";
import { requireUserId, sendUnknownError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";

const router = Router();

/** ExternalUrl regnes som stale når siste crawl er eldre enn dette. */
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Gulv for "crawledEmpty"-retry i canvas-sync (crawl lyktes, men fant verken
 * PDFer eller undersider). Må holdes synkronisert med STALE_EMPTY_RETRY_MS
 * i canvas-sync.service.ts, ellers viser admin-dashbordet en annen
 * sannhet enn driftslogikken faktisk følger.
 */
const EMPTY_CRAWL_RETRY_MS = 24 * 60 * 60 * 1000;
/** Begrenser hvor mange stale-items vi returnerer for å holde responsen lett. */
const MAX_STALE_ITEMS_IN_RESPONSE = 50;

router.get("/crawler/stats", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const structures = await CanvasStructureModel.find(
      {},
      { courseId: 1, courseName: 1, moduler: 1 },
    ).lean();

    let totalExternalUrls = 0;
    let crawledCount = 0;
    let neverCrawledCount = 0;
    let staleCount = 0;
    let emptyCrawlCount = 0;
    let pdfsIndexed = 0;
    let subpagesCrawled = 0;
    const staleItems: Array<{
      courseId: string;
      courseName: string;
      moduleTitle: string;
      itemTitle: string;
      externalUrl: string;
      crawledAt: string | null;
      reason: "never_crawled" | "stale" | "empty_crawl";
    }> = [];

    const now = Date.now();

    for (const struct of structures) {
      for (const modul of struct.moduler ?? []) {
        for (const item of modul.items ?? []) {
          if (!item.external_url) continue;
          totalExternalUrls++;

          const hasCrawl = Boolean(item.crawledHash);
          const crawledAtMs = item.crawledAt ? new Date(item.crawledAt).getTime() : null;
          const pdfCount = item.crawledPdfs?.length ?? 0;
          const subpageCount = item.crawledSubpages?.length ?? 0;
          // Matcher canvas-sync sitt "crawledEmpty"-kriterium: lyktes-flagget
          // er satt, men hverken PDFer eller undersider ble plukket opp, og
          // siste forsøk er gammelt nok til at retry er aktuelt.
          const isEmptyCrawl =
            hasCrawl &&
            pdfCount === 0 &&
            subpageCount === 0 &&
            (crawledAtMs === null || now - crawledAtMs > EMPTY_CRAWL_RETRY_MS);
          const isStale =
            hasCrawl &&
            !isEmptyCrawl &&
            crawledAtMs !== null &&
            now - crawledAtMs > STALE_THRESHOLD_MS;

          if (hasCrawl) {
            crawledCount++;
            pdfsIndexed += pdfCount;
            subpagesCrawled += subpageCount;
          } else {
            neverCrawledCount++;
          }
          if (isStale) staleCount++;
          if (isEmptyCrawl) emptyCrawlCount++;

          const reason: "never_crawled" | "stale" | "empty_crawl" | null = !hasCrawl
            ? "never_crawled"
            : isEmptyCrawl
              ? "empty_crawl"
              : isStale
                ? "stale"
                : null;

          if (reason && staleItems.length < MAX_STALE_ITEMS_IN_RESPONSE) {
            staleItems.push({
              courseId: String(struct.courseId),
              courseName: struct.courseName ?? "",
              moduleTitle: modul.name ?? "",
              itemTitle: item.title ?? "",
              externalUrl: item.external_url,
              crawledAt: crawledAtMs ? new Date(crawledAtMs).toISOString() : null,
              reason,
            });
          }
        }
      }
    }

    const payload = AdminCrawlerStatsResponseSchema.parse({
      totalExternalUrls,
      crawledCount,
      neverCrawledCount,
      staleCount,
      emptyCrawlCount,
      pdfsIndexed,
      subpagesCrawled,
      staleItems,
    });

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "crawler.stats" },
      req,
    });

    return res.json(payload);
  } catch (err) {
    logger.error({ err, actorUserId }, "Feil ved henting av crawler-statistikk");
    return sendUnknownError(res, err, { melding: "Kunne ikke hente crawler-statistikk" });
  }
});

export default router;
