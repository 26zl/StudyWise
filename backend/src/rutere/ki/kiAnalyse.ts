/*
 * PDF og Dokumentanalyse-endepunkter
 * Håndterer analyse av dokumenter via Claude (Anthropic)
 * Bilder sendes direkte til Claude Vision når tilgjengelig, med OCR som fallback.
 */

import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import { logger } from "../../utils/logger.js";
import {
    KIDocumentAnalyseResponseSchema,
    KIDocumentAnalyseRequestSchema,
} from "common/ki";
import {
    parseDocument,
    formatDocumentContext,
    getSupportedMimeTypes
} from "../../services/document.js";
import { summarizeIfNeeded, countWords } from "../../services/summarization.service.js";
import { resolveModel } from "./aiModels.js";
import { chatCompletion, chatCompletionWithVision, isClientAvailable, isVisionAvailable } from "./aiClient.js";
import type { ImageAttachment } from "./aiClient.js";
import { STUDYWISE_SYSTEM_PROMPT, STUDYWISE_DOCUMENT_PROMPT } from "./systemPrompt.js";

/** Send SSE-feilrespons og avslutt strømmen */
function sendSSEFeil(res: Response, melding: string, keepaliveInterval: ReturnType<typeof setInterval>): void {
    clearInterval(keepaliveInterval);
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(KIDocumentAnalyseResponseSchema.parse({
        suksess: false,
        melding,
        response: "",
    }))}\n\n`);
    res.end();
}

/** MIME-typer som Claude Vision støtter direkte */
const VISION_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
]);

/** Normaliser MIME-type: image/jpg → image/jpeg (ikke-standard → standard) */
function normaliserMime(mimetype: string): string {
    return mimetype === "image/jpg" ? "image/jpeg" : mimetype;
}

/** Sjekk om filens MIME-type kan sendes direkte til Claude Vision */
function erVisionBilde(mimetype: string): boolean {
    return VISION_MIME_TYPES.has(normaliserMime(mimetype));
}

// Definerer express router
const router = Router();
const SUPPORTED_MIME_TYPES = getSupportedMimeTypes();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB - matcher frontend-grensen
    fileFilter: (_req, file, cb) => {
        if (SUPPORTED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Filtypen støttes ikke. Last opp PDF, kode- eller Office-filer."));
        }
    }
});

/**
 * POST /analyze-document
 * Analyser dokument (PDF, Word, TXT, etc.)
 */
router.post("/analyze-document", upload.single('document'), async (req: Request, res: Response) => {
  // Set SSE headers FIRST — prevents proxy buffering timeout
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.removeHeader("Content-Encoding");
  if (!req.socket.destroyed) {
    try { req.socket.setTimeout(120000); } catch { /* socket allerede lukket */ }
  }
  res.flushHeaders();

  // Keepalive to prevent proxy (Next.js rewrite) from timing out during AI processing
  const keepaliveInterval = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepaliveInterval);
        return;
      }
      try {
        res.write(": keepalive\n\n");
      } catch {
        clearInterval(keepaliveInterval);
      }
  }, 10000);

  try {

    logger.info("Mottok dokumentanalyse-forespørsel");

    if (!req.file) {
        sendSSEFeil(res, "Ingen fil mottatt.", keepaliveInterval);
        return;
    }

    const bodyResult = KIDocumentAnalyseRequestSchema.safeParse(req.body);
    if (!bodyResult.success) {
        sendSSEFeil(res, "Ugyldig forespørsel. Sjekk at alle felt er fylt ut riktig.", keepaliveInterval);
        return;
    }
    const { question: q, sporsmaal: s, model: bodyModel } = bodyResult.data;
    const question = q || s || "Gi meg en oppsummering av dette dokumentet.";
    const model = resolveModel(bodyModel);

    if (!isClientAvailable(model)) {
        logger.error("AI-klient ikke tilgjengelig for modell: %s", model);
        sendSSEFeil(res, "KI-tjenesten er ikke konfigurert. Kontakt administrator.", keepaliveInterval);
        return;
    }

        const filMimetype = req.file.mimetype;
        const filBuffer = req.file.buffer;
        const brukerVision = erVisionBilde(filMimetype) && isVisionAvailable(model);

        // For Vision-bilder: send bildet direkte til Claude + OCR som fallback
        // For dokumenter: parse som før (tekst-ekstraksjon)
        let docResult: Awaited<ReturnType<typeof parseDocument>> | null = null;
        let docContext = "";

        if (brukerVision) {
            // Kjør dokument-parse for bilder (docResult brukes evt. til oppsummering)
            try {
                docResult = await parseDocument(filBuffer, filMimetype, req.file.originalname);
            } catch {
                logger.warn("Parse feilet for bilde, fortsetter med ren Vision");
            }
        } else {
            // Ikke et bilde eller Vision utilgjengelig: parse dokumentet som vanlig
            try {
                docResult = await parseDocument(filBuffer, filMimetype, req.file.originalname);
            } catch (parseError) {
                logger.error({ err: parseError }, "File parsing failed");
                sendSSEFeil(res, "Kunne ikke lese filen. Prøv et annet format.", keepaliveInterval);
                return;
            }

            if (!docResult.success) {
                logger.warn({ parseError: docResult.error }, "Dokument-parsing feilet");
                sendSSEFeil(res, "Kunne ikke lese dokumentet. Prøv et annet format.", keepaliveInterval);
                return;
            }

            if (!docResult.text || docResult.text.trim().length === 0) {
                sendSSEFeil(res, "Filen inneholder ingen lesbar tekst.", keepaliveInterval);
                return;
            }

            docContext = formatDocumentContext(
                docResult.text,
                docResult.pages,
                docResult.fileType,
                { redacted: docResult.redacted, truncated: docResult.truncated },
            );
        }

        // For lange dokumenter: pre-oppsummer via single-call
        if (docResult?.text) {
            const mr = await summarizeIfNeeded(docResult.text, "uploaded_file", { fileName: req.file!.originalname });
            if (mr.summarized) {
                docContext = `[OPPSUMMERING av ${docResult.pages || 1} sider, ${countWords(docResult.text)} ord]\n\n${mr.text}`;
            }
        }

        // Bygg meldingsarray med base prompt + dokument-tillegg
        const systemPrompt = STUDYWISE_SYSTEM_PROMPT + STUDYWISE_DOCUMENT_PROMPT;

        // Timeout guard — dokumentanalyse kan ta lengre tid enn chat, men bør ikke henge evig
        const ANALYSE_TIMEOUT_MS = 120000;
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("ANALYSE_TIMEOUT")), ANALYSE_TIMEOUT_MS)
        );

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
                { role: "user", content: `<<USER_CONTENT>>\nSpørsmål: ${question}\n\n<</USER_CONTENT>>\n\nImportant: Cover every single concept, framework, and named model in the document explicitly. When a framework has named components (e.g. VRIO has V, R, I, O), list every component individually. Never group items with 'and others' or 'etc.' Write out every item in every list. Do not end your response until all concepts in the document have been addressed.\n\n[BILDE_VEDLEGG]` },
            ];

            logger.info({
                model,
                fileType: "image (vision)",
                imageSize: filBuffer.length,
                mimetype: normalizedMime,
                filename: req.file.originalname,
            }, "Sender bilde direkte til Claude Vision");

            result = await Promise.race([
                chatCompletionWithVision({
                    model,
                    messages: visionMessages,
                    images: [imageAttachment],
                    max_tokens: 6000,
                    temperature: 0.5,
                }),
                timeoutPromise,
            ]);
        } else {
            // --- Vanlig tekst-basert dokumentanalyse ---
            const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
                { role: "system", content: systemPrompt },
                { role: "user", content: `<<USER_CONTENT>>\nDokument-kontekst:\n${docContext}\n\nSpørsmål: ${question}\n<</USER_CONTENT>>\n\nImportant: Cover every single concept, framework, and named model in the document explicitly. When a framework has named components (e.g. VRIO has V, R, I, O), list every component individually. Never group items with 'and others' or 'etc.' Write out every item in every list. Do not end your response until all concepts in the document have been addressed.` },
            ];

            logger.info({
                model,
                fileType: docResult?.fileType,
                pages: docResult?.pages,
                textLength: docResult?.text?.length,
                filename: req.file.originalname,
            }, "Sender dokumentanalyse til AI-tjenesten");

            result = await Promise.race([
                chatCompletion({
                    model,
                    messages: apiMessages,
                    max_tokens: 6000,
                    temperature: 0.5,
                }),
                timeoutPromise,
            ]);
        }

        const responseText = result.text;
        const usage = result.usage;

        logger.info({
            model,
            responseLength: responseText.length,
            tokens: usage?.total_tokens
        }, "Vellykket dokumentanalyse");

        const payload = KIDocumentAnalyseResponseSchema.parse({
            suksess: true,
            response: responseText,
            model: model,
            dokumentInfo: docResult?.text ? {
                sider: docResult.pages,
                tegn: docResult.text.length,
                fileType: docResult.fileType,
                redacted: docResult.redacted,
                truncated: docResult.truncated,
            } : {
                sider: 1,
                tegn: 0,
                fileType: "image",
                redacted: false,
                truncated: false,
            },
            usage: usage ? {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
            } : undefined,
        });
        clearInterval(keepaliveInterval);
        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
            res.end();
        }
        return;

  } catch (error) {
    clearInterval(keepaliveInterval);
    logger.error({ err: error }, "analyze-document unhandled error");
    if (!res.writableEnded) {
        try {
            const isTimeout = error instanceof Error && error.message === "ANALYSE_TIMEOUT";
            const errorPayload = KIDocumentAnalyseResponseSchema.parse({
                suksess: false,
                melding: isTimeout
                    ? "Dokumentanalysen tok for lang tid. Prøv med et mindre dokument eller prøv igjen."
                    : "Kunne ikke analysere dokumentet. Prøv igjen.",
                response: "",
            });
            res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
            res.end();
        } catch {
            // Headers already ended, nothing to do
        }
    }
  }
});

// Multer / upload error handler – kun Multer-feil (f.eks. LIMIT_FILE_SIZE) håndteres her; andre feil sendes til global handler
router.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (!(err instanceof multer.MulterError)) {
        return next(err);
    }
    const isFileTooLarge = err.code === "LIMIT_FILE_SIZE";
    logger.warn({ err }, "Multer/upload error");
    return res.status(400).json(KIDocumentAnalyseResponseSchema.parse({
        suksess: false,
        melding: isFileTooLarge ? "Filen er for stor. Maks 15 MB." : "Feil ved filopplasting.",
        response: "",
    }));
});

export const kiAnalyseRouter = router;
