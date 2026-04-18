/**
 * Flashcards API — genererer KI-baserte flashcards fra Canvas-kursinnhold.
 * POST /api/flashcards/generate — aksepterer forespørselen og returnerer jobId (asynkron).
 * GET  /api/flashcards/status/:jobId — poller for ferdig resultat.
 *
 * Bakgrunnsbehandling unngår Heroku sin 30s HTTP-timeout ved å sende
 * 202 Accepted umiddelbart og lagre resultatet i Redis når det er klart.
 */
import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import {
  FlashcardSchema,
  FlashcardsGenerateRequestSchema,
  FlashcardsGenerateResponseSchema,
  AsyncJobAcceptedSchema,
  AsyncJobStatusSchema,
} from "common/ki";
import { logger } from "../../utils/logger.js";
import {
  apiError,
  sendZodError,
  sendUnknownError,
  requireUserId,
} from "../../utils/apiError.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import { DEFAULT_MODEL } from "../ki/aiModels.js";
import { chatCompletion, isClientAvailable } from "../ki/aiClient.js";
import { knyttCanvasToken } from "../../middleware/auth.js";
import { loadCanvasContext, ensureCanvasSync } from "../../services/context-loader.service.js";
import { isSyncing, waitForSync } from "../../services/canvas-sync.service.js";
import {
  AI_COMPLETION_PUSH_MIN_DURATION_MS,
  sendAICompletionWebPush,
} from "../../services/webPush.service.js";
import {
  createCourseTargetedQuery,
  extractJsonArray,
} from "../ki/studyContentUtils.js";
import { getCache, setCache } from "../../cache/redis.js";

/** Maks ventetid på Canvas-sync før flashcards fortsetter med tilgjengelig data */
const FLASHCARD_SYNC_WAIT_MS = 8_000;

/** TTL for jobb-resultat i Redis (10 minutter) */
const JOB_TTL_SECONDS = 600;

/** Redis-nøkkelprefix for flashcard-jobber */
const JOB_KEY_PREFIX = "flashcard-job:";

const router = Router();
router.use(rateLimitKi);

const FLASHCARDS_SYSTEM_PROMPT = `Du er en ekspert studieveileder som lager flashcards basert på kursmateriell.
Svar ALLTID med KUN et JSON-array uten ekstra tekst, markdown eller forklaring.
Hvert objekt i arrayet skal ha:
- "front": spørsmålet eller begrepet som skal læres
- "back": svaret eller forklaringen (1-3 setninger)

Regler:
- Flashcards skal dekke viktige konsepter, definisjoner og sammenhenger
- Varier mellom enkle definisjoner og mer komplekse forståelsesspørsmål
- Bruk samme språk som kursmateriellet (norsk hvis materiellet er norsk, engelsk hvis engelsk)
- Basér flashcards UTELUKKENDE på det medfølgende kursmateriellet — ikke bruk ekstern kunnskap
- Hold svarene konsise men fullstendige
- Dekk ulike deler av materiellet — ikke lag flere kort om samme konsept
- Bruk fagterminologi fra kursmateriellet`;

/**
 * Kjører selve flashcard-genereringen i bakgrunnen og lagrer resultatet i Redis.
 */
