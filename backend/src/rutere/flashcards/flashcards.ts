/**
 * Flashcards API — genererer KI-baserte flashcards fra Canvas-kursinnhold.
 * POST /api/flashcards/generate — tar courseId, moduleNames, cardCount
 * og returnerer flashcards generert av Claude.
 */
import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
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
import { loadCanvasContext } from "../../services/context-loader.service.js";
import {
  createCourseTargetedQuery,
  extractJsonArray,
} from "../ki/studyContentUtils.js";

const router = Router();
router.use(rateLimitKi);

const GenerateFlashcardsRequestSchema = z.object({
  courseId: z.number(),
  courseName: z.string().min(1),
  moduleNames: z.array(z.string().min(1)).min(1),
  cardCount: z.number().min(1).max(50).default(10),
});

const FlashcardDraftSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
});

const FLASHCARDS_SYSTEM_PROMPT = `Du er en ekspert studieveileder som lager flashcards basert på kursmateriell.
Svar ALLTID med KUN et JSON-array uten ekstra tekst, markdown eller forklaring.
Hvert objekt i arrayet skal ha:
- "front": spørsmålet eller begrepet som skal læres (norsk)
- "back": svaret eller forklaringen (norsk, 1-3 setninger)

Regler:
- Flashcards skal dekke viktige konsepter, definisjoner og sammenhenger
- Varier mellom enkle definisjoner og mer komplekse forståelsesspørsmål
- Bruk norsk språk
- Basér flashcards UTELUKKENDE på det medfølgende kursmateriellet
- Hold svarene konsise men fullstendige`;

// POST /api/flashcards/generate
router.post("/generate", knyttCanvasToken, async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = GenerateFlashcardsRequestSchema.safeParse(req.body);
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

    const contextBlock = contextResult.hasCanvasData
      ? `\n\nKURSMATERIELL:\n${contextResult.kontekst}`
      : "";

    const userPrompt = `Lag ${cardCount} flashcards om følgende moduler i emnet "${courseName}":
${moduleNames.map((m) => `- ${m}`).join("\n")}
${contextBlock}

Generer nøyaktig ${cardCount} flashcards som JSON-array.`;

    const result = await chatCompletion({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: FLASHCARDS_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.7,
      signal: req.timeoutSignal,
    });

    const rawFlashcards = z
      .array(FlashcardDraftSchema)
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

    return res.headersSent ? undefined : res.json({ flashcards });
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
