/**
 * Admin AI-debug: verktøy for å diagnostisere KI-kvalitet.
 * Monteres under /api/admin (beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   POST /debug/retrieval       – Query-replay: kjør fullt hybrid-søk og eksponer alle stadier
 *   GET  /debug/extraction      – Lister Canvas-filer som mangler indeksering
 *   GET  /debug/kb-health       – Per-kunnskapsbase: chunk-antall, tomme baser, tynne baser
 *   GET  /debug/feedback-triage – Grupperer negative tommelvurderinger etter utledet intent
 */
import { Router } from "express";
import { Types } from "mongoose";
import {
  AdminRetrievalDebugRequestSchema,
  AdminRetrievalDebugResponseSchema,
  AdminExtractionAuditResponseSchema,
  AdminKbHealthResponseSchema,
  AdminFeedbackTriageResponseSchema,
  type AdminRetrievalDebugResponse,
  type AdminExtractionAuditItem,
  type AdminExtractionTruncatedItem,
  type AdminKbHealthItem,
  type AdminFeedbackTriageGroup,
} from "common/admin";
import { hybridSearch } from "../../services/hybrid-retrieval.service.js";
import { CanvasStructureModel } from "../../database/models/CanvasStructure.js";
import { ContentEmbedding } from "../../database/models/ContentEmbedding.js";
import { FULL_TEXT_PART_SIZE } from "../../services/embedding.service.js";
import { KnowledgeBase } from "../../database/models/Kunnskapsbase.js";
import { KBContentChunk } from "../../database/models/KBContentChunk.js";
import { ChatFeedback } from "../../database/models/ChatFeedback.js";
import { User } from "../../database/models/User.js";
import {
  requireUserId,
  sendZodError,
  sendUnknownError,
} from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";

const router = Router();

// ─── Query replay ───────────────────────────────────────────────────────────

router.post("/debug/retrieval", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const parsed = AdminRetrievalDebugRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendZodError(res, parsed.error);
  const { query, courseId, userId: targetUserId } = parsed.data;

  try {
    // Admin kan kjøre replay på tvers av egen bruker eller annen bruker for feilsøking.
    // Sikkerhet: hybridSearch filtrerer på userId uansett, så dette er read-only over
    // egne indeksdata (admin har uansett tilgang til aggregert data i admin-konsollet).
    const effectiveUserId = targetUserId || actorUserId;

    const result = await hybridSearch(effectiveUserId, query, {
      courseIds: courseId ? [courseId] : undefined,
      includeDebug: true,
    });

    const debug = result.debug;
    const payload: AdminRetrievalDebugResponse = {
      query,
      courseId: courseId ?? null,
      effectiveUserId,
      concepts: debug?.concepts ?? null,
      elapsedMs: debug?.elapsedMs ?? 0,
      degraded: result.degraded,
      sources: result.sources,
      vector: debug?.vector ?? [],
      bm25: debug?.bm25 ?? [],
      fused:
        debug?.fused.map((d) => ({
          rank: d.rank,
          score: d.rrfScore,
          source: d.source,
          chunkIndex: d.chunkIndex,
          textPreview: d.textPreview,
        })) ?? [],
      final: result.results.map((r, i) => ({
        rank: i + 1,
        score: r.score,
        source: r.source,
        chunkIndex: r.chunkIndex,
        textPreview: r.text.slice(0, 300),
      })),
    };

    const validated = AdminRetrievalDebugResponseSchema.parse(payload);

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        subAction: "aiDebug.retrieval",
        courseId: courseId ?? null,
        queryLength: query.length,
      },
      req,
    });

    return res.json(validated);
  } catch (err) {
    logger.error({ err, actorUserId }, "Retrieval-debug feilet");
    return sendUnknownError(res, err, { melding: "Kunne ikke kjøre retrieval-debug" });
  }
});

// ─── Ekstraksjons-audit ─────────────────────────────────────────────────────

/** Maksimalt antall items vi returnerer — holder responsen lett. */
const MAX_AUDIT_ITEMS = 100;

