/**
 * Kunnskapsbase-ruter
 *
 * CRUD for personlige kunnskapsbaser med lenker og filer.
 * Filinnhold og lenker indekseres til Pinecone for semantisk søk fra KI-chatten.
 *
 * Ruter:
 *   GET    /api/kb               — Liste alle baser for innlogget bruker
 *   POST   /api/kb               — Opprett ny base
 *   GET    /api/kb/:id           — Hent base med innhold (lenker + filer)
 *   PATCH  /api/kb/:id           — Oppdater basenavn
 *   DELETE /api/kb/:id           — Slett base og alt innhold
 *
 *   POST   /api/kb/:id/links     — Legg til lenke
 *   DELETE /api/kb/:id/links/:linkId — Slett lenke
 *
 *   POST   /api/kb/:id/files     — Last opp fil
 *   DELETE /api/kb/:id/files/:fileId — Slett fil
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { Types } from "mongoose";
import pLimit from "p-limit";
import { logger } from "../../utils/logger.js";
import { apiError, sendZodError, sendUnknownError, requireUserId } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { rateLimitKB, rateLimitKBWrite } from "../../middleware/rate-limit.js";
import {
  KBCreateBaseSchema,
  KBUpdateBaseSchema,
  KBAddLinkSchema,
  KB_MAX_BASES_PER_USER,
  KB_MAX_LINKS_PER_BASE,
  KB_MAX_FILES_PER_BASE,
  KB_MAX_FILE_SIZE_BYTES,
  KB_ALLOWED_MIME_TYPES,
} from "common/kunnskapsbase";
import { KnowledgeBase } from "../../database/models/Kunnskapsbase.js";
import {
  indexKBContent,
  deleteKBSourceContent,
  deleteKBBaseContent,
} from "../../services/kunnskapsbase-indeksering.service.js";
import { parseDocument } from "../../services/document.js";
import { extractTextFromHtml, fetchExternalContent } from "../../services/crawler.js";

const router = Router();
const kbIngestionLimiterByUser = new Map<string, ReturnType<typeof pLimit>>();

function runKBIngestionJob(userId: string, job: () => Promise<void>): void {
  const existing = kbIngestionLimiterByUser.get(userId);
  const limiter = existing ?? pLimit(2);
  if (!existing) kbIngestionLimiterByUser.set(userId, limiter);

  void limiter(job).catch((err) => {
    logger.error({ err, userId }, "KB bakgrunnsjobb feilet");
  });
}

// ─── Multer-oppsett for filopplasting ────────────────────

const INVALID_KB_FILE_TYPE_ERROR = "INVALID_KB_FILE_TYPE";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: KB_MAX_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (KB_ALLOWED_MIME_TYPES.includes(file.mimetype as typeof KB_ALLOWED_MIME_TYPES[number])) {
      cb(null, true);
    } else {
      cb(new Error(INVALID_KB_FILE_TYPE_ERROR));
    }
  },
});

// ─── Hjelpefunksjoner ────────────────────────────────────

/** Hent enkelt strengverdi fra Express-param (Express 5: kan være string | string[]) */
function paramString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Verifiser at base tilhører brukeren og returner den, eller send feil */
async function hentBaseForBruker(baseId: string, userId: string, res: Response) {
  if (!baseId.match(/^[a-f0-9]{24}$/)) {
    apiError.badRequest(res, "Ugyldig base-ID");
    return null;
  }
  const base = await KnowledgeBase.findOne({ _id: baseId, userId });
  if (!base) {
    apiError.notFound(res, "Kunnskapsbase");
    return null;
  }
  return base;
}

// ─── Base-ruter ──────────────────────────────────────────

/** GET /api/kb — Liste alle baser */
router.get("/", rateLimitKB, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const baser = await KnowledgeBase.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    const response = {
      baser: baser.map((b) => ({
        id: String(b._id),
        navn: b.navn,
        antallLenker: b.lenker.length,
        antallFiler: b.filer.length,
        opprettetDato: b.createdAt.toISOString(),
        oppdatertDato: b.updatedAt.toISOString(),
      })),
    };

    res.json(response);
  } catch (err) {
    sendUnknownError(res, err, { kontekst: "kb.listBaser" });
  }
});

