/*
 * AI Client Factory
 * Alle KI-ruter bruker denne modulen for å sende forespørsler til Claude.
 *
 * Tekst-komplettering: Vercel AI SDK (streamText fra "ai" + @ai-sdk/anthropic)
 * Vision:              Raw Anthropic SDK (chatCompletionWithVision — "that part only")
 */

import Anthropic from "@anthropic-ai/sdk";
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { logger } from "../../utils/logger.js";
import { anthropicCircuit } from "../../utils/circuitBreaker.js";
import { DEFAULT_MODEL } from "./aiModels.js";
import { SVAR_KILDER, type SvarKilde } from "common/ki";
import {
    finishLangsmithRun,
    startLangsmithRun,
    type LangsmithTraceMeta,
} from "../../lib/langsmith.js";

// --- Klient-initialisering (én gang ved oppstart) ---

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Vercel AI SDK-provider for Anthropic — brukes til tekst-komplettering via streamText().
 */
export const anthropicSdkProvider = ANTHROPIC_API_KEY
    ? createAnthropic({ apiKey: ANTHROPIC_API_KEY })
    : null;

/**
 * Raw Anthropic SDK-klient — brukes KUN til vision (chatCompletionWithVision).
 * Prompt caching for tekst-kall håndteres av AI SDK via system-melding med providerOptions.
 */
export const anthropicClient = ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
    : null;

// --- Meldingstyper ---

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    /**
     * Anthropic prompt-cache kontroll. Default (uten ttl) er 5-minutt-cache.
     * ttl: "1h" forlenger til 1 time — nyttig for lange samtaler der
     * systemprompt + Canvas-kontekst gjenbrukes i oppfølgingsspørsmål.
     */
    cache_control?: { type: "ephemeral"; ttl?: "5m" | "1h" };
}

