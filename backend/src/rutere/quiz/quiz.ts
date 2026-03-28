/**
 * Quiz API — genererer KI-baserte quizer fra Canvas-kursinnhold.
 * POST /api/quiz/generate — tar courseId, moduleNames, questionCount
 * og returnerer quiz-spørsmål generert av Claude.
 */
import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import {
  QuizGenerateRequestSchema,
  QuizGenerateResponseSchema,
  QuizQuestionSchema,
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
import { loadCanvasContext } from "../../services/context-loader.service.js";
import {
  AI_COMPLETION_PUSH_MIN_DURATION_MS,
  sendAICompletionWebPush,
} from "../../services/webPush.service.js";
import {
  createCourseTargetedQuery,
  extractJsonArray,
} from "../ki/studyContentUtils.js";

const router = Router();
router.use(rateLimitKi);

const QUIZ_SYSTEM_PROMPT = `Du er en ekspert studieveileder som lager quiz-spørsmål basert på kursmateriell.
Svar ALLTID med KUN et JSON-array uten ekstra tekst, markdown eller forklaring.
Hvert objekt i arrayet skal ha:
- "question": spørsmålet (norsk)
- "options": nøyaktig 4 svaralternativer (array med 4 strenger)
- "correctIndex": indeks (0-3) til riktig svar
- "explanation": kort forklaring på hvorfor svaret er riktig (1-3 setninger)

Regler:
- Spørsmålene skal variere i vanskelighetsgrad (lett, middels, vanskelig)
- Alternativene skal være plausible — unngå åpenbart feil distraktorer
- Bruk norsk språk
- Basér spørsmålene UTELUKKENDE på det medfølgende kursmateriellet
- Shuffle riktig svar-posisjon — IKKE sett correctIndex til 0 for alle spørsmål`;

// POST /api/quiz/generate
router.post("/generate", knyttCanvasToken, async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = QuizGenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "quiz generate");
    }

    if (!isClientAvailable(DEFAULT_MODEL)) {
      return apiError.serviceUnavailable(res, "KI-tjenesten");
    }

    if (!req.canvasToken) {
      return apiError.unauthorized(res, "Canvas-token mangler");
    }

    const { courseId, courseName, moduleNames, questionCount } = parsed.data;
    const generationStartedAt = Date.now();

    // Hent Canvas-kontekst for kurset via context-loader (bruker hybrid søk + Redis/MongoDB)
    const moduleListStr = moduleNames.join(", ");
    const contextResult = await loadCanvasContext(
      userId,
      req.canvasToken,
      "canvas_full",
      createCourseTargetedQuery(courseId, courseName, moduleNames),
      `Quiz om ${moduleListStr} i ${courseName}`,
      req.canvasBaseUrl,
    );

    const contextBlock = contextResult.hasCanvasData
      ? `\n\nKURSMATERIELL:\n${contextResult.kontekst}`
      : "";

    const userPrompt = `Lag ${questionCount} quiz-spørsmål om følgende moduler i emnet "${courseName}":
${moduleNames.map((m) => `- ${m}`).join("\n")}
${contextBlock}

Generer nøyaktig ${questionCount} spørsmål som JSON-array.`;

    const result = await chatCompletion({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: QUIZ_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.7,
      signal: req.timeoutSignal,
    });

    const rawQuestions = z
      .array(QuizQuestionSchema.omit({ id: true }))
      .min(1)
      .max(50)
      .parse(JSON.parse(extractJsonArray(result.text)));

    const questions = rawQuestions.map((q) => ({
      id: randomUUID(),
      ...q,
    }));

    logger.info(
      { userId, courseName, moduleNames, questionCount: questions.length },
      "Genererte quiz-spørsmål via KI",
    );

    const generationDurationMs = Date.now() - generationStartedAt;
    if (generationDurationMs >= AI_COMPLETION_PUSH_MIN_DURATION_MS) {
      void sendAICompletionWebPush({
        userId,
        title: "StudyWise: Quizen er klar",
        body: "KI har generert quiz-spørsmål for deg.",
        url: "/dashboard?view=quiz",
        tag: `studywise-ai-quiz-${userId}-${courseId}`,
      }).catch((err) => {
        logger.warn(
          { err, userId, courseId },
          "Kunne ikke sende nettleservarsel for ferdig quiz",
        );
      });
    }

    return res.headersSent
      ? undefined
      : res.json(
          QuizGenerateResponseSchema.parse({
            questions,
          }),
        );
  } catch (error) {
    if (res.headersSent || res.writableEnded || req.timeoutSignal?.aborted) return;
    if (
      handleAIJsonRouteError(res, error, {
        kontekst: "quiz-generate",
        timeoutMessage: "Quiz-genereringen tok for lang tid. Prøv igjen.",
        invalidResponseMessage: "KI-responsen kunne ikke tolkes som quiz-spørsmål",
        invalidResponseTest: (candidate) =>
          candidate instanceof Error && candidate.message === "AI_RESPONSE_NOT_JSON_ARRAY",
      })
    ) {
      return;
    }

    return sendUnknownError(res, error, {
      kontekst: "POST quiz generate",
      melding: "Kunne ikke generere quiz. Prøv igjen.",
    });
  }
});

export default router;