/** POST /api/kb — Opprett ny base */
router.post("/", rateLimitKBWrite, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = KBCreateBaseSchema.safeParse(req.body);
  if (!parsed.success) {
    sendZodError(res, parsed.error, "Opprett kunnskapsbase");
    return;
  }

  try {
    // Sjekk maks antall baser
    const antall = await KnowledgeBase.countDocuments({ userId });
    if (antall >= KB_MAX_BASES_PER_USER) {
      apiError.badRequest(res, `Du kan ha maks ${KB_MAX_BASES_PER_USER} kunnskapsbaser`);
      return;
    }

    const base = await KnowledgeBase.create({
      userId,
      navn: parsed.data.navn,
    });

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.KB_BASE_CREATED ?? "kb.base_created",
      category: "ki",
      outcome: "success",
      req,
      metadata: { baseId: String(base._id), navn: parsed.data.navn },
    });

    res.status(201).json({
      id: String(base._id),
      navn: base.navn,
      antallLenker: 0,
      antallFiler: 0,
      opprettetDato: base.createdAt.toISOString(),
      oppdatertDato: base.updatedAt.toISOString(),
    });
  } catch (err: unknown) {
    // Duplikat-navn feil (unique index)
    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000) {
      apiError.badRequest(res, "Du har allerede en base med dette navnet");
      return;
    }
    sendUnknownError(res, err, { kontekst: "kb.opprettBase" });
  }
});

/** GET /api/kb/:id — Hent base med innhold */
router.get("/:id", rateLimitKB, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const base = await hentBaseForBruker(paramString(req.params.id), userId, res);
    if (!base) return;

    res.json({
      id: String(base._id),
      navn: base.navn,
      lenker: base.lenker.map((l) => ({
        id: String(l._id),
        url: l.url,
        tittel: l.tittel,
        opprettetDato: l.createdAt.toISOString(),
      })),
      filer: base.filer.map((f) => ({
        id: String(f._id),
        filnavn: f.filnavn,
        mimeType: f.mimeType,
        storrelse: f.storrelse,
        opprettetDato: f.createdAt.toISOString(),
      })),
      opprettetDato: base.createdAt.toISOString(),
      oppdatertDato: base.updatedAt.toISOString(),
    });
  } catch (err) {
    sendUnknownError(res, err, { kontekst: "kb.hentBase" });
  }
});

/** PATCH /api/kb/:id — Oppdater basenavn */
router.patch("/:id", rateLimitKBWrite, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = KBUpdateBaseSchema.safeParse(req.body);
  if (!parsed.success) {
    sendZodError(res, parsed.error, "Oppdater kunnskapsbase");
    return;
  }

  try {
    const base = await hentBaseForBruker(paramString(req.params.id), userId, res);
    if (!base) return;

    base.navn = parsed.data.navn;
    await base.save();

    res.json({
      id: String(base._id),
      navn: base.navn,
      oppdatertDato: base.updatedAt.toISOString(),
    });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000) {
      apiError.badRequest(res, "Du har allerede en base med dette navnet");
      return;
    }
    sendUnknownError(res, err, { kontekst: "kb.oppdaterBase" });
  }
});

/** DELETE /api/kb/:id — Slett base og alt innhold */
router.delete("/:id", rateLimitKBWrite, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const base = await hentBaseForBruker(paramString(req.params.id), userId, res);
    if (!base) return;

    // Slett selve basen først. Da unngår vi inkonsistens hvor base overlever mens
    // vektor/chunk-data allerede er slettet ved delvis feil.
    await base.deleteOne();

    // Best effort-opprydding av indeksert innhold. Feil logges, men blokkerer ikke
    // API-respons når basen allerede er slettet.
    try {
      await deleteKBBaseContent(userId, String(base._id));
    } catch (err) {
      logger.error(
        { err, userId, baseId: String(base._id) },
        "KB-sletting: opprydding av indeksert innhold feilet etter at base ble slettet",
      );
    }

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.KB_BASE_DELETED ?? "kb.base_deleted",
      category: "ki",
      outcome: "success",
      req,
      metadata: { baseId: String(base._id), navn: base.navn },
    });

    res.status(204).end();
  } catch (err) {
    sendUnknownError(res, err, { kontekst: "kb.slettBase" });
  }
});

