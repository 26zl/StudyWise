/*
 * PDF og Dokumentanalyse-endepunkter
 * Håndterer analyse av dokumenter via Claude (Anthropic)
 * Bilder sendes direkte til Claude Vision når tilgjengelig, med OCR som fallback.
 */

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { logger } from "../../utils/logger.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { KIDocumentAnalyseResponseSchema, KIDocumentAnalyseRequestSchema } from "common/ki";
import {
  formatDocumentContext,
  getSupportedMimeTypes,
  validateFileMagicBytes,
  EXTENSION_TO_MIME,
} from "../../services/document.js";
import {
  PARSE_TIMEOUT_ERROR,
  PARSE_WORKER_CRASHED_ERROR,
  getParseWorkerRuntimeError,
  getParseWorkerUserMessage,
  parseDocumentInWorker,
} from "../../services/documentParserWorker.js";
import { summarizeIfNeeded, countWords } from "../../services/summarization.service.js";
import { resolveModel } from "./aiModels.js";
import {
  chatCompletion,
  chatCompletionWithVision,
  isVisionAvailable,
  isClientAvailable,
  getMissingClientError,
} from "./aiClient.js";
import type { ImageAttachment } from "./aiClient.js";
import { STUDYWISE_SYSTEM_PROMPT, STUDYWISE_DOCUMENT_PROMPT } from "./systemPrompt.js";
import { setupSSE, writeSSE } from "../../utils/sseUtils.js";
import { classifyAIError } from "./handleAIError.js";
import { createLinkedAbortController } from "../../utils/abort.js";

/** Send SSE-feilrespons og avslutt strømmen */
function sendSSEFeil(res: Response, melding: string, cleanup: () => void): void {
  cleanup();
  const payload = KIDocumentAnalyseResponseSchema.parse({
    suksess: false,
    melding,
    response: "",
  });
  if (writeSSE(res, payload)) {
    res.end();
  }
}

/** MIME-typer som Claude Vision støtter direkte */
const VISION_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Normaliser MIME-type: image/jpg → image/jpeg (ikke-standard → standard) */
function normaliserMime(mimetype: string): string {
  if (mimetype === "image/jpg") return "image/jpeg";
  if (mimetype === "application/x-pdf") return "application/pdf";
  return mimetype;
}

function inferMimeFromFilename(filename?: string): string | null {
  if (!filename) return null;
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (!ext) return null;
  return EXTENSION_TO_MIME[ext] ?? null;
}

function resolveUploadMime(mimetype: string, originalname?: string): string {
  const normalized = normaliserMime(mimetype?.trim().toLowerCase());
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }
  const inferred = inferMimeFromFilename(originalname);
  return inferred ?? normalized;
}

/** Sjekk om filens MIME-type kan sendes direkte til Claude Vision */
function erVisionBilde(mimetype: string): boolean {
  return VISION_MIME_TYPES.has(normaliserMime(mimetype));
}

function erStorDokument(pages: number | undefined, text: string | undefined): boolean {
  const pageCount = pages ?? 1;
  const words = text ? countWords(text) : 0;
  return pageCount >= LARGE_DOC_PAGE_THRESHOLD || words >= LARGE_DOC_WORD_THRESHOLD;
}

// Definerer express router
const router = Router();
const SUPPORTED_MIME_TYPES = getSupportedMimeTypes();
const INVALID_DOCUMENT_TYPE_ERROR = "INVALID_DOCUMENT_TYPE";
const ANALYSE_SSE_TIMEOUT_MS = 240_000;
const ANALYSE_TIMEOUT_MS = 220_000;
const ANALYSE_MAX_TOKENS_DEFAULT = 3200;
const ANALYSE_MAX_TOKENS_LARGE_DOC = 2200;
const ENABLE_ANALYSE_PRE_SUMMARY = process.env.KI_ANALYSE_PRE_SUMMARY === "true";
const LARGE_DOC_PAGE_THRESHOLD = 20;
const LARGE_DOC_WORD_THRESHOLD = 6000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB - matcher frontend-grensen
  fileFilter: (_req, file, cb) => {
    const resolvedMime = resolveUploadMime(file.mimetype, file.originalname);
    if (SUPPORTED_MIME_TYPES.includes(resolvedMime)) {
      cb(null, true);
    } else {
      cb(new Error(INVALID_DOCUMENT_TYPE_ERROR));
    }
  },
});

/**
 * POST /analyze-document
 * Analyser dokument (PDF, Word, TXT, etc.)
 */
