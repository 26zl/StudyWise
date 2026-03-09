/*
* Rutere for KI-relaterte endepunkter
* Bruker Claude (Anthropic) som AI-leverandør
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
import { kiHistoryRouter } from "./kiHistory.js";
import { kiAnalyseRouter } from "./kiAnalyse.js";
import { SUPPORTED_MODELS, DEFAULT_MODEL, resolveModel } from "./aiModels.js";
import { STUDYWISE_SYSTEM_PROMPT } from "./systemPrompt.js";
import { chatCompletion, isClientAvailable, getMissingClientError } from "./aiClient.js";
import { handleAIError } from "./handleAIError.js";
import { loadCanvasContext, ensureCanvasSync, type IntentType } from "../../services/context-loader.service.js";

/** Nøkkelord som krever full kontekst (moduler, PDFer, sideinnhold) */
const CANVAS_FULL_KEYWORDS = [
  "oppsummer", "forklar", "hva handler", "hva er", "beskriv",
  "gi meg", "lag en", "pdf", "fil", "last ned", "leksjon",
  "modul", "kompendium", "forelesning", "pensum", "kapittel",
  "slide", "dokument", "kunngjøring", "sideinnhold",
];

/** Nøkkelord som kun trenger lett kontekst (emner + frister) */
const CANVAS_LIGHT_KEYWORDS = [
  "emne", "fag", "kurs", "kode", "emnekode",
  "oppgave", "innlevering", "eksamen", "frist", "deadline", "oblig",
  "karakter", "canvas", "undervisning", "studieplan",
  "hva har jeg", "neste frist", "denne uken", "denne uka",
  "hva skjer", "kommende", "kalender", "timeplan", "når",
];

function detectIntent(messages: Array<{ role: string; content: string }>): IntentType {
  // Sjekk de siste bruker-meldingene (maks 3) for nøkkelord
  const recentUserMessages = messages
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => m.content.toLowerCase());

  for (const msg of recentUserMessages) {
    if (CANVAS_FULL_KEYWORDS.some((kw) => msg.includes(kw))) return "canvas_full";
  }
  for (const msg of recentUserMessages) {
    if (CANVAS_LIGHT_KEYWORDS.some((kw) => msg.includes(kw))) return "canvas_light";
  }
  return "general_chat";
}

// ————————————————————————————————————————————————————————
// Målrettet kontekst-ekstraksjon: identifiser hvilke(t) emne/modul brukeren spør om
// ————————————————————————————————————————————————————————
export interface TargetedQuery {
  courseHint: string | null;
  moduleHint: string | null;
  fileHint: string | null;
}

function extractQueryTarget(message: string): TargetedQuery {
  const lower = message.toLowerCase();

  // Ekstraher modul/leksjon-nummer eller -navn
  const moduleMatch = lower.match(
    /(?:modul|leksjon|lesson|module|uke|week)\s*(\d+|[a-zæøå]+)/i,
  );
  const moduleHint = moduleMatch ? moduleMatch[0] : null;

  // Vanlige emnefragmenter som kan dukke opp i Canvas-emnenavn
  const courseKeywords = [
    "algoritmer", "datastrukturer", "database", "strategi", "sikkerhet",
    "python", "objekt", "web", "nettverk", "metode", "mobil", "ki",
    "maskinlæring", "machine learning", "windows", "server",
    "operativsystem", "matematikk", "statistikk", "økonomi", "ledelse",
    "prosjekt", "bacheloroppgave", "kommunikasjon", "innovasjon",
    "ikt", "informasjon", "system", "programmering", "java", "c#",
    "embedded", "elektronikk", "fysikk", "diskret",
  ];

  // Fjern filnavn-mønstre fra søketeksten for å unngå falske positive
  // (f.eks. "BinarySearchTree.java" matcher "java" selv om bruker mener Algoritmer-emnet)
  const cleanedForCourse = lower.replace(/[\w.-]+\.\w{1,5}\b/g, "");
  const courseHint = courseKeywords.find((kw) => cleanedForCourse.includes(kw)) ?? null;

  // Ekstraher filnavn-hints (f.eks. "kapittel3.pdf", "2_Analyse_av_tema.pdf")
  // Filnavn med mellomrom fanges ved å lete etter anførselstegn eller kjente mønstre
  const quotedFileMatch = message.match(/["'«»]([^"'«»]+\.pdf)["'«»]/i);
  let fileHint: string | null = null;
  if (quotedFileMatch) {
    fileHint = quotedFileMatch[1].trim();
  } else {
    // Fang filnavn uten mellomrom (underscore/bindestrek-separert)
    const simpleFileMatch = lower.match(/[\wæøå][\wæøå.-]*\.pdf/i);
    if (simpleFileMatch) {
      fileHint = simpleFileMatch[0].trim();
    }
  }

  return { courseHint, moduleHint, fileHint };
}