// ─── Lenke-ruter ─────────────────────────────────────────

/** POST /api/kb/:id/links — Legg til lenke */
router.post("/:id/links", rateLimitKBWrite, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const parsed = KBAddLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    sendZodError(res, parsed.error, "Legg til lenke");
    return;
  }

  try {
    const baseId = paramString(req.params.id);
    if (!baseId.match(/^[a-f0-9]{24}$/)) {
      apiError.badRequest(res, "Ugyldig base-ID");
      return;
    }

    const tittel = parsed.data.tittel || parsed.data.url;
    const lenkeIdObject = new Types.ObjectId();
    const now = new Date();

    const oppdatertBase = await KnowledgeBase.findOneAndUpdate(
      {
        _id: baseId,
        userId,
        "lenker.url": { $ne: parsed.data.url },
        $expr: { $lt: [{ $size: "$lenker" }, KB_MAX_LINKS_PER_BASE] },
      },
      {
        $push: {
          lenker: {
            _id: lenkeIdObject,
            url: parsed.data.url,
            tittel,
            indexed: false,
            crawlStatus: "pending",
            createdAt: now,
          },
        },
      },
      { new: true },
    );

    if (!oppdatertBase) {
      const eksisterendeBase = await KnowledgeBase.findOne({ _id: baseId, userId })
        .select({ "lenker.url": 1 })
        .lean();
      if (!eksisterendeBase) {
        apiError.notFound(res, "Kunnskapsbase");
        return;
      }
      if (eksisterendeBase.lenker.length >= KB_MAX_LINKS_PER_BASE) {
        apiError.badRequest(res, `Maks ${KB_MAX_LINKS_PER_BASE} lenker per base`);
        return;
      }
      if (eksisterendeBase.lenker.some((l) => l.url === parsed.data.url)) {
        apiError.badRequest(res, "Denne lenken finnes allerede i basen");
        return;
      }
      apiError.conflict(res, "Kunne ikke legge til lenke på grunn av en samtidig oppdatering");
      return;
    }

    const nyLenke = oppdatertBase.lenker.find((l) => String(l._id) === String(lenkeIdObject));
    if (!nyLenke) {
      sendUnknownError(res, new Error("Fant ikke nyopprettet lenke etter oppdatering"), { kontekst: "kb.leggTilLenke" });
      return;
    }
    const lenkeId = String(lenkeIdObject);

    // Indekser lenkeinnhold asynkront (blokkerer ikke responsen) med per-bruker concurrency-cap
    runKBIngestionJob(userId, () => crawlAndIndexLink(userId, baseId, lenkeId, parsed.data.url, tittel));

    res.status(201).json({
      id: lenkeId,
      url: nyLenke.url,
      tittel: nyLenke.tittel,
      opprettetDato: nyLenke.createdAt.toISOString(),
      crawlStatus: nyLenke.crawlStatus,
      crawledPages: nyLenke.crawledPages,
      crawledDocuments: nyLenke.crawledDocuments,
      crawlError: nyLenke.crawlError,
      lastCrawledAt: nyLenke.lastCrawledAt?.toISOString(),
    });
  } catch (err) {
    sendUnknownError(res, err, { kontekst: "kb.leggTilLenke" });
  }
});

