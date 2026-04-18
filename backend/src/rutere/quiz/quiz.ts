/**
 * Quiz API — genererer KI-baserte quizer fra Canvas-kursinnhold.
 * POST /api/quiz/generate — aksepterer forespørselen og returnerer jobId (asynkron).
 * GET  /api/quiz/status/:jobId — poller for ferdig resultat.
 *
 * Bakgrunnsbehandling unngår Heroku sin 30s HTTP-timeout ved å sende
 * 202 Accepted umiddelbart og lagre resultatet i Redis når det er klart.
 */
import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import {
  QuizGenerateRequestSchema,
  QuizGenerateResponseSchema,
  QuizQuestionSchema,
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

/** Maks ventetid på Canvas-sync før quiz fortsetter med tilgjengelig data */
const QUIZ_SYNC_WAIT_MS = 8_000;

/** TTL for jobb-resultat i Redis (10 minutter) */
const JOB_TTL_SECONDS = 600;

/** Redis-nøkkelprefix for quiz-jobber */
const JOB_KEY_PREFIX = "quiz-job:";

const router = Router();
router.use(rateLimitKi);

const QUIZ_SYSTEM_PROMPT = `Du er en ekspert studieveileder som lager quiz-spørsmål basert på kursmateriell.
Svar ALLTID med KUN et JSON-array uten ekstra tekst, markdown eller forklaring.
Hvert objekt i arrayet skal ha:
- "question": spørsmålet
- "options": nøyaktig 4 svaralternativer (array med 4 strenger)
- "correctIndex": indeks (0-3) til riktig svar
- "explanation": kort forklaring på hvorfor svaret er riktig (1-3 setninger)

Regler:
- Spørsmålene skal variere i vanskelighetsgrad (lett, middels, vanskelig)
- Alternativene skal være plausible — unngå åpenbart feil distraktorer
- Bruk samme språk som kursmateriellet (norsk hvis materiellet er norsk, engelsk hvis engelsk)
- Basér spørsmålene UTELUKKENDE på det medfølgende kursmateriellet — ikke bruk ekstern kunnskap
- Shuffle riktig svar-posisjon — IKKE sett correctIndex til 0 for alle spørsmål
- Dekk ulike deler av materiellet — ikke still flere spørsmål om samme konsept
- Bruk fagterminologi fra kursmateriellet`;

/**
 * Kjører selve quiz-genereringen i bakgrunnen og lagrer resultatet i Redis.
 * Kalles som fire-and-forget fra POST-endepunktet.
 */
async function processQuizJob(
  jobId: string,
  userId: string,
  canvasToken: string,
  canvasBaseUrl: string | undefined,
  courseId: number,
  courseName: string,
  moduleNames: string[],
  fileNames: string[],
  questionCount: number,
): Promise<void> {
  const generationStartedAt = Date.now();
  try {
    // Sørg for at Canvas-data er synkronisert
    await ensureCanvasSync(userId, canvasToken, canvasBaseUrl);
    if (isSyncing(userId)) {
      logger.info({ userId, courseId }, "Venter på Canvas sync før quiz-generering");
      await waitForSync(userId, QUIZ_SYNC_WAIT_MS);
    }

    // Hent Canvas-kontekst
    const allNames = [...moduleNames, ...fileNames];
    const contentListStr = allNames.join(", ");
    const contextResult = await loadCanvasContext(
      userId,
      canvasToken,
      "canvas_full",
      createCourseTargetedQuery(courseId, courseName, moduleNames, fileNames),
      `Quiz om ${contentListStr} i ${courseName}`,
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
        "Quiz-generering avbrutt: ingen Canvas-data for valgte moduler/filer",
      );
      await setCache(
        `${JOB_KEY_PREFIX}${jobId}`,
        JSON.stringify({ status: "failed", error: "Ingen kursinnhold funnet for valgte moduler/filer. Prøv å åpne KI-chatten først slik at Canvas-data synkroniseres." }),
        JOB_TTL_SECONDS,
      );
      return;
    }

    const userPrompt = `Lag ${questionCount} quiz-spørsmål om følgende innhold i emnet "${courseName}":
${allNames.map((m) => `- ${m}`).join("\n")}

KURSMATERIELL:
${contextResult.kontekst}

Generer nøyaktig ${questionCount} spørsmål som JSON-array.`;

    logger.info(
      { userId, courseId, courseName, contextLength: contextResult.kontekst.length },
      "Starter quiz-generering via Claude",
    );

    const result = await chatCompletion({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: QUIZ_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.7,
      traceName: "quiz-generate",
      traceMeta: {
        userId,
        courseId,
        intent: "canvas_full",
        mode: "quiz",
      },
    });

    logger.info(
      { userId, courseId, responseLength: result.text.length },
      "Claude-svar mottatt for quiz-generering",
    );

    // Defensiv størrelses-guard: max_tokens er ikke det samme som bytes — et uvanlig
    // stort svar kan gi OOM eller blokkere event loop i JSON.parse.
    const MAX_RESPONSE_BYTES = 1_000_000; // 1 MB
    if (result.text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`Quiz-svaret er for stort (${result.text.length} bytes)`);
    }

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

    // Lagre ferdig resultat i Redis
    const responsePayload = QuizGenerateResponseSchema.parse({ questions });
    await setCache(
      `${JOB_KEY_PREFIX}${jobId}`,
      JSON.stringify({ status: "completed", result: responsePayload }),
      JOB_TTL_SECONDS,
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
  } catch (error) {
    logger.error({ err: error, jobId, userId, courseId }, "Quiz-jobb feilet");
    await setCache(
      `${JOB_KEY_PREFIX}${jobId}`,
      JSON.stringify({ status: "failed", error: "Kunne ikke generere quiz. Prøv igjen." }),
      JOB_TTL_SECONDS,
    ).catch((err) => {
      logger.warn({ err, jobId, userId }, "Kunne ikke skrive failed-status til cache (quiz)");
    });
  }
}

// POST /api/quiz/generate — returnerer jobId umiddelbart (202 Accepted)
router.post("/generate", rateLimitKi, knyttCanvasToken, async (req, res) => {
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

    const { courseId, courseName, moduleNames, fileNames, questionCount } = parsed.data;
    const jobId = randomUUID();

    // Sett initial status i Redis
    await setCache(
      `${JOB_KEY_PREFIX}${jobId}`,
      JSON.stringify({ status: "pending" }),
      JOB_TTL_SECONDS,
    );

    // Start bakgrunnsjobben — ikke await
    void processQuizJob(
      jobId,
      userId,
      req.canvasToken,
      req.canvasBaseUrl,
      courseId,
      courseName,
      moduleNames ?? [],
      fileNames ?? [],
      questionCount,
    );

    return res.status(202).json(AsyncJobAcceptedSchema.parse({ jobId }));
  } catch (error) {
    if (res.headersSent) return;
    return sendUnknownError(res, error, {
      kontekst: "POST quiz generate",
      melding: "Kunne ikke starte quiz-generering. Prøv igjen.",
    });
  }
});

// GET /api/quiz/status/:jobId — sjekker jobb-status
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
      kontekst: "GET quiz status",
      melding: "Kunne ikke sjekke jobb-status.",
    });
  }
});

export default router;