/** Bildevedlegg for Claude Vision */
export interface ImageAttachment {
    /** Base64-kodet bildedata (uten data:...-prefiks) */
    data: string;
    /** MIME-type, f.eks. "image/png" */
    mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export interface ChatCompletionResult {
    text: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    /**
     * Hvorfor modellen sluttet å generere. "length" betyr at max_tokens-cap
     * kuttet svaret — telemetri brukes til å avgjøre om cap for en intent-
     * klasse er for stram i praksis. Andre verdier (stop, tool-calls, etc.)
     * betyr naturlig slutt og er ikke-problematiske.
     */
    finishReason?: string;
    /**
     * Modellens egen klassifisering av hvor svaret kommer fra (parsed fra
     * `<svarkilde>`-tag). Brukes til å vise UI-badge — særlig viktig for
     * "generell" så brukeren ikke forveksler et fritt KI-svar med pensum.
     */
    svarKilde?: SvarKilde;
}

// --- Felles chat completion-funksjon ---

const SVAR_KILDE_SET = new Set<string>(SVAR_KILDER);

/**
 * Stripper <analyse>-tagger fra AI-respons og parser ut <svarkilde>-tag.
 *
 * System prompten ber modellen skrive <analyse>...</analyse><svar>...</svar>
 * og avslutte med en <svarkilde>kursmateriale|canvas|kunnskapsbase|generell|blandet</svarkilde>-tag.
 * Brukeren skal kun se innholdet i <svar>; svarKilde returneres som strukturert
 * felt slik at frontend kan rendere et tydelig kilde-badge.
 */
export function extractAnswerAndSource(raw: string): {
    text: string;
    svarKilde?: SvarKilde;
} {
    let svarKilde: SvarKilde | undefined;

    // Ekstraher <svarkilde>-tag uavhengig av posisjon (den ligger oftest sist).
    const svarKildeMatch = raw.match(/<svarkilde>\s*([a-zæøå]+)\s*<\/svarkilde>/i);
    if (svarKildeMatch) {
        const kandidat = svarKildeMatch[1].toLowerCase();
        if (SVAR_KILDE_SET.has(kandidat)) {
            svarKilde = kandidat as SvarKilde;
        }
    }

    // Fjern <svarkilde>-tag (med eventuelle ugyldige verdier) fra hele teksten
    // før vi henter ut svar-innholdet, slik at den aldri vises for brukeren.
    const utenSvarKilde = raw.replace(/<svarkilde>[\s\S]*?<\/svarkilde>/gi, "").trim();

    const svarMatch = utenSvarKilde.match(/<svar>([\s\S]*?)<\/svar>/);
    if (svarMatch) {
        return { text: svarMatch[1].trim(), svarKilde };
    }
    // Hvis modellen ikke brukte <svar>-tagger, fjern <analyse>-blokken alene
    const stripped = utenSvarKilde.replace(/<analyse>[\s\S]*?<\/analyse>/g, "").trim();
    return { text: stripped || utenSvarKilde || raw, svarKilde };
}

/**
 * Server-side enforcement av <svarkilde>-tagen mot faktisk injisert kontekst.
 *
 * Modellen kan stokastisk lures via prompt-injection til å sette feil verdi i
 * <svarkilde>-tagen (se F-34c i pentestrapport). Backend vet selv hvilken
 * kontekst som ble injisert i system-prompten, og kan derfor degradere
 * modellens emitterte verdi til riktig nivå når den ikke matcher virkeligheten.
 *
 * Eksempel: modell hevder "kursmateriale" men ingen PDF-innhold ble injisert →
 * vi degraderer til "kunnskapsbase"/"canvas"/"generell" basert på hva som
 * faktisk var tilgjengelig.
 */
export function enforceSvarKilde(
    modelEmittedKilde: SvarKilde | undefined,
    ctx: {
        /** PDF/fil-innhold fra Canvas (faktisk tekst, ikke kun metadata). */
        harKursmateriale: boolean;
        /** Innhold fra brukerens kunnskapsbase (KB-fil eller -lenke). */
        harKunnskapsbase: boolean;
        /** Canvas-metadata uten PDF-innhold (moduler, oppgaver, frister, etc.). */
        harCanvasMetadata: boolean;
        /** Live URL-scraping (KB-lenke fetched runtime). */
        harLiveUrl: boolean;
    },
): SvarKilde | undefined {
    // Ingen kontekst ble injisert i det hele tatt — modellen kan ikke ha "kilde".
    const harNoenKontekst =
        ctx.harKursmateriale || ctx.harKunnskapsbase || ctx.harCanvasMetadata || ctx.harLiveUrl;
    if (!harNoenKontekst) {
        return "generell";
    }

    // Hvis modellen ikke emitterte tag, la frontend bestemme standard.
    if (!modelEmittedKilde) return undefined;

    // "kursmateriale" krever faktisk PDF-innhold injisert; ellers degrader.
    if (modelEmittedKilde === "kursmateriale" && !ctx.harKursmateriale) {
        if (ctx.harKunnskapsbase || ctx.harLiveUrl) return "kunnskapsbase";
        if (ctx.harCanvasMetadata) return "canvas";
        return "generell";
    }

    // "kunnskapsbase" krever KB-innhold; ellers degrader.
    if (modelEmittedKilde === "kunnskapsbase" && !ctx.harKunnskapsbase && !ctx.harLiveUrl) {
        if (ctx.harKursmateriale) return "kursmateriale";
        if (ctx.harCanvasMetadata) return "canvas";
        return "generell";
    }

    // "canvas" krever Canvas-kontekst; ellers degrader.
    if (
        modelEmittedKilde === "canvas" &&
        !ctx.harCanvasMetadata &&
        !ctx.harKursmateriale
    ) {
        if (ctx.harKunnskapsbase || ctx.harLiveUrl) return "kunnskapsbase";
        return "generell";
    }

    // "blandet" krever ≥ 2 distinkte kildetyper; ellers degrader til mest spesifikk.
    if (modelEmittedKilde === "blandet") {
        const sources = [
            ctx.harKursmateriale,
            ctx.harKunnskapsbase || ctx.harLiveUrl,
            ctx.harCanvasMetadata,
        ].filter(Boolean).length;
        if (sources < 2) {
            if (ctx.harKursmateriale) return "kursmateriale";
            if (ctx.harKunnskapsbase || ctx.harLiveUrl) return "kunnskapsbase";
            if (ctx.harCanvasMetadata) return "canvas";
            return "generell";
        }
    }

    return modelEmittedKilde;
}

/**
 * Sender chat completion til Claude.
 * Stripper automatisk <analyse>-tagger fra responsen.
 */
export async function chatCompletion(options: {
    model: string;
    messages: ChatMessage[];
    max_tokens: number;
    temperature: number;
    signal?: AbortSignal;
    traceName?: string;
    traceMeta?: LangsmithTraceMeta;
}): Promise<ChatCompletionResult> {
    const { model, messages, max_tokens, temperature, signal, traceName, traceMeta } = options;
    const shouldFallbackToDefaultModel = (error: unknown): boolean => {
        const maybeError = error as {
            status?: number;
            statusCode?: number;
            responseBody?: string;
            message?: string;
            cause?: { status?: number; statusCode?: number; responseBody?: string; message?: string };
        } | undefined;

        const primaryStatus = maybeError?.status ?? maybeError?.statusCode;
        const causeStatus = maybeError?.cause?.status ?? maybeError?.cause?.statusCode;
        const responseBody = typeof maybeError?.responseBody === "string" ? maybeError.responseBody : "";
        const causeResponseBody = typeof maybeError?.cause?.responseBody === "string" ? maybeError.cause.responseBody : "";
        const message = typeof maybeError?.message === "string" ? maybeError.message : "";
        const causeMessage = typeof maybeError?.cause?.message === "string" ? maybeError.cause.message : "";

        const hasNotFoundSignal =
            responseBody.includes("not_found_error")
            || causeResponseBody.includes("not_found_error")
            || message.includes("not_found_error")
            || causeMessage.includes("not_found_error")
            || message.includes("No output generated")
            || causeMessage.includes("No output generated");

        return (primaryStatus === 404 || causeStatus === 404 || hasNotFoundSignal) && model !== DEFAULT_MODEL;
    };
    const runId = await startLangsmithRun({
        name: traceName ?? "chat",
        model,
        messages,
        systemPrompt: messages.find((message) => message.role === "system")?.content,
        meta: traceMeta,
    });

    try {
        const result = await anthropicCircuit.execute(() =>
            callAnthropic({ model, messages, max_tokens, temperature, signal }),
        );

        // Strip <analyse>/<svar>-tagger og parse <svarkilde>-tag for kilde-merking
        const extracted = extractAnswerAndSource(result.text);
        result.text = extracted.text;
        if (extracted.svarKilde) {
            result.svarKilde = extracted.svarKilde;
        }

        await finishLangsmithRun({
            runId,
            response: result.text,
            usage: result.usage,
        });

        return result;
    } catch (error) {
        if (shouldFallbackToDefaultModel(error)) {
            logger.warn(
                { requestedModel: model, fallbackModel: DEFAULT_MODEL, err: error },
                "chatCompletion: modell feilet — prøver default-modell",
            );
            try {
                const fallbackResult = await anthropicCircuit.execute(() =>
                    callAnthropic({
                        model: DEFAULT_MODEL,
                        messages,
                        max_tokens,
                        temperature,
                        signal,
                    }),
                );
                {
                    const extracted = extractAnswerAndSource(fallbackResult.text);
                    fallbackResult.text = extracted.text;
                    if (extracted.svarKilde) {
                        fallbackResult.svarKilde = extracted.svarKilde;
                    }
                }
                await finishLangsmithRun({
                    runId,
                    response: fallbackResult.text,
                    usage: fallbackResult.usage,
                });
                return fallbackResult;
            } catch (fallbackError) {
                await finishLangsmithRun({ runId, error: fallbackError });
                throw fallbackError;
            }
        }
        await finishLangsmithRun({ runId, error });
        throw error;
    }
}

/**
 * Sjekker om AI-klienten er tilgjengelig.
 */
export function isClientAvailable(_model: string): boolean {
    return anthropicSdkProvider !== null;
}

/**
 * Vindu i ms der en registrert kreditt-feil holder Anthropic-helsen som "down".
 * `/v1/models` bruker ikke kreditt, så metadata-sjekken svarer 200 OK selv når
 * kontoen er tom. Ved å huske siste credit-failure kan vi rapportere korrekt
 * status uten å brenne kreditt på en ekte chat-ping. Selvhelbredes ved å
 * utløpe — hvis kreditt fylles på, kommer helsestatus tilbake automatisk
 * når vinduet går ut og neste echte KI-kall lykkes.
 */
const CREDIT_FAILURE_STICKY_WINDOW_MS = 15 * 60 * 1000; // 15 min

let lastAnthropicCreditFailureAtMs: number | null = null;

/**
 * Kalles fra feilhåndtering (classifyAIError → credit_exhausted) for å markere
 * at vi akkurat har sett en konto-tom-feil fra Anthropic. Brukes av helsesjekken
 * til å rapportere "down" selv om metadata-endepunktet fortsatt svarer 200.
 */
export function recordAnthropicCreditFailure(): void {
    lastAnthropicCreditFailureAtMs = Date.now();
    logger.warn(
        "Anthropic credit-failure registrert — helsesjekk rapporterer down i 15 min",
    );
}

/**
 * Brukes av helsesjekken (og ev. UI) for å sjekke om vi nylig har observert
 * en credit-exhausted-feil. Returnerer true hvis vinduet ennå ikke er utløpt.
 */
export function hasRecentAnthropicCreditFailure(): boolean {
    if (lastAnthropicCreditFailureAtMs === null) return false;
    const elapsed = Date.now() - lastAnthropicCreditFailureAtMs;
    if (elapsed > CREDIT_FAILURE_STICKY_WINDOW_MS) {
        // Vinduet er utløpt — nullstill så neste vellykkede ping kan gjenopprette "up"
        lastAnthropicCreditFailureAtMs = null;
        return false;
    }
    return true;
}

/**
 * Pinger Anthropic /v1/models for å verifisere at API-et svarer.
 * Brukes av /status og /health/dependencies for å rapportere faktisk provider-helse.
 * Returnerer false hvis nøkkel mangler, nettverket svikter, API-et svarer
 * med 5xx / autentiseringsfeil, ELLER vi nylig har observert en credit-exhausted-
 * feil (`/v1/models` bruker ikke kreditt og kan derfor ikke oppdage tom konto).
 */
export async function isAnthropicHealthy(): Promise<boolean> {
    if (!ANTHROPIC_API_KEY) return false;
    if (hasRecentAnthropicCreditFailure()) return false;
    try {
        const response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
            method: "GET",
            headers: {
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            signal: AbortSignal.timeout(5_000),
        });
        return response.ok;
    } catch (error) {
        logger.debug({ err: error }, "Anthropic helsesjekk feilet");
        return false;
    }
}