/** DELETE /api/kb/:id/links/:linkId — Slett lenke */
router.delete("/:id/links/:linkId", rateLimitKBWrite, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const base = await hentBaseForBruker(paramString(req.params.id), userId, res);
    if (!base) return;

    const lenkeIndex = base.lenker.findIndex((l) => String(l._id) === paramString(req.params.linkId));
    if (lenkeIndex === -1) {
      apiError.notFound(res, "Lenke");
      return;
    }

    const lenkeId = String(base.lenker[lenkeIndex]._id);

    // Slett indeksert innhold
    await deleteKBSourceContent(userId, String(base._id), lenkeId);

    base.lenker.splice(lenkeIndex, 1);
    await base.save();

    res.status(204).end();
  } catch (err) {
    sendUnknownError(res, err, { kontekst: "kb.slettLenke" });
  }
});

// ─── Fil-ruter ───────────────────────────────────────────

/** POST /api/kb/:id/files — Last opp fil */
router.post("/:id/files", rateLimitKBWrite, (req: Request, res: Response) => {
  upload.single("file")(req, res, async (multerErr) => {
    if (multerErr) {
      if (multerErr.message === INVALID_KB_FILE_TYPE_ERROR) {
        apiError.badRequest(res, "Filtypen er ikke støttet");
        return;
      }
      if (multerErr.code === "LIMIT_FILE_SIZE") {
        apiError.badRequest(res, "Filen er for stor (maks 10 MB)");
        return;
      }
      sendUnknownError(res, multerErr, { kontekst: "kb.filopplasting" });
      return;
    }

    const userId = requireUserId(req, res);
    if (!userId) return;

    if (!req.file) {
      apiError.badRequest(res, "Ingen fil mottatt");
      return;
    }

    try {
      const baseId = paramString(req.params.id);
      if (!baseId.match(/^[a-f0-9]{24}$/)) {
        apiError.badRequest(res, "Ugyldig base-ID");
        return;
      }

      const contentHash = crypto
        .createHash("sha256")
        .update(req.file.buffer)
        .digest("hex");
      const filIdObject = new Types.ObjectId();
      const now = new Date();

      const oppdatertBase = await KnowledgeBase.findOneAndUpdate(
        {
          _id: baseId,
          userId,
          "filer.filnavn": { $ne: req.file.originalname },
          $expr: { $lt: [{ $size: "$filer" }, KB_MAX_FILES_PER_BASE] },
        },
        {
          $push: {
            filer: {
              _id: filIdObject,
              filnavn: req.file.originalname,
              mimeType: req.file.mimetype,
              storrelse: req.file.size,
              contentHash,
              indexed: false,
              createdAt: now,
            },
          },
        },
        { new: true },
      );

      if (!oppdatertBase) {
        const eksisterendeBase = await KnowledgeBase.findOne({ _id: baseId, userId })
          .select({ "filer.filnavn": 1 })
          .lean();
        if (!eksisterendeBase) {
          apiError.notFound(res, "Kunnskapsbase");
          return;
        }
        if (eksisterendeBase.filer.length >= KB_MAX_FILES_PER_BASE) {
          apiError.badRequest(res, `Maks ${KB_MAX_FILES_PER_BASE} filer per base`);
          return;
        }
        if (eksisterendeBase.filer.some((f) => f.filnavn === req.file!.originalname)) {
          apiError.badRequest(res, "En fil med dette navnet finnes allerede i basen");
          return;
        }
        apiError.conflict(res, "Kunne ikke laste opp fil på grunn av en samtidig oppdatering");
        return;
      }

      const nyFil = oppdatertBase.filer.find((f) => String(f._id) === String(filIdObject));
      if (!nyFil) {
        sendUnknownError(res, new Error("Fant ikke nyopplastet fil etter oppdatering"), { kontekst: "kb.lastOppFil" });
        return;
      }
      const filId = String(filIdObject);

      const file = req.file;
      if (!file) {
        apiError.badRequest(res, "Ingen fil mottatt");
        return;
      }

      // Pars og indekser filinnhold asynkront med per-bruker concurrency-cap
      runKBIngestionJob(userId, () =>
        parseAndIndexFile(
          userId,
          baseId,
          filId,
          file.originalname,
          file.buffer,
          file.mimetype,
        ));

      res.status(201).json({
        id: filId,
        filnavn: nyFil.filnavn,
        mimeType: nyFil.mimeType,
        storrelse: nyFil.storrelse,
        opprettetDato: nyFil.createdAt.toISOString(),
      });
    } catch (err) {
      sendUnknownError(res, err, { kontekst: "kb.lastOppFil" });
    }
  });
});