router.get("/debug/extraction", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    // Hent alle Canvas-filer fra CanvasStructure (type === "File" med content_id).
    // Samme Canvas-fil kan ligge i flere moduler for samme bruker — vi
    // dedupliserer per (userId, courseId, fileId) så telle-kolonnene matcher
    // indekseringsenheten (én ContentEmbedding-rad per bruker-fil-par).
    const structures = await CanvasStructureModel.find(
      {},
      { userId: 1, courseId: 1, courseName: 1, moduler: 1 },
    ).lean();

    type UserFile = {
      userId: string;
      courseId: string;
      courseName: string;
      moduleTitle: string;
      fileName: string;
      fileId: number;
    };
    const userFileMap = new Map<string, UserFile>();
    for (const struct of structures) {
      for (const modul of struct.moduler ?? []) {
        for (const item of modul.items ?? []) {
          if (item.type !== "File") continue;
          const fileId = item.content_id ?? item.id;
          if (typeof fileId !== "number") continue;
          const userId = String(struct.userId);
          const courseId = String(struct.courseId);
          const key = `${userId}:${courseId}:${fileId}`;
          if (userFileMap.has(key)) continue;
          userFileMap.set(key, {
            userId,
            courseId,
            courseName: struct.courseName ?? "",
            moduleTitle: modul.name ?? "",
            fileName: item.title ?? "",
            fileId,
          });
        }
      }
    }

    const totalUserFiles = userFileMap.size;
    if (totalUserFiles === 0) {
      const empty = AdminExtractionAuditResponseSchema.parse({
        totalUserFiles: 0,
        indexedUserFiles: 0,
        unindexedUserFiles: 0,
        items: [],
        truncatedFiles: [],
        storageCap: FULL_TEXT_PART_SIZE,
      });
      return res.json(empty);
    }

    // Finn hvilke (userId, courseId, fileId)-par som har minst én ContentEmbedding-rad.
    const indexed = await ContentEmbedding.aggregate<{
      _id: { userId: string; courseId: string; fileId: number };
    }>([
      { $group: { _id: { userId: "$userId", courseId: "$courseId", fileId: "$fileId" } } },
    ]);
    const indexedSet = new Set(
      indexed.map((row) => `${row._id.userId}:${row._id.courseId}:${row._id.fileId}`),
    );

    // Finn filer der lagringen stille kuttet teksten — `charCount` er original
    // lengde, `fullText` (eller `text`-lengde) er faktisk lagret. Hvis de
    // avviker, har brukeren en fil som KI aldri vil få hele innholdet av,
    // uansett hvor stort injection-budsjett vi setter.
    const truncated = await ContentEmbedding.aggregate<{
      userId: string;
      courseId: string;
      fileId: number;
      fileName: string;
      originalChars: number;
      storedChars: number;
    }>([
      // Med chunked fullText-lagring er `charCount` på part 0 (chunkIndex: -1)
      // den offisielle total-lengden, og stored-tekst må summeres på tvers av
      // alle parter per fil. Query aggregerer derfor per (userId, courseId,
      // fileId) og sammenligner charCount mot sum av fullText-lengde.
      // Med chunked-lagring skal denne queryen alltid returnere 0 rader i
      // praksis, men vi beholder den som sikkerhetsnett — i tilfelle gammel
      // data fra før chunking eller fremtidige feilsituasjoner skulle oppstå.
      {
        $match: {
          chunkIndex: { $lt: 0 },
          fullText: { $exists: true, $type: "string" },
        },
      },
      {
        $group: {
          _id: { userId: "$userId", courseId: "$courseId", fileId: "$fileId" },
          fileName: { $first: "$fileName" },
          originalChars: { $max: { $ifNull: ["$charCount", 0] } },
          storedChars: { $sum: { $strLenCP: "$fullText" } },
        },
      },
      { $match: { $expr: { $lt: ["$storedChars", "$originalChars"] } } },
      {
        $project: {
          _id: 0,
          userId: "$_id.userId",
          courseId: "$_id.courseId",
          fileId: "$_id.fileId",
          fileName: 1,
          originalChars: 1,
          storedChars: 1,
        },
      },
      { $limit: MAX_AUDIT_ITEMS },
    ]);

    // Batch-hent eier-e-post for både missing og truncated items i ett kall.
    const missingFiles: UserFile[] = [];
    let indexedUserFiles = 0;
    for (const f of userFileMap.values()) {
      const key = `${f.userId}:${f.courseId}:${f.fileId}`;
      if (indexedSet.has(key)) {
        indexedUserFiles++;
      } else if (missingFiles.length < MAX_AUDIT_ITEMS) {
        missingFiles.push(f);
      }
    }
    const ownerIdsRaw = [
      ...missingFiles.map((f) => f.userId),
      ...truncated.map((t) => t.userId),
    ];
    const ownerIds = Array.from(new Set(ownerIdsRaw)).filter((id) =>
      Types.ObjectId.isValid(id),
    );
    // allow-deleted-users: admin extraction-audit viser eiere av orphan-filer
    // som mangler chunks. Hvis bruker er soft-deleted er det nettopp da
    // admin trenger å identifisere dem for opprydding av foreldreløse data.
    const owners = ownerIds.length
      ? await User.find({ _id: { $in: ownerIds } }, { email: 1 }).lean()
      : [];
    const ownerMap = new Map(owners.map((u) => [String(u._id), u.email ?? null]));

    const items: AdminExtractionAuditItem[] = missingFiles.map((f) => ({
      userId: f.userId,
      ownerEmail: ownerMap.get(f.userId) ?? null,
      courseId: f.courseId,
      courseName: f.courseName,
      moduleTitle: f.moduleTitle,
      fileName: f.fileName,
      fileId: f.fileId,
      reason: "no_chunks" as const,
    }));

    // Koble truncated-items mot catalog for å fylle inn courseName.
    const truncatedFiles: AdminExtractionTruncatedItem[] = truncated.map((t) => {
      const catalogFile = userFileMap.get(`${t.userId}:${t.courseId}:${t.fileId}`);
      return {
        userId: t.userId,
        ownerEmail: ownerMap.get(t.userId) ?? null,
        courseId: t.courseId,
        courseName: catalogFile?.courseName ?? "",
        fileName: t.fileName,
        fileId: t.fileId,
        originalChars: t.originalChars,
        storedChars: t.storedChars,
        lostChars: t.originalChars - t.storedChars,
      };
    });

    const payload = AdminExtractionAuditResponseSchema.parse({
      totalUserFiles,
      indexedUserFiles,
      unindexedUserFiles: totalUserFiles - indexedUserFiles,
      items,
      truncatedFiles,
      storageCap: FULL_TEXT_PART_SIZE,
    });

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "aiDebug.extraction" },
      req,
    });

    return res.json(payload);
  } catch (err) {
    logger.error({ err, actorUserId }, "Extraction-audit feilet");
    return sendUnknownError(res, err, { melding: "Kunne ikke hente ekstraksjons-audit" });
  }
});