/**
 * Returnerer en beskrivende feilmelding hvis klienten mangler.
 */
export function getMissingClientError(_model: string): string {
    return "Mangler ANTHROPIC_API_KEY — ingen AI-leverandør tilgjengelig";
}

/**
 * Sjekker om vi kan sende bilder direkte til modellen (Claude Vision).
 */
export function isVisionAvailable(_model: string): boolean {
    return anthropicClient !== null;
}

// --- Vision-støtte (Claude Vision API) ---

/**
 * Sender chat completion med bildevedlegg til Claude Vision.
 * Bygger multimodal content-blokker (image + text) for user-meldinger.
 */
export async function chatCompletionWithVision(options: {
    model: string;
    messages: ChatMessage[];
    images: ImageAttachment[];
    max_tokens: number;
    temperature: number;
    signal?: AbortSignal;
    traceName?: string;
    traceMeta?: LangsmithTraceMeta;
}): Promise<ChatCompletionResult> {
    const { model, messages, images, max_tokens, temperature, signal, traceName, traceMeta } = options;

    if (!anthropicClient) {
        throw new Error("Vision er ikke tilgjengelig. Kall kun chatCompletionWithVision når isVisionAvailable(model) er sann.");
    }

    const runId = await startLangsmithRun({
        name: traceName ?? "document-analyse",
        model,
        messages,
        systemPrompt: messages.find((message) => message.role === "system")?.content,
        meta: traceMeta,
    });

    try {
        let result = await anthropicCircuit.execute(() => callAnthropicWithVision({
            model,
            messages,
            images,
            max_tokens,
            temperature,
            signal,
        }));
        {
            const extracted = extractAnswerAndSource(result.text);
            result.text = extracted.text;
            if (extracted.svarKilde) {
                result.svarKilde = extracted.svarKilde;
            }
        }

        await finishLangsmithRun({
            runId,
            response: result.text,
            usage: result.usage,
        });
        return result;
    } catch (error) {
        await finishLangsmithRun({ runId, error });
        throw error;
    }
}

