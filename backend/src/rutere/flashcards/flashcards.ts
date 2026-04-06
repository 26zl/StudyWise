/**
 * Flashcards API — genererer KI-baserte flashcards fra Canvas-kursinnhold.
 * POST /api/flashcards/generate — tar courseId, moduleNames, cardCount
 * og returnerer flashcards generert av Claude.
 */
import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import {
  FlashcardSchema,
  FlashcardsGenerateRequestSchema,
  FlashcardsGenerateResponseSchema,
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
import { handleAIJsonRouteError } from "../ki/handleAIError.js";
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

/** Maks ventetid på Canvas-sync før flashcards fortsetter med tilgjengelig data */
const FLASHCARD_SYNC_WAIT_MS = 8_000;

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

// POST /api/flashcards/generate
router.post("/generate", knyttCanvasToken, async (req, res) => {
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

    const { courseId, courseName, moduleNames, cardCount } = parsed.data;
    const generationStartedAt = Date.now();

    // Sørg for at Canvas-data er synkronisert før vi henter kontekst.
    await ensureCanvasSync(userId, req.canvasToken, req.canvasBaseUrl);
    if (isSyncing(userId)) {
      logger.info({ userId, courseId }, "Venter på Canvas sync før flashcard-generering");
      await waitForSync(userId, FLASHCARD_SYNC_WAIT_MS);
    }

    // Hent Canvas-kontekst for kurset via context-loader (bruker hybrid søk + Redis/MongoDB)
    const moduleListStr = moduleNames.join(", ");
    const contextResult = await loadCanvasContext(
      userId,
      req.canvasToken,
      "canvas_full",
      createCourseTargetedQuery(courseId, courseName, moduleNames),
      `Flashcards om ${moduleListStr} i ${courseName}`,
      req.canvasBaseUrl,
    );

    if (!contextResult.hasCanvasData) {
      return apiError.badRequest(res, "Ingen kursinnhold funnet for valgte moduler. Prøv å åpne KI-chatten først slik at Canvas-data synkroniseres.");
    }

    const userPrompt = `Lag ${cardCount} flashcards om følgende moduler i emnet "${courseName}":
${moduleNames.map((m) => `- ${m}`).join("\n")}

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
      signal: req.timeoutSignal,
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

    const generationDurationMs = Date.now() - generationStartedAt;
    if (generationDurationMs >= AI_COMPLETION_PUSH_MIN_DURATION_MS) {
      void sendAICompletionWebPush({
        userId,
        title: "StudyWise: Flashcards er klare",
        body: "KI har generert flashcards for deg.",
        url: "/dashboard?view=quiz",
        tag: `studywise-ai-flashcards-${userId}-${courseId}`,
      }).catch((err) => {
        logger.warn(
          { err, userId, courseId },
          "Kunne ikke sende nettleservarsel for ferdige flashcards",
        );
      });
    }

    return res.headersSent
      ? undefined
      : res.json(
          FlashcardsGenerateResponseSchema.parse({
            flashcards,
          }),
        );
  } catch (error) {
    if (res.headersSent || res.writableEnded || req.timeoutSignal?.aborted) return;
    if (
      handleAIJsonRouteError(res, error, {
        kontekst: "flashcards-generate",
        timeoutMessage: "Flashcard-genereringen tok for lang tid. Prøv igjen.",
        invalidResponseMessage: "KI-responsen kunne ikke tolkes som flashcards",
        invalidResponseTest: (candidate) =>
          candidate instanceof Error && candidate.message === "AI_RESPONSE_NOT_JSON_ARRAY",
      })
    ) {
      return;
    }

    return sendUnknownError(res, error, {
      kontekst: "POST flashcards generate",
      melding: "Kunne ikke generere flashcards. Prøv igjen.",
    });
  }
});

export default router;