// ─── KB-helse ───────────────────────────────────────────────────────────────

/** Baser med færre enn dette regnes som "tynne" — vanligvis tegn på ufullstendig indeksering. */
const THIN_BASE_THRESHOLD = 5;
/** Maks antall KB-items i responsen. */
const MAX_KB_ITEMS = 200;

router.get("/debug/kb-health", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const bases = await KnowledgeBase.find(
      {},
      { userId: 1, navn: 1, lenker: 1, filer: 1, updatedAt: 1 },
    )
      .sort({ updatedAt: -1 })
      .lean();

    // Aggregér chunk-antall per base i ett kall
    const chunkCounts = await KBContentChunk.aggregate<{ _id: string; count: number }>([
      { $group: { _id: "$baseId", count: { $sum: 1 } } },
    ]);
    const chunkMap = new Map(chunkCounts.map((row) => [row._id, row.count]));

    // Hent eiere i batch for å unngå N+1
    const ownerIds = Array.from(new Set(bases.map((b) => b.userId))).filter((id) =>
      Types.ObjectId.isValid(id),
    );
    // allow-deleted-users: admin KB-helse viser eiere av kunnskapsbaser som
    // kan være orphan etter brukersletting. Å skjule soft-deleted eiere ville
    // gjort foreldreløse baser uidentifiserbare for opprydding.
    const owners = ownerIds.length
      ? await User.find({ _id: { $in: ownerIds } }, { email: 1 }).lean()
      : [];
    const ownerMap = new Map(owners.map((u) => [String(u._id), u.email ?? null]));

    let totalChunks = 0;
    let emptyBases = 0;
    let thinBases = 0;
    const items: AdminKbHealthItem[] = [];

    for (const base of bases) {
      const chunkCount = chunkMap.get(String(base._id)) ?? 0;
      totalChunks += chunkCount;
      if (chunkCount === 0) emptyBases++;
      else if (chunkCount < THIN_BASE_THRESHOLD) thinBases++;

      if (items.length < MAX_KB_ITEMS) {
        items.push({
          id: String(base._id),
          navn: base.navn,
          ownerEmail: ownerMap.get(base.userId) ?? null,
          chunkCount,
          linkCount: base.lenker?.length ?? 0,
          fileCount: base.filer?.length ?? 0,
          updatedAt: (base.updatedAt ?? new Date()).toISOString(),
        });
      }
    }

    const payload = AdminKbHealthResponseSchema.parse({
      totalBases: bases.length,
      emptyBases,
      thinBases,
      totalChunks,
      items,
    });

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "aiDebug.kbHealth" },
      req,
    });

    return res.json(payload);
  } catch (err) {
    logger.error({ err, actorUserId }, "KB-helse feilet");
    return sendUnknownError(res, err, { melding: "Kunne ikke hente KB-helse" });
  }
});

