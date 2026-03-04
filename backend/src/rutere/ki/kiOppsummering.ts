/*
 * KI Oppsummering-endepunkt
 * Genererer TL;DR og handlingspunkter fra kunngjøringstekst
 */

import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { logger } from "../../utils/logger.js";
import { stripHtml } from "../../utils/htmlUtils.js";
import {
  KIOppsummeringRequestSchema,
  KIOppsummeringResponseSchema,
} from "common/ki";
import { createRateLimiter } from "../../middleware/rate-limit.js";
import { getCache, setCache } from "../../cache/redis.js";
import { sendZodError, sendUnknownError } from "../../utils/apiError.js";
import { DEFAULT_MODEL } from "./aiModels.js";
import { chatCompletion, isClientAvailable } from "./aiClient.js";
import { isProd } from "../../utils/env.js";
import { KI_OPPSUMMERING_CACHE_TTL } from "./kiConstants.js";

const router = Router();
const rateLimitOppsummering = isProd
  ? createRateLimiter({
      points: 10,
      duration: 60,
      keyPrefix: "rlflx:ki:oppsummering",
    })
  : createRateLimiter({
      points: 100,
      duration: 60,
      keyPrefix: "rlflx:ki:oppsummering:dev",
    });

/**
 * POST /oppsummering
 * Oppsummerer kunngjøringstekst med KI
 */
router.post(
  "/oppsummering",
  rateLimitOppsummering,
  async (req: Request, res: Response) => {
    // Valider request body
    const parsed = KIOppsummeringRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(
        res,
        parsed.error,
        "Ugyldig oppsummering-forespørsel",
      );
    }

    const { tekst, type } = parsed.data;

    if (!isClientAvailable(DEFAULT_MODEL)) {
      logger.error("AI-klient ikke tilgjengelig for oppsummering");
      return res.status(500).json(
        KIOppsummeringResponseSchema.parse({
          suksess: false,
          melding: "KI-tjenesten er ikke konfigurert. Kontakt administrator.",
        }),
      );
    }

    // Stripp HTML fra teksten
    const renTekst = stripHtml(tekst);
    if (!renTekst || renTekst.length < 10) {
      return res.status(400).json(
        KIOppsummeringResponseSchema.parse({
          suksess: false,
          melding: "Kunngjøringsteksten er for kort til å oppsummere.",
        }),
      );
    }

    // Sjekk cache
    const cacheKey = `ki:oppsummering:${crypto.createHash("sha256").update(`${renTekst}:${type}`).digest("hex").slice(0, 32)}`;
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        logger.info("Oppsummering hentet fra cache");
        return res.json(JSON.parse(cached));
      }
    } catch {
      // Cache-feil ignoreres
    }

    // Bygg system prompt basert på type
    let instruksjon: string;
    if (type === "tldr") {
      instruksjon =
        "Gi en kort TL;DR-oppsummering av denne kunngjøringen på 1-3 setninger. Skriv på norsk bokmål.";
    } else if (type === "handlinger") {
      instruksjon =
        "List opp konkrete handlingspunkter (ting studenten MÅ gjøre) fra denne kunngjøringen. Returner som en nummerert liste. Hvis det ikke er noen handlingspunkter, si det. Skriv på norsk bokmål.";
    } else {
      instruksjon = `Analyser denne kunngjøringen og gi:
1. En kort TL;DR-oppsummering (1-3 setninger)
2. En liste med konkrete handlingspunkter (ting studenten MÅ gjøre)

Format svaret ditt NØYAKTIG slik:
OPPSUMMERING: <din oppsummering>
HANDLINGER:
- <handling 1>
- <handling 2>

Hvis det ikke er noen handlingspunkter, skriv "HANDLINGER: Ingen handlingspunkter." Skriv på norsk bokmål.`;
    }

    try {
      const TIMEOUT_MS = 30000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("OPPSUMMERING_TIMEOUT")), TIMEOUT_MS),
      );

      const result = await Promise.race([
        chatCompletion({
          model: DEFAULT_MODEL,
          messages: [
            { role: "system", content: instruksjon },
            { role: "user", content: renTekst.slice(0, 10000) },
          ],
          max_tokens: 512,
          temperature: 0.3,
        }),
        timeoutPromise,
      ]);

      const responseText = result.text;

      // Parse respons basert på type
      let oppsummering: string | undefined;
      let handlinger: string[] | undefined;

      if (type === "tldr") {
        oppsummering = responseText.trim();
      } else if (type === "handlinger") {
        handlinger = responseText
          .split("\n")
          .map((l) =>
            l
              .replace(/^\d+\.\s*/, "")
              .replace(/^[-*]\s*/, "")
              .trim(),
          )
          .filter((l) => l.length > 0);
      } else {
        // Parse "begge" format
        const oppsummeringMatch = responseText.match(
          /OPPSUMMERING:\s*([\s\S]*?)(?=HANDLINGER:|$)/i,
        );
        const handlingerMatch = responseText.match(
          /HANDLINGER:\s*([\s\S]*?)$/i,
        );

        oppsummering = oppsummeringMatch?.[1]?.trim() || responseText.trim();

        if (handlingerMatch?.[1]) {
          const handlingerTekst = handlingerMatch[1].trim();
          if (
            !handlingerTekst.toLowerCase().includes("ingen handlingspunkter")
          ) {
            handlinger = handlingerTekst
              .split("\n")
              .map((l) =>
                l
                  .replace(/^\d+\.\s*/, "")
                  .replace(/^[-*]\s*/, "")
                  .trim(),
              )
              .filter((l) => l.length > 0);
          }
        }
      }

      const response = KIOppsummeringResponseSchema.parse({
        suksess: true,
        oppsummering,
        handlinger,
      });

      // Cache resultatet
      try {
        await setCache(
          cacheKey,
          JSON.stringify(response),
          KI_OPPSUMMERING_CACHE_TTL,
        );
      } catch {
        // Cache-feil ignoreres
      }

      logger.info(
        { type, tekstLengde: renTekst.length },
        "Oppsummering generert",
      );
      return res.json(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage === "OPPSUMMERING_TIMEOUT") {
        return res.status(504).json(
          KIOppsummeringResponseSchema.parse({
            suksess: false,
            melding: "Oppsummeringen tok for lang tid. Prøv igjen.",
          }),
        );
      }

      if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
        return res.status(429).json(
          KIOppsummeringResponseSchema.parse({
            suksess: false,
            melding: "For mange forespørsler. Vent litt og prøv igjen.",
          }),
        );
      }

      return sendUnknownError(res, error, { kontekst: "kiOppsummering" });
    }
  },
);

export const kiOppsummeringRouter = router;
