/*
 * AI Client Factory
 * Sentralisert initialisering av AI-klienter (HuggingFace + Anthropic)
 * Alle KI-ruter bruker denne modulen for å sende forespørsler.
 */

import { InferenceClient } from "@huggingface/inference";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../../utils/logger.js";
import { isAnthropicModel } from "./aiModels.js";

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
 */
export async function chatCompletion(options: {
    model: string;
    messages: ChatMessage[];
    max_tokens: number;
    temperature: number;
}): Promise<ChatCompletionResult> {
    const { model, messages, max_tokens, temperature } = options;

    let result: ChatCompletionResult;
    if (isAnthropicModel(model)) {
        result = await callAnthropic({ model, messages, max_tokens, temperature });
    } else {
        result = await callHuggingFace({ model, messages, max_tokens, temperature });
    }

    // Strip <analyse>/<svar>-tagger slik at brukeren kun ser det rene svaret
    result.text = stripAnalyseTags(result.text);
    return result;
}

/**
 * Sjekker om AI-klienten for en gitt modell er tilgjengelig.
 */
export function isClientAvailable(model: string): boolean {
    if (isAnthropicModel(model)) {
        return anthropicClient !== null;
    }
    return hfClient !== null;
}

/**
 * Returnerer en beskrivende feilmelding hvis klienten mangler.
 */
export function getMissingClientError(model: string): string {
    if (isAnthropicModel(model)) {
        return "Mangler ANTHROPIC_API_KEY i miljøvariabler";
    }
    return "Mangler HUGGINGFACE_API_KEY i miljøvariabler";
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