// rateLimitKi anvendes globalt på `/api/ki/*` via kiRuter; route-level her ville
// dobbelttalt og kuttet brukerens reelle KI-grense i halv.
router.post("/analyze-document", upload.single("document"), async (req: Request, res: Response) => {
  // Sett SSE-headere FØRST — forhindrer proxy buffering-timeout
  const { clearKeepalive, deadlineSignal } = setupSSE(req, res, ANALYSE_SSE_TIMEOUT_MS);
  const abortController = createLinkedAbortController(req.timeoutSignal, deadlineSignal);
  let analyseTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const analyseStartedAt = Date.now();
  const abortOnResponseEnd = () => abortController.abort();
  res.once("finish", abortOnResponseEnd);
  res.once("close", abortOnResponseEnd);

  try {
    logger.info("Mottok dokumentanalyse-forespørsel");

    if (!req.file) {
      sendSSEFeil(res, "Ingen fil mottatt.", clearKeepalive);
      return;
    }

    const bodyResult = KIDocumentAnalyseRequestSchema.safeParse(req.body);
    if (!bodyResult.success) {
      sendSSEFeil(
        res,
        "Ugyldig forespørsel. Sjekk at alle felt er fylt ut riktig.",
        clearKeepalive,
      );
      return;
    }
    const { question: q, sporsmaal: s, model: bodyModel } = bodyResult.data;
    const question = q || s || "Gi meg en oppsummering av dette dokumentet.";
    const model = resolveModel(bodyModel);

    if (!isClientAvailable(model)) {
      logger.error(getMissingClientError(model));
      sendSSEFeil(res, "KI-tjenesten er ikke konfigurert. Kontakt administrator.", clearKeepalive);
      return;
    }

    const filMimetype = resolveUploadMime(req.file.mimetype, req.file.originalname);
    const filBuffer = req.file.buffer;
    const magicError = validateFileMagicBytes(filBuffer, filMimetype);
    if (magicError) {
      sendSSEFeil(res, magicError, clearKeepalive);
      return;
    }
    const brukerVision = erVisionBilde(filMimetype) && isVisionAvailable(model);

    // For Vision-bilder: send bildet direkte til Claude + OCR som fallback
    // For dokumenter: parse som før (tekst-ekstraksjon)
    let docResult: Awaited<ReturnType<typeof parseDocumentInWorker>> | null = null;
    let docContext = "";

    if (brukerVision) {
      // Kjør dokument-parse for bilder (docResult brukes evt. til oppsummering)
      try {
        // Vision-flyten bruker filBuffer senere, så vi sender en kopi til worker.
        docResult = await parseDocumentInWorker(
          Buffer.from(filBuffer),
          filMimetype,
          req.file.originalname,
        );
      } catch (parseError) {
        const parseWorkerError = getParseWorkerRuntimeError(parseError);
        if (parseWorkerError) {
          logger.warn(
            { err: parseError, parseWorkerError },
            "Dokumentparser i worker feilet for vision-opplasting, fortsetter med ren Vision",
          );
        } else {
          logger.warn({ err: parseError }, "Parse feilet for bilde, fortsetter med ren Vision");
        }
      }
    } else {
      // Ikke et bilde eller Vision utilgjengelig: parse dokumentet som vanlig
      try {
        docResult = await parseDocumentInWorker(filBuffer, filMimetype, req.file.originalname);
      } catch (parseError) {
        const parseWorkerError = getParseWorkerRuntimeError(parseError);
        if (parseWorkerError === PARSE_TIMEOUT_ERROR) {
          const parseWorkerFeil =
            getParseWorkerUserMessage(parseError, "document-analyse") ??
            "Dokumentet tok for lang tid å lese. Prøv en mindre fil eller et annet format.";
          logger.warn({ err: parseError, parseWorkerError }, "Dokumentparser i worker time-out");
          sendSSEFeil(res, parseWorkerFeil, clearKeepalive);
          return;
        }
        if (parseWorkerError === PARSE_WORKER_CRASHED_ERROR) {
          const parseWorkerFeil =
            getParseWorkerUserMessage(parseError, "document-analyse") ??
            "Dokumentparseren stoppet uventet. Prøv igjen om litt.";
          logger.warn({ err: parseError, parseWorkerError }, "Dokumentparser i worker krasjet");
          sendSSEFeil(res, parseWorkerFeil, clearKeepalive);
          return;
        }

        const parseWorkerFeil = getParseWorkerUserMessage(parseError, "document-analyse");
        if (parseWorkerFeil != null) {
          logger.warn({ err: parseError }, "Dokumentparser i worker feilet");
          sendSSEFeil(res, parseWorkerFeil, clearKeepalive);
          return;
        }
        logger.error({ err: parseError }, "File parsing failed");
        sendSSEFeil(res, "Kunne ikke lese filen. Prøv et annet format.", clearKeepalive);
        return;
      }

      if (!docResult.success) {
        logger.warn({ parseError: docResult.error }, "Dokument-parsing feilet");
        sendSSEFeil(res, "Kunne ikke lese dokumentet. Prøv et annet format.", clearKeepalive);
        return;
      }

      if (!docResult.text || docResult.text.trim().length === 0) {
        sendSSEFeil(res, "Filen inneholder ingen lesbar tekst.", clearKeepalive);
        return;
      }

      docContext = formatDocumentContext(docResult.text, docResult.pages, docResult.fileType, {
        redacted: docResult.redacted,
        truncated: docResult.truncated,
      });
    }

    // Fast path: pre-oppsummering er nå opt-in via env for å redusere total latens.
    if (docResult?.text && ENABLE_ANALYSE_PRE_SUMMARY) {
      const preSummaryStartedAt = Date.now();
      const mr = await summarizeIfNeeded(docResult.text, "uploaded_file", {
        fileName: req.file!.originalname,
      });
      if (mr.summarized) {
        docContext = `[OPPSUMMERING av ${docResult.pages || 1} sider, ${countWords(docResult.text)} ord]\n\n${mr.text}`;
      }
      logger.info(
        { durationMs: Date.now() - preSummaryStartedAt, summarized: mr.summarized },
        "Pre-oppsummering fullført",
      );
    }

    // Bygg meldingsarray med base prompt + dokument-tillegg
    const systemPrompt = STUDYWISE_SYSTEM_PROMPT + STUDYWISE_DOCUMENT_PROMPT;
    const stortDokument = erStorDokument(docResult?.pages, docResult?.text);
    const maxTokens = stortDokument ? ANALYSE_MAX_TOKENS_LARGE_DOC : ANALYSE_MAX_TOKENS_DEFAULT;
    const responsInstruksjon = stortDokument
      ? "Svar kort og presist med maks 700 ord. Prioriter de viktigste konseptene og det som er mest eksamensrelevant."
      : "Important: Cover every single concept, framework, and named model in the document explicitly. When a framework has named components (e.g. VRIO has V, R, I, O), list every component individually. Never group items with 'and others' or 'etc.' Write out every item in every list. Do not end your response until all concepts in the document have been addressed.";

    // Timeout guard — dokumentanalyse kan ta betydelig lengre tid (parse + pre-oppsummering + AI-kall)
    const timeoutPromise = new Promise<never>((_, reject) => {
      analyseTimeoutHandle = setTimeout(
        () => reject(new Error("ANALYSE_TIMEOUT")),
        ANALYSE_TIMEOUT_MS,
      );
    });

    let result;

    if (brukerVision) {
      // --- Claude Vision: send bildet direkte ---
      const normalizedMime = normaliserMime(filMimetype);
      const imageAttachment: ImageAttachment = {
        data: filBuffer.toString("base64"),
        mediaType: normalizedMime as ImageAttachment["mediaType"],
      };

      const visionMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `<<USER_CONTENT>>\nSpørsmål: ${question}\n\n<</USER_CONTENT>>\n\n${responsInstruksjon}\n\n[BILDE_VEDLEGG]`,
        },
      ];

      logger.info(
        {
          model,
          fileType: "image (vision)",
          imageSize: filBuffer.length,
          mimetype: normalizedMime,
          filename: req.file.originalname,
        },
        "Sender bilde direkte til Claude Vision",
      );

      result = await Promise.race([
        chatCompletionWithVision({
          model,
          messages: visionMessages,
          images: [imageAttachment],
          max_tokens: maxTokens,
          temperature: 0.5,
          signal: abortController.signal,
          traceName: "document-analyse-vision",
          traceMeta: {
            userId: req.user?.id,
            intent: "general_chat",
            mode: "document_vision",
          },
        }),
        timeoutPromise,
      ]);
      if (analyseTimeoutHandle) {
        clearTimeout(analyseTimeoutHandle);
        analyseTimeoutHandle = undefined;
      }
    } else {
      // --- Vanlig tekst-basert dokumentanalyse ---
      const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `<<USER_CONTENT>>\nDokument-kontekst:\n${docContext}\n\nSpørsmål: ${question}\n<</USER_CONTENT>>\n\n${responsInstruksjon}`,
        },
      ];

      logger.info(
        {
          model,
          fileType: docResult?.fileType,
          pages: docResult?.pages,
          textLength: docResult?.text?.length,
          filename: req.file.originalname,
        },
        "Sender dokumentanalyse til AI-tjenesten",
      );

      result = await Promise.race([
        chatCompletion({
          model,
          messages: apiMessages,
          max_tokens: maxTokens,
          temperature: 0.5,
          signal: abortController.signal,
          traceName: "document-analyse",
          traceMeta: {
            userId: req.user?.id,
            intent: "general_chat",
            mode: "document_text",
          },
        }),
        timeoutPromise,
      ]);
      if (analyseTimeoutHandle) {
        clearTimeout(analyseTimeoutHandle);
        analyseTimeoutHandle = undefined;
      }
    }

    const responseText = result.text;
    const usage = result.usage;

    logger.info(
      {
        model,
        responseLength: responseText.length,
        tokens: usage?.total_tokens,
        durationMs: Date.now() - analyseStartedAt,
        maxTokens,
        largeDocumentMode: stortDokument,
        preSummaryEnabled: ENABLE_ANALYSE_PRE_SUMMARY,
      },
      "Vellykket dokumentanalyse",
    );

    const payload = KIDocumentAnalyseResponseSchema.parse({
      suksess: true,
      response: responseText,
      model: model,
      dokumentInfo: docResult?.text
        ? {
            sider: docResult.pages,
            tegn: docResult.text.length,
            fileType: docResult.fileType,
            redacted: docResult.redacted,
            truncated: docResult.truncated,
          }
        : {
            sider: 1,
            tegn: filBuffer.length,
            fileType: brukerVision ? "image" : "unknown",
            redacted: false,
            truncated: false,
          },
      usage: usage
        ? {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
          }
        : undefined,
    });
    clearKeepalive();
    // writeSSE base64-koder JSON-payloaden før den skrives til event-streamen.
    if (writeSSE(res, payload)) {
      res.end();
    }

    if (req.user?.id) {
      void audit({
        actorUserId: req.user.id,
        action: AUDIT_ACTIONS.KI_DOCUMENT_ANALYZED,
        category: "ki",
        outcome: "success",
        metadata: { model, fileType: req.file?.mimetype, tokens: usage?.total_tokens },
        req,
      }).catch((err) => {
        logger.warn({ err, userId: req.user!.id }, "Audit-feil for dokumentanalyse");
      });
    }

    return;
  } catch (error) {
    clearKeepalive();
    const isAbortError =
      error instanceof DOMException
        ? error.name === "AbortError"
        : error instanceof Error && error.name === "AbortError";
    if (isAbortError && (res.writableEnded || res.destroyed)) {
      logger.info("analyze-document avbrutt etter at response allerede var lukket");
      return;
    }
    try {
      // Bruk samme klassifiserer som chat-SSE-flyten slik at credit_exhausted /
      // rate_limit / auth_error får riktig bruker-melding også her.
      const classified = classifyAIError(error, {
        timeoutLabel: "ANALYSE_TIMEOUT",
        timeoutMessage:
          "Dokumentanalysen tok for lang tid. Prøv med et mindre dokument eller prøv igjen.",
      });
      logger.error(
        { err: error, category: classified.category },
        "analyze-document unhandled error",
      );
      const errorPayload = KIDocumentAnalyseResponseSchema.parse({
        suksess: false,
        melding: classified.userMessage,
        response: "",
      });
      if (writeSSE(res, errorPayload)) {
        res.end();
      }
    } catch {
      // Stream allerede avsluttet
    }
  } finally {
    if (analyseTimeoutHandle) {
      clearTimeout(analyseTimeoutHandle);
    }
    abortController.cleanup();
    res.off("finish", abortOnResponseEnd);
    res.off("close", abortOnResponseEnd);
  }
});

// Multer / upload error handler – kun Multer-feil (f.eks. LIMIT_FILE_SIZE) håndteres her; andre feil sendes til global handler
router.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error && err.message === INVALID_DOCUMENT_TYPE_ERROR) {
    logger.warn({ err }, "Ugyldig dokumenttype avvist");
    return res.status(400).json(
      KIDocumentAnalyseResponseSchema.parse({
        suksess: false,
        melding: "Filtypen støttes ikke. Last opp PDF, kode- eller Office-filer.",
        response: "",
      }),
    );
  }
  if (!(err instanceof multer.MulterError)) {
    return next(err);
  }
  const isFileTooLarge = err.code === "LIMIT_FILE_SIZE";
  logger.warn({ err }, "Multer/upload error");
  return res.status(400).json(
    KIDocumentAnalyseResponseSchema.parse({
      suksess: false,
      melding: isFileTooLarge ? "Filen er for stor. Maks 15 MB." : "Feil ved filopplasting.",
      response: "",
    }),
  );
});

export const kiAnalyseRouter = router;