async function processFlashcardJob(
  jobId: string,
  userId: string,
  canvasToken: string,
  canvasBaseUrl: string | undefined,
  courseId: number,
  courseName: string,
  moduleNames: string[],
  fileNames: string[],
  cardCount: number,
): Promise<void> {
  const generationStartedAt = Date.now();
  try {
    await ensureCanvasSync(userId, canvasToken, canvasBaseUrl);
    if (isSyncing(userId)) {
      logger.info({ userId, courseId }, "Venter på Canvas sync før flashcard-generering");
      await waitForSync(userId, FLASHCARD_SYNC_WAIT_MS);
    }

    const allNames = [...moduleNames, ...fileNames];
    const contentListStr = allNames.join(", ");
    const contextResult = await loadCanvasContext(
      userId,
      canvasToken,
      "canvas_full",
      createCourseTargetedQuery(courseId, courseName, moduleNames, fileNames),
      `Flashcards om ${contentListStr} i ${courseName}`,
      canvasBaseUrl,
    );

    if (!contextResult.hasCanvasData) {
      logger.warn(
        {
          userId,
          courseId,
          courseName,
          moduleCount: moduleNames.length,
          fileCount: fileNames.length,
          contextSource: contextResult.source,
          syncWaited: !!contextResult.syncWaited,
          reason: contextResult.syncWaited ? "sync_just_triggered_no_chunks_yet" : "no_chunks_for_selection",
        },
        "Flashcards-generering avbrutt: ingen Canvas-data for valgte moduler/filer",
      );
      await setCache(
        `${JOB_KEY_PREFIX}${jobId}`,
        JSON.stringify({ status: "failed", error: "Ingen kursinnhold funnet for valgte moduler/filer. Prøv å åpne KI-chatten først slik at Canvas-data synkroniseres." }),
        JOB_TTL_SECONDS,
      );
      return;
    }

    const userPrompt = `Lag ${cardCount} flashcards om følgende innhold i emnet "${courseName}":
${allNames.map((m) => `- ${m}`).join("\n")}

KURSMATERIELL:
${contextResult.kontekst}

Generer nøyaktig ${cardCount} flashcards som JSON-array.`;

    logger.info(
      { userId, courseId, courseName, contextLength: contextResult.kontekst.length },
      "Starter flashcard-generering via Claude",
    );

    const result = await chatCompletion({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: FLASHCARDS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.7,
      traceName: "flashcards-generate",
      traceMeta: {
        userId,
        courseId,
        intent: "canvas_full",
        mode: "flashcards",
      },
    });

    logger.info(
      { userId, courseId, responseLength: result.text.length },
      "Claude-svar mottatt for flashcard-generering",
    );

    // Defensiv størrelses-guard mot uvanlig stort LLM-svar (OOM/blocking).
    const MAX_RESPONSE_BYTES = 1_000_000; // 1 MB
    if (result.text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`Flashcard-svaret er for stort (${result.text.length} bytes)`);
    }

    const rawFlashcards = z
      .array(FlashcardSchema.omit({ id: true }))
      .min(1)
      .max(50)
      .parse(JSON.parse(extractJsonArray(result.text)));

    const flashcards = rawFlashcards.map((f) => ({
      id: randomUUID(),
      ...f,
    }));

    logger.info(
      { userId, courseName, moduleNames, cardCount: flashcards.length },
      "Genererte flashcards via KI",
    );

    const responsePayload = FlashcardsGenerateResponseSchema.parse({ flashcards });
    await setCache(
      `${JOB_KEY_PREFIX}${jobId}`,
      JSON.stringify({ status: "completed", result: responsePayload }),
      JOB_TTL_SECONDS,
    );

    const generationDurationMs = Date.now() - generationStartedAt;
    if (generationDurationMs >= AI_COMPLETION_PUSH_MIN_DURATION_MS) {
      void sendAICompletionWebPush({
        userId,
        title: "StudyWise: Flashcards er klare",
        body: "KI har generert flashcards for deg.",
        url: "/dashboard?view=flashcards",
        tag: `studywise-ai-flashcards-${userId}-${courseId}`,
      }).catch((err) => {
        logger.warn(
          { err, userId, courseId },
          "Kunne ikke sende nettleservarsel for ferdige flashcards",
        );
      });
    }
  } catch (error) {
    logger.error({ err: error, jobId, userId, courseId }, "Flashcard-jobb feilet");
    await setCache(
      `${JOB_KEY_PREFIX}${jobId}`,
      JSON.stringify({ status: "failed", error: "Kunne ikke generere flashcards. Prøv igjen." }),
      JOB_TTL_SECONDS,
    ).catch((err) => {
      logger.warn({ err, jobId, userId }, "Kunne ikke skrive failed-status til cache (flashcards)");
    });
  }
}

// POST /api/flashcards/generate — returnerer jobId umiddelbart (202 Accepted)
router.post("/generate", rateLimitKi, knyttCanvasToken, async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = FlashcardsGenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "flashcards generate");
    }

    if (!isClientAvailable(DEFAULT_MODEL)) {
      return apiError.serviceUnavailable(res, "KI-tjenesten");
    }

    if (!req.canvasToken) {
      return apiError.unauthorized(res, "Canvas-token mangler");
    }

    const { courseId, courseName, moduleNames, fileNames, cardCount } = parsed.data;
    const jobId = randomUUID();

    await setCache(
      `${JOB_KEY_PREFIX}${jobId}`,
      JSON.stringify({ status: "pending" }),
      JOB_TTL_SECONDS,
    );

    void processFlashcardJob(
      jobId,
      userId,
      req.canvasToken,
      req.canvasBaseUrl,
      courseId,
      courseName,
      moduleNames ?? [],
      fileNames ?? [],
      cardCount,
    );

    return res.status(202).json(AsyncJobAcceptedSchema.parse({ jobId }));
  } catch (error) {
    if (res.headersSent) return;
    return sendUnknownError(res, error, {
      kontekst: "POST flashcards generate",
      melding: "Kunne ikke starte flashcard-generering. Prøv igjen.",
    });
  }
});

// GET /api/flashcards/status/:jobId — sjekker jobb-status
router.get("/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId || !z.uuid().safeParse(jobId).success) {
      return apiError.badRequest(res, "Ugyldig jobb-ID");
    }

    const cached = await getCache(`${JOB_KEY_PREFIX}${jobId}`);
    if (!cached) {
      return apiError.notFound(res, "Jobben finnes ikke eller har utløpt");
    }

    const parsed = AsyncJobStatusSchema.safeParse(JSON.parse(cached));
    if (!parsed.success) {
      return apiError.serverError(res);
    }
    return res.json(parsed.data);
  } catch (error) {
    if (res.headersSent) return;
    return sendUnknownError(res, error, {
      kontekst: "GET flashcards status",
      melding: "Kunne ikke sjekke jobb-status.",
    });
  }
});

export default router;