// --- Private hjelpefunksjoner ---

/**
 * Tekst-komplettering via Vercel AI SDK (streamText).
 *
 * Prompt caching:
 *   System-meldingen sendes som role:"system" i messages-arrayet med
 *   providerOptions.anthropic.cacheControl.type="ephemeral". @ai-sdk/anthropic
 *   konverterer dette til cache_control-blokken på system-parameteren i Anthropic-kallet,
 *   slik at gjentatte kall med samme system-prompt bruker cached input tokens.
 */
/** Sikkerhetsnett-timeout for AI SDK streamText — avbryter hvis Promise.all henger.
 *  Må være større enn lengste outer timeout (full-doc-mode: 150s i ki.ts), ellers
 *  kutter vi gyldige kall til Claude Sonnet på tung kontekst (75k+ tegn gir typisk
 *  100-120s respons-tid). Observert miss: 100s og 67s fra faktiske kjøringer.
 */
const STREAM_SAFETY_TIMEOUT_MS = 180_000;

/**
 * Fjerner <thinking>…</thinking>-blokker og løse åpnings-/lukkingstags fra
 * modellrespons. Observert at Claude Sonnet 4.6 av og til lekker interne
 * resonnements-blokker som synlig tekst når prompten er kompleks — disse
 * skal aldri nå fram til brukeren. Regexen fanger:
 *   1. Komplette <thinking>…</thinking>-par (med vilkårlig innhold)
 *   2. Løse <thinking>- eller </thinking>-tags uten matching partner
 * Bevarer resten av teksten uendret. Trim tar bort whitespace som blir igjen.
 */