/** DELETE /api/kb/:id/files/:fileId — Slett fil */
router.delete("/:id/files/:fileId", rateLimitKBWrite, async (req: Request, res: Response) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const base = await hentBaseForBruker(paramString(req.params.id), userId, res);
    if (!base) return;

    const filIndex = base.filer.findIndex((f) => String(f._id) === paramString(req.params.fileId));
    if (filIndex === -1) {
      apiError.notFound(res, "Fil");
      return;
    }

    const filId = String(base.filer[filIndex]._id);

    // Slett indeksert innhold
    await deleteKBSourceContent(userId, String(base._id), filId);

    base.filer.splice(filIndex, 1);
    await base.save();

    res.status(204).end();
  } catch (err) {
    sendUnknownError(res, err, { kontekst: "kb.slettFil" });
  }
});

// ─── Bakgrunnsindeksering ────────────────────────────────

/**
 * Crawler og indekserer en lenke asynkront.
 * Bruker enkel HTTP-henting med Readability for innholdsekstraksjon.
 */
async function crawlAndIndexLink(
  userId: string,
  baseId: string,
  lenkeId: string,
  url: string,
  tittel: string,
): Promise<void> {
  try {
    const fetched = await fetchExternalContent(url);
    let text = "";
    let contentType = "";

    if (fetched.kind === "failed") {
      logger.warn({ url }, "Kunne ikke hente lenkeinnhold");
      return;
    }
    if (fetched.kind === "skip") {
      logger.info({ url }, "Ustøttet innholdstype for lenke — hopper over");
      return;
    }

    if (fetched.kind === "html") {
      contentType = "text/html";
      text = extractTextFromHtml(fetched.html);
    } else if (fetched.kind === "pdf") {
      contentType = "application/pdf";
      const buffer = fetched.buffer;
      const parsed = await parseDocument(buffer, "application/pdf", url);
      text = parsed.text;
    }

    if (text.trim().length === 0) {
      logger.info({ url }, "Tomt innhold fra lenke — hopper over");
      return;
    }

    await indexKBContent({
      userId,
      baseId,
      sourceId: lenkeId,
      sourceType: "link",
      sourceName: tittel,
      content: text,
      metadata: {
        sourceUrl: url,
        contentType,
      },
    });

    // Oppdater indexed-status på lenken
    await KnowledgeBase.updateOne(
      { _id: baseId, "lenker._id": lenkeId },
      { $set: { "lenker.$.indexed": true } },
    );

    logger.info({ baseId, lenkeId, url }, "Lenke indeksert i kunnskapsbase");
  } catch (err) {
    logger.error(
      { err, url, baseId, lenkeId },
      "Feil ved crawling/indeksering av lenke",
    );
  }
}

/**
 * Parser og indekserer en fil asynkront.
 */
async function parseAndIndexFile(
  userId: string,
  baseId: string,
  filId: string,
  filnavn: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  try {
    const parsed = await parseDocument(buffer, mimeType, filnavn);

    if (!parsed.text || parsed.text.trim().length === 0) {
      logger.warn({ filnavn, baseId }, "Tomt innhold fra fil — hopper over indeksering");
      return;
    }

    await indexKBContent({
      userId,
      baseId,
      sourceId: filId,
      sourceType: "file",
      sourceName: filnavn,
      content: parsed.text,
    });

    // Oppdater indexed-status på filen
    await KnowledgeBase.updateOne(
      { _id: baseId, "filer._id": filId },
      { $set: { "filer.$.indexed": true } },
    );

    logger.info({ baseId, filId, filnavn }, "Fil indeksert i kunnskapsbase");
  } catch (err) {
    logger.error(
      { err, filnavn, baseId, filId },
      "Feil ved parsing/indeksering av fil",
    );
  }
}

export default router;
