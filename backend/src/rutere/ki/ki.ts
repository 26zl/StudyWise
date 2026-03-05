/*
* Rutere for KI-relaterte endepunkter
* Støtter flere leverandører: HuggingFace og Anthropic (Claude)
*/

import { Router } from "express";
import { logger } from "../../utils/logger.js";
import { apiError } from "../../utils/apiError.js";
import { getCache, setCache } from "../../cache/redis.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import {
    KIChatRequestSchema,
    KIChatResponseSchema,
    KIModelsResponseSchema,
    KI_MAX_MESSAGE_LENGTH_BACKEND,
} from "common/ki";
import { byggKiCanvasKontekst, trimCanvasKontekst } from "./kiCanvas.js";
import { kiHistoryRouter } from "./kiHistory.js";
import { kiAnalyseRouter } from "./kiAnalyse.js";
import { SUPPORTED_MODELS, DEFAULT_MODEL } from "./aiModels.js";
import { STUDYWISE_SYSTEM_PROMPT } from "./systemPrompt.js";
import { chatCompletion, isClientAvailable, getMissingClientError } from "./aiClient.js";
import { handleAIError } from "./handleAIError.js";

// Definerer express router
const router = Router();
// Rate limiting for KI-endepunkter
router.use(rateLimitKi);
// Chat historikk ruter
router.use(kiHistoryRouter);
// Dokumentanalyse ruter
router.use(kiAnalyseRouter);

import { KI_CACHE_TTL, KI_TIMEOUT_MS } from "./kiConstants.js";

// Cache-konfigurasjon
const CACHE_KEY = "ki:test-connection";

// Endepunkt for å liste støttede modeller
router.get("/models", (_req, res) => {
  logger.info("Henter liste over støttede modeller");
  const models = Object.entries(SUPPORTED_MODELS).map(([id, info]) => ({
    id,
    name: info.name,
    description: info.description,
    isDefault: id === DEFAULT_MODEL,
  }));
  return res.json(
    KIModelsResponseSchema.parse({ models, defaultModel: DEFAULT_MODEL }),
  );
});

// Endepunkt for å teste tilkobling til AI-tjenesten
router.get("/test-connection", async (_req, res) => {
  logger.info("Testing AI connection...");

  // Sjekk cache først
  const cached = await getCache(CACHE_KEY);
  if (cached) {
    logger.info("Returnerer cachet KI test-resultat");
    return res.json(KIChatResponseSchema.parse(JSON.parse(cached)));
  }

  const model = DEFAULT_MODEL;

  if (!isClientAvailable(model)) {
    logger.error(getMissingClientError(model));
    return res.status(500).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: getMissingClientError(model),
        response: "",
      }),
    );
  }

  try {
    const result = await chatCompletion({
      model,
      messages: [
        { role: "system", content: STUDYWISE_SYSTEM_PROMPT },
        { role: "user", content: "Hei! Hvem er du?" },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    logger.info("Vellykket svar fra AI-tjenesten");
    const response = KIChatResponseSchema.parse({
      suksess: true,
      melding: "Vellykket kobling til AI-tjenesten!",
      response: result.text,
      model: model,
    });
    // Cache resultatet
    await setCache(CACHE_KEY, JSON.stringify(response), KI_CACHE_TTL);
    return res.json(response);
  } catch (error) {
    if (
      handleAIError(res, error, KIChatResponseSchema, {
        kontekst: "test-connection",
      })
    )
      return;

    return res.status(500).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding:
          "Feil under kommunikasjon med KI-tjenesten. Prøv igjen senere.",
        response: "",
      }),
    );
  }
});