function stripThinkingBlocks(text: string): string {
    return text
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
        .replace(/<\/?thinking>/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/** Promise.race med timeout — rydder opp timer uansett utfall. */
async function raceMedTimeout<T>(promise: Promise<T>, ms: number, melding: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(melding)), ms);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timer);
    }
}

async function callAnthropic(options: {
    model: string;
    messages: ChatMessage[];
    max_tokens: number;
    temperature: number;
    signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
    if (!anthropicSdkProvider) {
        throw new Error("Anthropic AI SDK-klient ikke initialisert (mangler ANTHROPIC_API_KEY)");
    }

    const { model, messages, max_tokens, temperature, signal } = options;

    const isModelNotFoundError = (error: unknown): boolean => {
        const maybeError = error as { status?: number; responseBody?: string; message?: string } | undefined;
        const responseBody = typeof maybeError?.responseBody === "string" ? maybeError.responseBody : "";
        const message = typeof maybeError?.message === "string" ? maybeError.message : "";
        return maybeError?.status === 404
            && (responseBody.includes("not_found_error") || message.includes("not_found_error"));
    };

    // Skill ut system-meldinger fra samtalehistorikk
    const systemMessages = messages.filter(m => m.role === "system");
    const nonSystemMessages = messages.filter(m => m.role !== "system");

    // Normaliser for Anthropic-krav (starts with user, no consecutive same-role)
    let anthropicMessages = nonSystemMessages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
    }));

    if (anthropicMessages.length > 0 && anthropicMessages[0].role !== "user") {
        anthropicMessages = [
            { role: "user" as const, content: "Start samtale." },
            ...anthropicMessages,
        ];
    }

    anthropicMessages = mergeConsecutiveSameRole(anthropicMessages);

    // Bygg messages-array for AI SDK:
    // System-melding med cache_control (ephemeral) + samtalehistorikk.
    // @ai-sdk/anthropic konverterer role:"system" + providerOptions.anthropic.cacheControl
    // til Anthropic-APIets system-parameter med cache_control-blokk.
    type SdkMessage =
        | { role: "system"; content: string; providerOptions: { anthropic: { cacheControl: { type: "ephemeral"; ttl?: "5m" | "1h" } } } }
        | { role: "user" | "assistant"; content: string };

    const sdkMessages: SdkMessage[] = [];

    for (const systemMessage of systemMessages) {
        sdkMessages.push({
            role: "system",
            content: systemMessage.content,
            providerOptions: {
                anthropic: {
                    cacheControl: systemMessage.cache_control ?? { type: "ephemeral" },
                },
            },
        });
    }

    for (const m of anthropicMessages) {
        sdkMessages.push({ role: m.role, content: m.content });
    }

    const startMs = Date.now();

    // Sjekk om signalet allerede er avbrutt (kan skje hvis req.close fyrte for tidlig i Node 20+).
    // I så fall bruker vi kun raceMedTimeout som sikkerhetsnett i stedet.
    const effectiveSignal = signal?.aborted ? undefined : signal;
    if (signal?.aborted) {
        logger.warn({ model }, "Abort-signal allerede avbrutt før Claude-kall — ignorerer signal");
    }

    logger.info({ model, messageCount: sdkMessages.length }, "Sender til Anthropic Claude (Vercel AI SDK)");

    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // onFinish får den endelige usage-objektet fra AI SDK etter at strømmen
            // er ferdig. Vi fanger det i en closure her fordi `streamResult.usage`
            // og `streamResult.totalUsage` har vist seg upålitelige med
            // ai@6 + @ai-sdk/anthropic (siste step kan være tomt → undefined felter).
            // onFinish-callbacken er den autoritative kilden.
            type CapturedUsage = {
                inputTokens?: number;
                outputTokens?: number;
                totalTokens?: number;
                cachedInputTokens?: number;
            };
            let capturedUsage: CapturedUsage | null = null;
            let capturedFinishReason: string | undefined;

            const streamResult = streamText({
                model: anthropicSdkProvider(model),
                messages: sdkMessages,
                // System-meldingene er backend-genererte og brukes for Anthropic
                // prompt caching via providerOptions. Ikke klient-injiserte.
                allowSystemInMessages: true,
                maxOutputTokens: max_tokens,
                temperature: Math.min(Math.max(temperature, 0), 1),
                abortSignal: effectiveSignal,
                onFinish: ({ usage, totalUsage, finishReason }: {
                    usage: CapturedUsage;
                    totalUsage?: CapturedUsage;
                    finishReason?: string;
                }) => {
                    // Foretrekk totalUsage (sum av alle steps) hvis tilgjengelig,
                    // fall tilbake til usage (siste step).
                    capturedUsage = totalUsage ?? usage;
                    capturedFinishReason = finishReason;
                    if (usage.cachedInputTokens) {
                        logger.info(
                            {
                                model,
                                cachedInputTokens: usage.cachedInputTokens,
                                inputTokens: usage.inputTokens,
                                outputTokens: usage.outputTokens,
                            },
                            "Anthropic Prompt Caching statistikk",
                        );
                    }
                },
            });

            // Sikkerhetsnett: Promise.race med timeout slik at vi ikke henger
            // dersom AI SDK ikke propagerer abort-signal til text/usage-promisene.
            const { text, fallbackUsage } = await raceMedTimeout(
                Promise.all([streamResult.text, streamResult.totalUsage]).then(
                    ([t, u]) => ({ text: t, fallbackUsage: u as CapturedUsage }),
                ),
                STREAM_SAFETY_TIMEOUT_MS,
                "AI-kallet tok for lang tid (timeout)",
            );

            // Bruk det vi fanget i onFinish (autoritativ), fall tilbake til
            // streamResult.totalUsage hvis onFinish ikke ble kalt av en eller annen grunn.
            const finalUsage: CapturedUsage = capturedUsage ?? fallbackUsage ?? {};
            const inputTokens = finalUsage.inputTokens ?? 0;
            const outputTokens = finalUsage.outputTokens ?? 0;

            const durationMs = Date.now() - startMs;
            logger.info(
                { model, durationMs, inputTokens, outputTokens, finishReason: capturedFinishReason },
                "Anthropic Claude-svar mottatt",
            );

            // Strip <thinking>...</thinking>-blokker og løse tags. Claude Sonnet 4.6
            // emitterer av og til slike blokker som synlig tekst når prompten er
            // kompleks (f.eks. flere overlappende systemregler). Dette er modell-
            // artefakter og skal aldri nå fram til brukeren.
            const sanitizedText = stripThinkingBlocks(text);
            if (sanitizedText.length !== text.length) {
                logger.info(
                    {
                        model,
                        originalLength: text.length,
                        strippedLength: sanitizedText.length,
                        removedChars: text.length - sanitizedText.length,
                    },
                    "Thinking-blokker strippet fra modellrespons",
                );
            }

            return {
                text: sanitizedText,
                usage: {
                    prompt_tokens: inputTokens,
                    completion_tokens: outputTokens,
                    total_tokens: finalUsage.totalTokens ?? inputTokens + outputTokens,
                },
                finishReason: capturedFinishReason,
            };
        } catch (error) {
            lastError = error;

            const status = (error as { status?: number }).status;
            const isRetryable = status === 529 || status === 500;

            if (isModelNotFoundError(error) && model !== DEFAULT_MODEL) {
                logger.warn(
                    { requestedModel: model, fallbackModel: DEFAULT_MODEL, err: error },
                    "Valgt modell ikke tilgjengelig hos Anthropic — faller tilbake til default-modell",
                );
                return callAnthropic({
                    model: DEFAULT_MODEL,
                    messages,
                    max_tokens,
                    temperature,
                    signal,
                });
            }

            if (isRetryable && attempt < MAX_RETRIES) {
                const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
                logger.warn(
                    { attempt, maxRetries: MAX_RETRIES, status, delayMs },
                    "Anthropic retryable feil — venter før nytt forsøk",
                );
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }

            const durationMs = Date.now() - startMs;
            logger.warn(
                { model, durationMs, err: error },
                "Anthropic Claude-kall feilet",
            );
            throw error;
        }
    }

    throw lastError ?? new Error("Anthropic: alle forsøk feilet uten fanget feil");
}

