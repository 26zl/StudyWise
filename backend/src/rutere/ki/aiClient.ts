/*
 * AI Client Factory
 * Claude er primær-AI, HuggingFace er fallback.
 * Alle KI-ruter bruker denne modulen for å sende forespørsler.
 */

import { InferenceClient } from "@huggingface/inference";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../utils/logger.js";
import { isAnthropicModel, FALLBACK_MODEL } from "./aiModels.js";

// --- Klient-initialisering (én gang ved oppstart) ---

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export const hfClient = HF_API_KEY ? new InferenceClient(HF_API_KEY) : null;
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
 * Sender chat completion til riktig leverandør basert på modellens provider.
 * Abstraherer bort forskjellene mellom HuggingFace og Anthropic API.
 * Stripper automatisk <analyse>-tagger fra responsen.
 *
 * Fallback-logikk: Hvis Claude feiler og HuggingFace er tilgjengelig,
 * prøver automatisk med FALLBACK_MODEL.
 */
export async function chatCompletion(options: {
    model: string;
    messages: ChatMessage[];
    max_tokens: number;
    temperature: number;
}): Promise<ChatCompletionResult> {
    const { model, messages, max_tokens, temperature } = options;

    let result: ChatCompletionResult;
    try {
        if (isAnthropicModel(model)) {
            result = await callAnthropic({ model, messages, max_tokens, temperature });
        } else {
            result = await callHuggingFace({ model, messages, max_tokens, temperature });
        }
    } catch (primaryError) {
        // Fallback: Hvis Claude feilet og HF er tilgjengelig, prøv HF
        if (isAnthropicModel(model) && hfClient) {
            logger.warn(
                { primaryModel: model, fallbackModel: FALLBACK_MODEL, err: primaryError },
                "Claude feilet — prøver HuggingFace fallback",
            );
            try {
                result = await callHuggingFace({
                    model: FALLBACK_MODEL,
                    messages,
                    max_tokens,
                    temperature,
                });
                logger.info({ fallbackModel: FALLBACK_MODEL }, "HuggingFace fallback vellykket");
            } catch (fallbackError) {
                logger.error({ err: fallbackError }, "HuggingFace fallback feilet også");
                // Kast den opprinnelige feilen (Claude) da den er mest relevant
                throw primaryError;
            }
        } else {
            throw primaryError;
        }
    }

    // Strip <analyse>/<svar>-tagger slik at brukeren kun ser det rene svaret
    result.text = stripAnalyseTags(result.text);
    return result;
}

/**
 * Sjekker om AI-klienten for en gitt modell er tilgjengelig.
 * For Anthropic-modeller returnerer true også hvis HF er tilgjengelig (fallback).
 */
export function isClientAvailable(model: string): boolean {
    if (isAnthropicModel(model)) {
        return anthropicClient !== null || hfClient !== null;
    }
    return hfClient !== null;
}

/**
 * Returnerer en beskrivende feilmelding hvis klienten mangler.
 */
export function getMissingClientError(model: string): string {
    if (isAnthropicModel(model)) {
        return "Mangler ANTHROPIC_API_KEY og HUGGINGFACE_API_KEY — ingen AI-leverandør tilgjengelig";
    }
    return "Mangler HUGGINGFACE_API_KEY i miljøvariabler";
}

/**
 * Sjekker om vi kan sende bilder direkte til modellen (Claude Vision).
 * Kun Anthropic-modeller støtter vision — HuggingFace fallback støtter det ikke.
 */
export function isVisionAvailable(model: string): boolean {
    return isAnthropicModel(model) && anthropicClient !== null;
}

// --- Vision-støtte (Claude Vision API) ---

/**
 * Sender chat completion med bildevedlegg til Claude Vision.
 * Bygger multimodal content-blokker (image + text) for user-meldinger.
 *
 * Hvis Claude Vision feiler og HuggingFace er tilgjengelig, faller tilbake
 * til ren tekst-modus (OCR-tekst via fallbackText).
 */
export async function chatCompletionWithVision(options: {
    model: string;
    messages: ChatMessage[];
    images: ImageAttachment[];
    max_tokens: number;
    temperature: number;
    /** OCR-tekst som fallback for HuggingFace (som ikke har vision) */
    fallbackText?: string;
}): Promise<ChatCompletionResult> {
    const { model, messages, images, max_tokens, temperature, fallbackText } = options;

    let result: ChatCompletionResult;

    try {
        if (isAnthropicModel(model) && anthropicClient) {
            result = await callAnthropicWithVision({
                model,
                messages,
                images,
                max_tokens,
                temperature,
            });
        } else if (fallbackText) {
            // Ikke-vision modell: bruk OCR-tekst i stedet
            logger.info("Vision ikke tilgjengelig for modell %s — bruker OCR-tekst fallback", model);
            const textMessages = messages.map(m => {
                if (m.role === "user" && m.content.includes("[BILDE_VEDLEGG]")) {
                    return { ...m, content: m.content.replace("[BILDE_VEDLEGG]", fallbackText) };
                }
                return m;
            });
            result = await callHuggingFace({ model, messages: textMessages, max_tokens, temperature });
        } else {
            throw new Error("Vision er ikke tilgjengelig for denne modellen og ingen OCR-fallback ble gitt");
        }
    } catch (primaryError) {
        // Fallback: Hvis Claude feilet og HF + fallbackText
        if (isAnthropicModel(model) && hfClient && fallbackText) {
            logger.warn(
                { primaryModel: model, fallbackModel: FALLBACK_MODEL, err: primaryError },
                "Claude Vision feilet — prøver HuggingFace fallback med OCR-tekst",
            );
            try {
                const textMessages = messages.map(m => {
                    if (m.role === "user" && m.content.includes("[BILDE_VEDLEGG]")) {
                        return { ...m, content: m.content.replace("[BILDE_VEDLEGG]", fallbackText) };
                    }
                    return m;
                });
                result = await callHuggingFace({
                    model: FALLBACK_MODEL,
                    messages: textMessages,
                    max_tokens,
                    temperature,
                });
                logger.info({ fallbackModel: FALLBACK_MODEL }, "HuggingFace fallback vellykket (OCR-tekst)");
            } catch (fallbackError) {
                logger.error({ err: fallbackError }, "HuggingFace fallback feilet også");
                throw primaryError;
            }
        } else {
            throw primaryError;
        }
    }

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

    logger.info({ model, messageCount: anthropicMessages.length }, "Sender til Anthropic Claude");

    const result = await anthropicClient.messages.create({
        model,
        system: systemPrompt || undefined,
        messages: anthropicMessages,
        max_tokens,
        temperature: Math.min(Math.max(temperature, 0), 1), // Anthropic: 0-1
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

    const result = await anthropicClient.messages.create({
        model,
        system: systemPrompt || undefined,
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

async function callHuggingFace(options: {
    model: string;
    messages: ChatMessage[];
    max_tokens: number;
    temperature: number;
}): Promise<ChatCompletionResult> {
    if (!hfClient) {
        throw new Error("HuggingFace-klient ikke initialisert (mangler HUGGINGFACE_API_KEY)");
    }

    const { model, messages, max_tokens, temperature } = options;

    const result = await hfClient.chatCompletion({
        model,
        messages: messages.map(m => ({
            role: m.role,
            content: m.content,
        })),
        max_tokens,
        temperature: Math.min(Math.max(temperature, 0), 2), // HF: 0-2
    });

    const text = result?.choices?.[0]?.message?.content ?? "";
    const usage = result?.usage;

    return {
        text,
        usage: usage ? {
            prompt_tokens: usage.prompt_tokens,
            completion_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
        } : undefined,
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
