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
import { KontaktRequestSchema, KontaktResponseSchema } from "common/contact";
import { logger } from "../../utils/logger.js";
import { apiError, sendZodError } from "../../utils/apiError.js";
import { rateLimitContact } from "../../middleware/rate-limit.js";
import {
  verifyTurnstileToken,
  isTurnstileConfigured,
} from "../../services/turnstile.service.js";
import { sendKontaktmelding } from "../../services/contact.service.js";
import { isProd } from "../../utils/env.js";

const router = Router();

/**
 * POST /api/kontakt
 * Offentlig endepunkt for kontakthenvendelser
 */
router.post("/", rateLimitContact, async (req: Request, res: Response) => {
  // Konverter requestId til string - req.id kan være string | number | object
  const rawId = req.id;
  const requestId = typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : undefined;

  // Valider request body
  const parseResult = KontaktRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    return sendZodError(res, parseResult.error, "Kontaktskjema");
  }

  const { navn, epost, emne, melding, turnstileToken, nettsted, sideUrl } =
    parseResult.data;

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