/** Definerer express router */
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

  const model = resolveModel(requestedModel);

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

  let keepaliveInterval: ReturnType<typeof setInterval> | undefined;
  let sseStarted = false;

  try {
    // Start med base system prompt
    let enhancedSystemPrompt = STUDYWISE_SYSTEM_PROMPT;

    // ——— Intent-deteksjon: Trenger denne meldingen Canvas-data? ———
    const intent = detectIntent(messages);

    if (intent !== "general_chat" && !req.canvasToken) {
      // Brukeren spør om Canvas men har ikke token
      logger.info({ intent }, "Canvas-spørsmål uten token");
      return res.json(
        KIChatResponseSchema.parse({
          suksess: true,
          response:
            "Jeg har ikke tilgang til Canvas-data akkurat nå. Sjekk at du har:\n\n1. Lagt inn et gyldig Canvas API-token i Innstillinger\n2. Valgt minst ett datasett under «Gi AI tilgang til» i chatten",
          model: model,
        }),
      );
    }

    // ——— Laste Canvas-kontekst via context-loader (Redis → API fallback) ———
    let canvasKontekst = "";
    let hasCanvasData = false;

    if (intent !== "general_chat" && req.canvasToken && req.user?.id) {
      // Sikre at bakgrunns-sync er igangsatt for neste gang
      ensureCanvasSync(req.user.id, req.canvasToken);

      // Ekstraher eventuelle emne/modul-hint fra siste brukermelding
      const lastUserMsg = messages.filter((m: { role: string }) => m.role === "user").at(-1)?.content ?? "";
      const target = extractQueryTarget(lastUserMsg);

      logger.info(
        { intent, target, messagePreview: lastUserMsg.substring(0, 100) },
        "KI chat: intent og target ekstrahert",
      );

      const contextResult = await Promise.race([
        loadCanvasContext(req.user.id, req.canvasToken, intent, target),
        new Promise<{ kontekst: string; hasCanvasData: boolean; source: "none" }>((resolve) =>
          setTimeout(
            () => resolve({ kontekst: "[CANVAS STATUS: Henting tok for lang tid. Prøv igjen.]", hasCanvasData: false, source: "none" }),
            KI_TIMEOUT_MS,
          ),
        ),
      ]);

      canvasKontekst = contextResult.kontekst;
      hasCanvasData = contextResult.hasCanvasData;

      logger.info(
        {
          intent,
          source: contextResult.source,
          contextLength: canvasKontekst.length,
          hasCanvasData,
          harCanvasToken: true,
        },
        "Canvas-kontekst lastet via context-loader",
      );
    } else if (intent === "general_chat") {
      logger.info(
        { intent, harCanvasToken: !!req.canvasToken },
        "Generell chat — hopper over Canvas-kontekst",
      );
    }

    // Legg Canvas-kontekst inn i system-prompten kun hvis tilgjengelig
    if (hasCanvasData) {
      enhancedSystemPrompt += "\n\n" + canvasKontekst;
    }

    // Trim samtalehistorikk til siste 5 meldinger for å holde token-bruken lav
    const MAX_HISTORY_MESSAGES = 5;
    const trimmedMessages = messages.length > MAX_HISTORY_MESSAGES
      ? messages.slice(-MAX_HISTORY_MESSAGES)
      : messages;

    // System-prompt styres kun av backend (KIChatClientMessageSchema tillater ikke "system" fra klient — prompt-injection-sikring).
    const fullMessages = [
      { role: "system" as const, content: enhancedSystemPrompt },
      ...trimmedMessages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    // Dynamisk timeout og max_tokens basert på intent
    const maxTokens = intent === "canvas_full" ? 4096 : 2048;
    const TIMEOUT_MS = intent === "canvas_full" ? 120000 : intent === "canvas_light" ? 60000 : 30000;

    logger.info(
      {
        intent,
        model,
        messageCount: fullMessages.length,
        harCanvasToken: !!req.canvasToken,
        systemPromptLength: enhancedSystemPrompt.length,
        maxTokens,
        timeoutMs: TIMEOUT_MS,
      },
      "Sender til AI-tjenesten",
    );

    // --- SSE streaming setup (prevents Brotli/proxy buffering timeout) ---
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.removeHeader("Content-Encoding");
    req.socket.setTimeout(TIMEOUT_MS + 10000);
    res.flushHeaders();

    sseStarted = true;

    keepaliveInterval = setInterval(() => {
      try {
        if (!res.writableEnded) res.write(": keepalive\n\n");
      } catch {
        clearInterval(keepaliveInterval);
        keepaliveInterval = undefined;
      }
    }, 10000);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("CHAT_TIMEOUT")), TIMEOUT_MS),
    );

    const result = await Promise.race([
      chatCompletion({
        model,
        messages: fullMessages,
        max_tokens: maxTokens,
        temperature: Math.min(Math.max(temperature, 0), 2),
      }),
      timeoutPromise,
    ]);

    clearInterval(keepaliveInterval);
    keepaliveInterval = undefined;

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

    const payload = KIChatResponseSchema.parse({
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
    });
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.end();
    return;
  } catch (error) {
    if (keepaliveInterval) clearInterval(keepaliveInterval);

    // If SSE headers were already sent, send error via SSE
    if (sseStarted && !res.writableEnded) {
      const errorMessage = error instanceof Error && error.message === "CHAT_TIMEOUT"
        ? "Chat-forespørselen tok for lang tid. Prøv igjen eller forenkle spørsmålet."
        : "Kunne ikke få svar fra KI-assistenten. Prøv igjen senere.";

      logger.error({ err: error }, "ki-chat feil (SSE)");
      const errorPayload = KIChatResponseSchema.parse({
        suksess: false,
        melding: errorMessage,
        response: "",
      });
      res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
      res.end();
      return;
    }

    // Headers not sent yet — use normal JSON error response
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