// ─── Feedback-triage ────────────────────────────────────────────────────────

/**
 * Heuristisk intent-klassifisering av et brukerspørsmål.
 * ChatFeedback lagrer ikke intent — vi klassifiserer on-the-fly basert på
 * nøkkelord i lagret "question"-felt. Klassifiseringen er bevisst grov; målet
 * er å gruppere negative feedbacks så admin kan se om f.eks. full-document-
 * scenariet har uforholdsmessig mange down-votes.
 */
function classifyIntent(question: string | undefined | null): string {
  if (!question) return "ukjent";
  const lower = question.toLowerCase();
  if (/\b(oppsummer|oppsummering|forklar|utdyp|analyser|hele dokumentet)\b/.test(lower)) {
    return "canvas_full";
  }
  if (
    /\b(forelesning|kapittel|leksjon|modul|pensum|fagbegrep|teori|definisjon)\b/.test(
      lower,
    )
  ) {
    return "canvas_full";
  }
  if (
    /\b(frist|oppgave|innlevering|deadline|assignment|kunngjoring|kunngjøring|emner|kurs)\b/.test(
      lower,
    )
  ) {
    return "canvas_light";
  }
  // KB-detektering: eksplisitte ord + slash-kommando som starter en token.
  // Tidligere `\b\/` traff enhver skråstrek ved ordgrense og klassifiserte
  // URL-er, brøker (2/3) og lignende som "kb". Vi krever nå at skråstreken
  // starter meldingen eller følger whitespace OG følges av en bokstav —
  // slik ekte slash-kommandoer ser ut ("/algoritmer", "/matte-pensum").
  if (/\bkunnskapsbase?|(?:^|\s)\/[a-zæøå]|\bkb\b/.test(lower)) {
    return "kb";
  }
  return "general_chat";
}

/**
 * ChatFeedback har en 180-dagers TTL-indeks (se modellen). Vi eksponerer
 * dette tallet så admin-UIet kan forklare hvilket vindu stats dekker —
 * "totalt" ville ellers vært misvisende når eldre feedback utløper.
 */
const FEEDBACK_WINDOW_DAYS = 180;

router.get("/debug/feedback-triage", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    // Les kun feltene vi trenger for klassifisering. Ingen .limit() — vi vil
    // ha hele bevart historikk (TTL holder den bundet). Projection + lean
    // holder minnebruken lav også når samlingen vokser.
    const feedback = await ChatFeedback.find(
      {},
      { rating: 1, question: 1, createdAt: 1 },
    )
      .sort({ createdAt: -1 })
      .lean();

    const groupMap = new Map<
      string,
      { downCount: number; upCount: number; lastAt: Date | null }
    >();
    let totalDown = 0;
    let totalUp = 0;

    for (const fb of feedback) {
      const intent = classifyIntent(fb.question ?? null);
      const current = groupMap.get(intent) ?? {
        downCount: 0,
        upCount: 0,
        lastAt: null as Date | null,
      };
      if (fb.rating === "down") {
        current.downCount++;
        totalDown++;
      } else if (fb.rating === "up") {
        current.upCount++;
        totalUp++;
      }
      if (!current.lastAt || (fb.createdAt && fb.createdAt > current.lastAt)) {
        current.lastAt = fb.createdAt ?? current.lastAt;
      }
      groupMap.set(intent, current);
    }

    const groups: AdminFeedbackTriageGroup[] = Array.from(groupMap.entries())
      .map(([intent, g]) => ({
        intent,
        downCount: g.downCount,
        upCount: g.upCount,
        lastAt: g.lastAt ? g.lastAt.toISOString() : null,
      }))
      .sort((a, b) => b.downCount - a.downCount);

    const payload = AdminFeedbackTriageResponseSchema.parse({
      totalDown,
      totalUp,
      windowDays: FEEDBACK_WINDOW_DAYS,
      groups,
    });

    await audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "aiDebug.feedbackTriage" },
      req,
    });

    return res.json(payload);
  } catch (err) {
    logger.error({ err, actorUserId }, "Feedback-triage feilet");
    return sendUnknownError(res, err, { melding: "Kunne ikke hente feedback-triage" });
  }
});

export default router;
