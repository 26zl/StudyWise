/**
 * Kontaktskjema-rute
 * Offentlig endepunkt for kontakthenvendelser
 *
 * POST /api/kontakt
 * - Validerer input med Zod
 * - Sjekker honeypot-felt
 * - Verifiserer Turnstile-token
 * - Videresender til ekstern worker/webhook
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import {
  KONTAKT_ALLOWED_ATTACHMENT_TYPES,
  KONTAKT_MAX_ATTACHMENTS,
  KONTAKT_MAX_ATTACHMENT_SIZE_BYTES,
  KontaktRequestSchema,
  KontaktResponseSchema,
} from "common/contact";
import { logger } from "../../utils/logger.js";
import { apiError, sendZodError } from "../../utils/apiError.js";
import { rateLimitContact } from "../../middleware/rate-limit.js";
import {
  verifyTurnstileToken,
  isTurnstileConfigured,
} from "../../services/turnstile.service.js";
import { sendKontaktmelding } from "../../services/contact.service.js";
import { isProd } from "../../utils/env.js";
import { validateFileMagicBytes } from "../../services/document.js";

const router = Router();
const INVALID_ATTACHMENT_TYPE_ERROR = "INVALID_ATTACHMENT_TYPE";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: KONTAKT_MAX_ATTACHMENTS,
    fileSize: KONTAKT_MAX_ATTACHMENT_SIZE_BYTES,
  },
  fileFilter: (_req, file, callback) => {
    if (
      !KONTAKT_ALLOWED_ATTACHMENT_TYPES.includes(
        file.mimetype as (typeof KONTAKT_ALLOWED_ATTACHMENT_TYPES)[number],
      )
    ) {
      callback(new Error(INVALID_ATTACHMENT_TYPE_ERROR));
      return;
    }
    callback(null, true);
  },
});

function extractKontaktPayload(req: Request) {
  const body = req.body as Record<string, unknown>;
  return {
    navn: typeof body.navn === "string" ? body.navn : "",
    epost: typeof body.epost === "string" ? body.epost : "",
    emne: typeof body.emne === "string" ? body.emne : "",
    melding: typeof body.melding === "string" ? body.melding : "",
    turnstileToken:
      typeof body.turnstileToken === "string" ? body.turnstileToken : "",
    nettsted: typeof body.nettsted === "string" ? body.nettsted : undefined,
    sideUrl: typeof body.sideUrl === "string" ? body.sideUrl : undefined,
  };
}

function buildKontaktAttachments(files: Express.Multer.File[] | undefined) {
  return (files ?? []).map((file) => ({
    filnavn: file.originalname,
    mimeType: file.mimetype as (typeof KONTAKT_ALLOWED_ATTACHMENT_TYPES)[number],
    størrelse: file.size,
    innholdBase64: file.buffer.toString("base64"),
  }));
}

function validateKontaktAttachments(files: Express.Multer.File[] | undefined): string | null {
  for (const file of files ?? []) {
    const validationError = validateFileMagicBytes(file.buffer, file.mimetype);
    if (validationError) {
      logger.info(
        { filnavn: file.originalname, mimetype: file.mimetype, validationError },
        "Kontaktskjema: vedlegg avvist etter innholdsvalidering",
      );
      return "Kun JPG, PNG og WebP-bilder er tillatt som vedlegg";
    }
  }
  return null;
}

/**
 * POST /api/kontakt
 * Offentlig endepunkt for kontakthenvendelser
 */