/**
 * Sender meldinger med bildevedlegg til Claude Vision.
 * Bygger multimodal content-blokker (image + text).
 */
async function callAnthropicWithVision(options: {
    model: string;
    messages: ChatMessage[];
    images: ImageAttachment[];
    max_tokens: number;
    temperature: number;
    signal?: AbortSignal;
}): Promise<ChatCompletionResult> {
    if (!anthropicClient) {
        throw new Error("Anthropic-klient ikke initialisert (mangler ANTHROPIC_API_KEY)");
    }

    const { model, messages, images, max_tokens, temperature, signal } = options;

    // Ekstraher system-meldinger
    const systemMessages = messages.filter(m => m.role === "system");
    const systemPrompt = systemMessages.map(m => m.content).join("\n\n");
    const nonSystemMessages = messages.filter(m => m.role !== "system");

    // Bygg Anthropic-meldinger med multimodal content for siste user-melding
    type AnthropicMessage = {
        role: "user" | "assistant";
        content: string | Array<Anthropic.Messages.ContentBlockParam>;
    };

    const anthropicMessages: AnthropicMessage[] = nonSystemMessages.map((m, idx) => {
        // Siste user-melding: legg til bildeblokker
        const erSisteUserMelding =
            m.role === "user" &&
            idx === nonSystemMessages.length - 1;

        if (erSisteUserMelding && images.length > 0) {
            const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

            // Legg til alle bilder først
            for (const img of images) {
                contentBlocks.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: img.mediaType,
                        data: img.data,
                    },
                });
            }

            // Deretter teksten
            contentBlocks.push({
                type: "text",
                text: m.content,
            });

            return {
                role: m.role as "user" | "assistant",
                content: contentBlocks,
            };
        }

        return {
            role: m.role as "user" | "assistant",
            content: m.content,
        };
    });

    // Sørg for at meldingene starter med "user" (Anthropic-krav)
    if (anthropicMessages.length > 0 && anthropicMessages[0].role !== "user") {
        anthropicMessages.unshift({ role: "user", content: "Start samtale." });
    }

    logger.info(
        { model, messageCount: anthropicMessages.length, imageCount: images.length },
        "Sender til Anthropic Claude Vision",
    );

    // Bygg system-parameter med Prompt Caching
    const systemParam: Anthropic.Messages.MessageCreateParams["system"] = systemPrompt
        ? [
              {
                  type: "text" as const,
                  text: systemPrompt,
                  cache_control: { type: "ephemeral" as const },
              },
          ]
        : undefined;

    const result = await anthropicClient.messages.create({
        model,
        system: systemParam,
        messages: anthropicMessages,
        max_tokens,
        temperature: Math.min(Math.max(temperature, 0), 1),
    }, { signal });

    const text = result.content
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("");

    return {
        text,
        usage: {
            prompt_tokens: result.usage.input_tokens,
            completion_tokens: result.usage.output_tokens,
            total_tokens: result.usage.input_tokens + result.usage.output_tokens,
        },
    };
}

/**
 * Slår sammen påfølgende meldinger med samme rolle.
 * Anthropic tillater ikke to meldinger etter hverandre med samme rolle.
 */
function mergeConsecutiveSameRole(
    messages: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
    if (messages.length === 0) return messages;

    const merged: Array<{ role: "user" | "assistant"; content: string }> = [
        { ...messages[0] },
    ];

    for (let i = 1; i < messages.length; i++) {
        const prev = merged[merged.length - 1];
        if (messages[i].role === prev.role) {
            prev.content += "\n\n" + messages[i].content;
        } else {
            merged.push({ ...messages[i] });
        }
    }

    return merged;
}
