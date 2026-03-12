/*
 * Token-teller for Claude-meldinger.
 * Bruker tiktoken med GPT-4o-encoding (o200k_base) som grovt estimat.
 * Claude bruker sin egen tokenizer, så dette er kun for budsjettkontroll.
 */

import { encodingForModel } from "js-tiktoken";
import { logger } from "./logger.js";

// GPT-4o bruker o200k_base i js-tiktoken og gir et stabilt, konservativt estimat.
const encoder = encodingForModel("gpt-4o");

/** Tell tokens i en tekststreng */
export function countTokens(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Beregner token-bruk for et sett med meldinger.
 * Returnerer total token-count inkl. overhead per melding (~4 tokens per melding).
 */
export function countMessageTokens(
  messages: Array<{ role: string; content: string }>,
): number {
  let total = 0;
  for (const msg of messages) {
    total += countTokens(msg.content) + 4; // ~4 tokens overhead per melding (role, delimiters)
  }
  return total;
}

/**
 * Trimmer meldingshistorikk til å passe innenfor en token-grense.
 * Beholder alltid den nyeste meldingen (siste bruker-input).
 * Fjerner de eldste meldingene først.
 *
 * @param messages - Meldinger (uten system-prompt)
 * @param maxTokens - Maks antall tokens for meldingshistorikk
 * @returns Trimmet meldingsarray
 */
export function trimToTokenLimit<T extends { role: string; content: string }>(
  messages: T[],
  maxTokens: number,
): T[] {
  if (messages.length === 0) return messages;

  // Beregn total
  const total = countMessageTokens(messages);
  if (total <= maxTokens) return messages;

  // Fjern fra starten til vi er innenfor grensen
  let trimmed = [...messages];
  let currentTokens = total;

  while (currentTokens > maxTokens && trimmed.length > 1) {
    const removed = trimmed.shift()!;
    currentTokens -= countTokens(removed.content) + 4;
  }

  if (trimmed.length < messages.length) {
    logger.info(
      {
        originalCount: messages.length,
        trimmedCount: trimmed.length,
        originalTokens: total,
        trimmedTokens: currentTokens,
        maxTokens,
      },
      "Meldingshistorikk trimmet basert på token-grense",
    );
  }

  return trimmed;
}