router.post(
  "/",
  rateLimitContact,
  (req, res, next) => {
    upload.array("attachments", KONTAKT_MAX_ATTACHMENTS)(req, res, (error) => {
      if (!error) {
        return next();
      }

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          return apiError.badRequest(
            res,
            `Hvert bilde må være mindre enn ${Math.floor(KONTAKT_MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))} MB`,
          );
        }
        if (error.code === "LIMIT_FILE_COUNT") {
          return apiError.badRequest(
            res,
            `Du kan laste opp maks ${KONTAKT_MAX_ATTACHMENTS} bilder`,
          );
        }
      }

      if (error instanceof Error && error.message === INVALID_ATTACHMENT_TYPE_ERROR) {
        return apiError.badRequest(
          res,
          "Kun JPG, PNG og WebP-bilder er tillatt som vedlegg",
        );
      }

      logger.info({ err: error }, "Kontaktskjema: ugyldig vedlegg avvist");
      return apiError.badRequest(
        res,
        "Kun JPG, PNG og WebP-bilder er tillatt som vedlegg",
      );
    });
  },
  async (req: Request, res: Response) => {
  // Konverter requestId til string - req.id kan være string | number | object
  const rawId = req.id;
  const requestId = typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : undefined;

  // Valider request body
  const parseResult = KontaktRequestSchema.safeParse(extractKontaktPayload(req));
  if (!parseResult.success) {
    return sendZodError(res, parseResult.error, "Kontaktskjema");
  }

  const attachmentValidationError = validateKontaktAttachments(
    req.files as Express.Multer.File[] | undefined,
  );
  if (attachmentValidationError) {
    return apiError.badRequest(res, attachmentValidationError);
  }

  const { navn, epost, emne, melding, turnstileToken, nettsted, sideUrl } =
    parseResult.data;
  const attachments = buildKontaktAttachments(req.files as Express.Multer.File[] | undefined);

  // Honeypot-sjekk: nettsted-feltet skal være tomt
  if (nettsted && nettsted.length > 0) {
    // Logg som potensiell bot, men returner generisk suksess for å unngå informasjonslekkasje
    logger.info({ requestId }, "Kontaktskjema: honeypot utløst");
    return res.json(
      KontaktResponseSchema.parse({
        suksess: true,
        melding: "Takk for din henvendelse! Vi svarer så snart vi kan.",
      }),
    );
  }

  // Verifiser Turnstile-token
  if (!isTurnstileConfigured()) {
    if (isProd) {
      logger.error("Turnstile ikke konfigurert i produksjon");
      return apiError.serviceUnavailable(res, "Kontaktskjema");
    }
    // Development: logg advarsel men fortsett
    logger.warn("DEV: Turnstile ikke konfigurert, hopper over verifisering");
  } else {
    const clientIp = req.ip || req.socket?.remoteAddress;
    const turnstileResult = await verifyTurnstileToken(turnstileToken, clientIp);

    if (!turnstileResult.success) {
      logger.info(
        { requestId, errorCodes: turnstileResult.errorCodes },
        "Turnstile-verifisering feilet",
      );
      return apiError.badRequest(
        res,
        "Verifisering feilet. Prøv igjen.",
      );
    }
  }

  // Send kontaktmelding
  try {
    const result = await sendKontaktmelding({
      navn,
      epost,
      emne,
        melding,
        sideUrl,
        timestamp: new Date().toISOString(),
        requestId,
        attachments,
      });

    if (!result.success) {
      logger.error(
        { requestId, error: result.error },
        "Kunne ikke sende kontaktmelding",
      );
      return apiError.serviceUnavailable(res, "Kontaktskjema");
    }

    // Logg suksess uten PII/meldingsinnhold
    logger.info(
      {
        requestId,
        epostDomene: epost.split("@")[1] ?? "unknown",
        emneLength: emne.length,
        meldingLength: melding.length,
        attachmentsCount: attachments.length,
      },
      "Kontakthenvendelse mottatt",
    );

    return res.json(
      KontaktResponseSchema.parse({
        suksess: true,
        melding: "Takk for din henvendelse! Vi svarer så snart vi kan.",
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "CONTACT_TRANSPORT_NOT_CONFIGURED") {
      return apiError.serviceUnavailable(res, "Kontaktskjema");
    }

    logger.error({ err: error, requestId }, "Ukjent feil i kontaktskjema");
    return apiError.serverError(res);
  }
});

export const contactRouter = router;
