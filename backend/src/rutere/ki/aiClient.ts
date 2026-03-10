/*
 * AI Client Factory
 * Alle KI-ruter bruker denne modulen for å sende forespørsler til Claude.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../utils/logger.js";
import { anthropicCircuit } from "../../utils/circuitBreaker.js";

// --- Klient-initialisering (én gang ved oppstart) ---

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export const anthropicClient = ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
    : null;

// --- Meldingstyper ---

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
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
}): Promise<ChatCompletionResult> {
    const { model, messages, max_tokens, temperature } = options;

    const result = await anthropicCircuit.execute(() =>
        callAnthropic({ model, messages, max_tokens, temperature }),
    );

    // Strip <analyse>/<svar>-tagger slik at brukeren kun ser det rene svaret
    result.text = stripAnalyseTags(result.text);
    return result;
}

/**
 * Sjekker om AI-klienten er tilgjengelig.
 */
export function isClientAvailable(_model: string): boolean {
    return anthropicClient !== null;
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
}): Promise<ChatCompletionResult> {
    const { model, messages, images, max_tokens, temperature } = options;

    if (!anthropicClient) {
        throw new Error("Vision er ikke tilgjengelig. Kall kun chatCompletionWithVision når isVisionAvailable(model) er sann.");
    }

    let result = await anthropicCircuit.execute(() => callAnthropicWithVision({
        model,
        messages,
        images,
        max_tokens,
        temperature,
    }));
    result.text = stripAnalyseTags(result.text);
    return result;
}

// --- Private hjelpefunksjoner ---

async function callAnthropic(options: {
    model: string;
    messages: ChatMessage[];
    max_tokens: number;
    temperature: number;
}): Promise<ChatCompletionResult> {
    if (!anthropicClient) {
        throw new Error("Anthropic-klient ikke initialisert (mangler ANTHROPIC_API_KEY)");
    }

    const { model, messages, max_tokens, temperature } = options;

    // Anthropic bruker system som separat parameter, ikke som melding
    const systemMessages = messages.filter(m => m.role === "system");
    const systemPrompt = systemMessages.map(m => m.content).join("\n\n");
    const nonSystemMessages = messages.filter(m => m.role !== "system");

    // Anthropic krever at meldinger starter med "user" role
    // Hvis første melding er "assistant", legg til en tom user-melding foran
    let anthropicMessages = nonSystemMessages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
    }));

    // Sørg for at meldingene starter med "user" (Anthropic-krav)
    if (anthropicMessages.length > 0 && anthropicMessages[0].role !== "user") {
        anthropicMessages = [
            { role: "user" as const, content: "Start samtale." },
            ...anthropicMessages,
        ];
    }

    // Slå sammen påfølgende meldinger med samme rolle (Anthropic tillater ikke dette)
    anthropicMessages = mergeConsecutiveSameRole(anthropicMessages);

    // Bygg system-parameter med Prompt Caching (cache_control: ephemeral)
    // Anthropic cacher systemprompten slik at gjentatte kall med samme prompt
    // bruker cached input tokens (90 % billigere, ~50 ms i stedet for re-parsing)
    const systemParam: Anthropic.Messages.MessageCreateParams["system"] = systemPrompt
        ? [
              {
                  type: "text" as const,
                  text: systemPrompt,
                  cache_control: { type: "ephemeral" as const },
              },
          ]
        : undefined;

    logger.info({ model, messageCount: anthropicMessages.length }, "Sender til Anthropic Claude");

    // Retry med eksponentiell backoff for 529 (overloaded) og 500 (server error)
    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await anthropicClient.messages.create({
                model,
                system: systemParam,
                messages: anthropicMessages,
                max_tokens,
                temperature: Math.min(Math.max(temperature, 0), 1), // Anthropic: 0-1
            });

            const text = result.content
                .filter(block => block.type === "text")
                .map(block => block.text)
                .join("");

            // Logg prompt caching statistikk
            // Anthropic returnerer cache_read_input_tokens og cache_creation_input_tokens
            // som ekstra felter i usage-objektet med prompt caching
            const usageAny = result.usage as unknown as Record<string, unknown>;
            const cacheRead = typeof usageAny.cache_read_input_tokens === "number" ? usageAny.cache_read_input_tokens : undefined;
            const cacheCreation = typeof usageAny.cache_creation_input_tokens === "number" ? usageAny.cache_creation_input_tokens : undefined;
            if (cacheRead || cacheCreation) {
                logger.info(
                    {
                        model,
                        cachedInputTokens: cacheRead ?? 0,
                        cacheCreationTokens: cacheCreation ?? 0,
                        inputTokens: result.usage.input_tokens,
                        outputTokens: result.usage.output_tokens,
                    },
                    "Anthropic Prompt Caching statistikk",
                );
            }

            return {
                text,
                usage: {
                    prompt_tokens: result.usage.input_tokens,
                    completion_tokens: result.usage.output_tokens,
                    total_tokens: result.usage.input_tokens + result.usage.output_tokens,
                },
            };
        } catch (error) {
            lastError = error;

            // Sjekk om feilen er retryable (529 overloaded, 500 server error)
            const status = (error as { status?: number }).status;
            const isRetryable = status === 529 || status === 500;

            if (isRetryable && attempt < MAX_RETRIES) {
                const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // 1s, 2s, 4s (maks 8s)
                logger.warn(
                    { attempt, maxRetries: MAX_RETRIES, status, delayMs },
                    "Anthropic retryable feil — venter før nytt forsøk",
                );
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }

            // Ikke retryable eller siste forsøk — kast feilen
            throw error;
        }
    }

    // Bør aldri nås, men for TypeScript
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
}): Promise<ChatCompletionResult> {
    if (!anthropicClient) {
        throw new Error("Anthropic-klient ikke initialisert (mangler ANTHROPIC_API_KEY)");
    }

    const { model, messages, images, max_tokens, temperature } = options;

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
    });

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
