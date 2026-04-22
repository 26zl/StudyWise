/**
 * Redis-basert response-cache for deterministiske leksjon-spørringer.
 *
 * Hvorfor: full-document-mode-svar tar ~100 sek å generere. Studenter stiller
 * ofte identiske spørsmål ("oppsummer leksjon X") om samme kurs. Ved cache-hit
 * kan vi servere det tidligere genererte svaret på ~2 sek i stedet.
 *
 * Når vi cacher:
 * - intent === "canvas_full" OG fullDocumentMode === true
 * - moduleHint eller fileHint satt (deterministisk signatur)
 * - Ingen cross-course guard trigget (cache må være kurs-scoped og korrekt)
 * - Vellykket fullført Claude-respons
 *
 * Når vi IKKE cacher:
 * - general_chat eller canvas_light (for variabelt innhold)
 * - Chunk-mode (svar avhenger av hvilke chunks som ble valgt — mindre stabilt)
 * - Cross-course tilfeller (guard'en kan gi feil signatur ellers)
 * - Feilede eller korte "beklager"-svar
 *
 * Nøkkelstruktur:
 *   chat-response:v1:{primaryCourseId}:{primaryFileId}:{triggerClass}:{moduleHint}
 *
 * Brukeren er ikke del av nøkkelen fordi innholdet er deterministisk på
 * (courseId, fileId, trigger-klasse). To studenter som begge har tilgang til
 * samme kurs og spør samme spørsmål skal få samme svar.
 *
 * Autoriserings-sjekk må fortsatt kjøres separat — caller er ansvarlig for
 * å verifisere at brukeren har courseId i sin Canvas-katalog før getCachedResponse
 * kalles.
 */
import { getCache, setCache, deleteCacheKeys } from "../cache/redis.js";
import { logger } from "../utils/logger.js";
import { z } from "zod";

/** TTL i sekunder (24 timer). Content-hash-basert invalidering hadde vært
 *  bedre men koster en DB-roundtrip per cache-hit — 24h er pragmatisk start. */
export const CHAT_RESPONSE_CACHE_TTL_SECONDS = 60 * 60 * 24;

/** Skjema for lagret respons — inkluderer både tekst og kilder. */
const CachedChatResponseSchema = z.object({
  version: z.literal(1),
  response: z.string(),
  kilder: z.array(z.unknown()).optional(),
  model: z.string(),
  generatedAt: z.string(),
  primaryCourseId: z.string(),
  primaryFileId: z.number(),
  triggerWord: z.string().optional(),
});

export type CachedChatResponse = z.infer<typeof CachedChatResponseSchema>;

/**
 * Klassifiser trigger-ord i grove kategorier slik at "oppsummer" og "sammendrag"
 * deler cache (identisk intent), men "utdyp" får egen cache (annet intent →
 * annet svar-format).
 *
 * "deep" dekker både eksplisitt fordypning ("utdyp", "mer om") og full-
 * gjennomgang-triggere ("gå igjennom", "ta denne"). Begge krever høyere
 * max_tokens (8000) for å unngå truncation av 20k+ tegn PDF-er.
 *
 * Eksporteres slik at ki.ts kan bruke samme klassifikasjon til å velge
 * max_tokens — enkeltsannhetskilde forhindrer drift mellom cache-nøkkel
 * og token-allokering.
 */
export function classifyTriggerWord(triggerWord: string): "deep" | "standard" {
  return /\b(utdyp|utdype|mer om|fortell mer|forklar mer|gå igjennom|gjennomgå|gi gjennomgang|ta denne)/i.test(
    triggerWord,
  )
    ? "deep"
    : "standard";
}

/** Normaliser moduleHint for stabil cache-nøkkel ("Leksjon 8" ≡ "leksjon 8"). */
function normalizeModuleHint(moduleHint: string): string {
  return moduleHint
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9æøå-]/g, "")
    .slice(0, 60);
}

export interface ChatResponseCacheKeyInput {
  primaryCourseId: string;
  primaryFileId: number;
  triggerWord: string | null;
  moduleHint: string | null;
  fileHint: string | null;
}

/**
 * Bygger deterministisk cache-nøkkel. Returnerer null når input mangler
 * fields som kreves for stabil caching (da cacher vi ikke).
 */
export function buildChatResponseCacheKey(
  input: ChatResponseCacheKeyInput,
): string | null {
  if (!input.primaryCourseId || !input.primaryFileId) return null;
  if (!input.moduleHint && !input.fileHint) return null;
  const triggerClass = input.triggerWord
    ? classifyTriggerWord(input.triggerWord)
    : "standard";
  const hintPart = input.moduleHint
    ? normalizeModuleHint(input.moduleHint)
    : `file-${input.fileHint?.slice(0, 40) ?? "unknown"}`;
  return `chat-response:v1:${input.primaryCourseId}:${input.primaryFileId}:${triggerClass}:${hintPart}`;
}

export async function getCachedChatResponse(
  key: string,
): Promise<CachedChatResponse | null> {
  try {
    const raw = await getCache(key);
    if (!raw) return null;
    const parsed = CachedChatResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      logger.warn({ key }, "Cached chat response feilet Zod-validering — sletter");
      await deleteCacheKeys([key]);
      return null;
    }
    return parsed.data;
  } catch (err) {
    logger.warn({ err, key }, "getCachedChatResponse feilet");
    return null;
  }
}

export async function setCachedChatResponse(
  key: string,
  value: Omit<CachedChatResponse, "version" | "generatedAt">,
): Promise<void> {
  try {
    const payload: CachedChatResponse = {
      version: 1,
      generatedAt: new Date().toISOString(),
      ...value,
    };
    await setCache(
      key,
      JSON.stringify(payload),
      CHAT_RESPONSE_CACHE_TTL_SECONDS,
    );
    logger.info(
      {
        key,
        responseLength: value.response.length,
        primaryFileId: value.primaryFileId,
      },
      "Chat-respons lagret i cache",
    );
  } catch (err) {
    logger.warn({ err, key }, "setCachedChatResponse feilet");
  }
}
