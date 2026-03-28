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
    cache_control?: { type: "ephemeral" };
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
}

// --- Felles chat completion-funksjon ---

/**
 * Stripper <analyse>-tagger fra AI-respons.
 * System prompten ber modellen skrive <analyse>...</analyse><svar>...</svar>,
 * men brukeren skal kun se innholdet i <svar>.
 */
function stripAnalyseTags(raw: string): string {
    const svarMatch = raw.match(/<svar>([\s\S]*?)<\/svar>/);
    if (svarMatch) {
        return svarMatch[1].trim();
    }
    // Hvis modellen ikke brukte <svar>-tagger, fjern <analyse>-blokken alene
    const stripped = raw.replace(/<analyse>[\s\S]*?<\/analyse>/g, "").trim();
    return stripped || raw;
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
}): Promise<ChatCompletionResult> {
    const { model, messages, max_tokens, temperature, signal } = options;

    const result = await anthropicCircuit.execute(() =>
        callAnthropic({ model, messages, max_tokens, temperature, signal }),
    );

    // Strip <analyse>/<svar>-tagger slik at brukeren kun ser det rene svaret
    result.text = stripAnalyseTags(result.text);
    return result;
}

/**
 * Sjekker om AI-klienten er tilgjengelig.
 */
export function isClientAvailable(_model: string): boolean {
    return anthropicSdkProvider !== null;
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
}): Promise<ChatCompletionResult> {
    const { model, messages, images, max_tokens, temperature, signal } = options;

    if (!anthropicClient) {
        throw new Error("Vision er ikke tilgjengelig. Kall kun chatCompletionWithVision når isVisionAvailable(model) er sann.");
    }

    let result = await anthropicCircuit.execute(() => callAnthropicWithVision({
        model,
        messages,
        images,
        max_tokens,
        temperature,
        signal,
    }));
    result.text = stripAnalyseTags(result.text);
    return result;
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
        | { role: "system"; content: string; providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
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

    logger.info({ model, messageCount: sdkMessages.length }, "Sender til Anthropic Claude (Vercel AI SDK)");

    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const streamResult = streamText({
                model: anthropicSdkProvider(model),
                messages: sdkMessages,
                maxOutputTokens: max_tokens,
                temperature: Math.min(Math.max(temperature, 0), 1),
                abortSignal: signal,
                onFinish: ({ usage }: { usage: { cachedInputTokens?: number; inputTokens?: number; outputTokens?: number } }) => {
                    // cachedInputTokens er innebygd i LanguageModelUsage (ai@6)
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

            const [text, usage] = await Promise.all([streamResult.text, streamResult.usage]);

            return {
                text,
                usage: {
                    prompt_tokens: usage.inputTokens ?? 0,
                    completion_tokens: usage.outputTokens ?? 0,
                    total_tokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
                },
            };
        } catch (error) {
            lastError = error;

            const status = (error as { status?: number }).status;
            const isRetryable = status === 529 || status === 500;

            if (isRetryable && attempt < MAX_RETRIES) {
                const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
                logger.warn(
                    { attempt, maxRetries: MAX_RETRIES, status, delayMs },
                    "Anthropic retryable feil — venter før nytt forsøk",
                );
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }

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