// Hovedendepunkt for chat
router.post("/chat", async (req, res) => {
  logger.info("Mottok chat-forespørsel");

  // Sjekk autentisering
  if (!req.user?.id) {
    logger.warn("Chat-forespørsel uten autentisering");
    return apiError.unauthorized(res);
  }

  // Valider request body
  const parseResult = KIChatRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((issue) => issue.message)
      .join(", ");
    logger.warn(
      { errors: parseResult.error.issues, userId: req.user.id },
      "Ugyldig chat-forespørsel",
    );
    return res.status(400).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: "Ugyldig forespørsel: " + errorMessages,
        response: "",
      }),
    );
  }

  const {
    messages,
    model: requestedModel,
    temperature = 0.7,
  } = parseResult.data;

  // Valider meldingsarray
  if (!messages || messages.length === 0) {
    logger.warn({ userId: req.user.id }, "Tom meldingsarray");
    return res.status(400).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: "Du må sende minst en melding.",
        response: "",
      }),
    );
  }

  // Sjekk for veldig lange meldinger (unngå DoS)
  const totalLength = messages.reduce(
    (sum, m) => sum + (m.content?.length || 0),
    0,
  );
  if (totalLength > KI_MAX_MESSAGE_LENGTH_BACKEND) {
    logger.warn(
      {
        userId: req.user.id,
        totalLength,
        maxLength: KI_MAX_MESSAGE_LENGTH_BACKEND,
      },
      "Meldinger for lange",
    );
    return res.status(413).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: `Meldingene er for lange. Maksimalt ${KI_MAX_MESSAGE_LENGTH_BACKEND} tegn totalt. Start en ny samtale.`,
        response: "",
      }),
    );
  }

  // Velg modell (bruk forespurt modell hvis støttet, ellers default)
  const model =
    requestedModel && SUPPORTED_MODELS[requestedModel]
      ? requestedModel
      : DEFAULT_MODEL;

  if (!isClientAvailable(model)) {
    logger.error(getMissingClientError(model));
    return res.status(500).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: "KI-tjenesten er ikke konfigurert. Kontakt administrator.",
        response: "",
      }),
    );
  }

  if (requestedModel && !SUPPORTED_MODELS[requestedModel]) {
    logger.warn(
      { requestedModel },
      "Forespurt modell ikke støttet, bruker default",
    );
  }

  try {
    // Start med base system prompt
    let enhancedSystemPrompt = STUDYWISE_SYSTEM_PROMPT;

    // Filtrer ut eventuelle Canvas context-meldinger fra frontend
    // Backend henter alltid sin egen fullstendige Canvas-kontekst
    const filteredMessages = messages.filter(
      (m: { role: string; content: string }) =>
        !(m.role === "system" && m.content.includes("Canvas data")),
    );

    // Hent full Canvas-kontekst fra backend (moduler, sider, filer)
    let canvasKontekst: string;
    if (req.canvasToken) {
      canvasKontekst = await Promise.race([
        byggKiCanvasKontekst(req.canvasToken),
        new Promise<string>((resolve) =>
          setTimeout(
            () =>
              resolve("[CANVAS STATUS: Henting tok for lang tid. Prøv igjen.]"),
            KI_TIMEOUT_MS,
          ),
        ),
      ]);
      // Trim konteksten for å unngå token-overflyt
      canvasKontekst = trimCanvasKontekst(canvasKontekst);
      logger.info(
        { contextLength: canvasKontekst.length },
        "Hentet Canvas-context fra backend for KI",
      );
    } else {
      canvasKontekst =
        "[CANVAS STATUS: Ingen Canvas-token. Brukeren må legge inn token i Innstillinger.]";
    }

    // Sjekk om vi faktisk har Canvas-data
    const hasCanvasData =
      (canvasKontekst.includes("CANVAS-DATA") ||
        canvasKontekst.includes("KUNNGJØRINGER") ||
        canvasKontekst.includes("EMNER") ||
        canvasKontekst.includes("OPPGAVER") ||
        canvasKontekst.includes("FRISTER") ||
        canvasKontekst.includes("MODULER")) &&
      !canvasKontekst.includes("Ingen Canvas-token") &&
      !canvasKontekst.includes("IKKE lagt inn");

    logger.info(
      {
        hasCanvasData,
        canvasKontekstLength: canvasKontekst.length,
        harCanvasToken: !!req.canvasToken,
      },
      "Canvas-kontekst status",
    );

    // Hvis ingen Canvas-data tilgjengelig, informer brukeren
    if (!hasCanvasData) {
      return res.json(
        KIChatResponseSchema.parse({
          suksess: true,
          response:
            "Jeg har ikke tilgang til Canvas-data akkurat nå. Sjekk at du har:\n\n1. Lagt inn et gyldig Canvas API-token i Innstillinger\n2. Valgt minst ett datasett under «Gi AI tilgang til» i chatten",
          model: model,
        }),
      );
    }

    // Legg Canvas-kontekst inn i system-prompten (ikke som user-melding)
    // Dette forhindrer at konteksten akkumuleres i chat-historikken
    enhancedSystemPrompt += "\n\n" + canvasKontekst;

    // Bygg meldingsarray — kun system prompt + brukerens meldinger
    const fullMessages = [
      { role: "system" as const, content: enhancedSystemPrompt },
      ...filteredMessages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    // Dynamisk timeout og max_tokens basert på kontekststørrelse
    const harStorKontekst = canvasKontekst.length > 5000;
    const maxTokens = harStorKontekst ? 4096 : 1024;
    const TIMEOUT_MS = harStorKontekst ? 45000 : 25000;

    logger.info(
      {
        model,
        messageCount: fullMessages.length,
        harCanvasToken: !!req.canvasToken,
        maxTokens,
        timeoutMs: TIMEOUT_MS,
      },
      "Sender til AI-tjenesten",
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("CHAT_TIMEOUT")), TIMEOUT_MS),
    );

    const result = await Promise.race([
      chatCompletion({
        model,
        messages: fullMessages,
        max_tokens: maxTokens,
        temperature: Math.min(Math.max(temperature, 0), 2),
        skipFallback: harStorKontekst,
      }),
      timeoutPromise,
    ]);

    const responseText = result.text;
    const usage = result.usage;

    logger.info(
      {
        model,
        responseLength: responseText.length,
        tokens: usage?.total_tokens,
      },
      "Vellykket chat-svar",
    );

    return res.json(
      KIChatResponseSchema.parse({
        suksess: true,
        response: responseText,
        model: model,
        usage: usage
          ? {
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens,
            }
          : undefined,
      }),
    );
  } catch (error) {
    if (
      handleAIError(res, error, KIChatResponseSchema, {
        timeoutLabel: "CHAT_TIMEOUT",
        timeoutMessage:
          "Chat-forespørselen tok for lang tid. Prøv igjen eller forenkle spørsmålet.",
        kontekst: "ki-chat",
      })
    )
      return;

    return res.status(500).json(
      KIChatResponseSchema.parse({
        suksess: false,
        melding: "Kunne ikke få svar fra KI-assistenten. Prøv igjen senere.",
        response: "",
      }),
    );
  }
});

export default router;