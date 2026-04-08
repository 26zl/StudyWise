/**
 * Study Context Service
 *
 * Gir KI-assistenten hukommelse på tvers av samtaler.
 * Lagrer hvilke temaer studenten har utforsket per kurs,
 * og laster dette som ekstra kontekst i nye samtaler.
 */

import { logger } from "../utils/logger.js";
import { StudyContext } from "../database/models/StudyContext.js";

/** Maks antall temaer å lagre per kurs */
const MAX_TOPICS_PER_COURSE = 20;

/** Maks antall kurs å inkludere i kontekst */
const MAX_COURSES_IN_CONTEXT = 5;

/**
 * Oppdaterer studiekontekst etter et AI-svar.
 * Kalles asynkront (fire-and-forget) etter at AI-svaret er sendt.
 *
 * @param userId - Brukerens ID
 * @param courseId - Kurs-ID (null hvis generell chat)
 * @param courseName - Kursnavn
 * @param userMessage - Brukerens siste melding
 * @param aiResponse - AI-svaret
 */
export async function updateStudyContext(
  userId: string,
  courseId: string | null,
  courseName: string | null,
  userMessage: string,
  aiResponse: string,
): Promise<void> {
  if (!courseId || !courseName) return;

  try {
    // Implisitt læring: detekter forklaringsnivå-signal i brukerens melding.
    const detectedLevel = detectExplanationLevelSignal(userMessage);

    // Ekstraher et kort tema fra brukerens melding (første 80 tegn, rens)
    const topic = extractTopic(userMessage);
    if (!topic && !detectedLevel) return;

    // Ekstraher kort oppsummering fra AI-svaret (første meningsfulle setning)
    const summary = extractSummary(aiResponse);

    const existing = await StudyContext.findOne({ userId, courseId });

    if (existing) {
      if (topic) {
        // Oppdater eksisterende topic eller legg til nytt
        const existingTopic = existing.topics.find(
          (t) => t.topic.toLowerCase() === topic.toLowerCase(),
        );

        if (existingTopic) {
          existingTopic.queryCount += 1;
          existingTopic.lastAskedAt = new Date();
          existingTopic.summary = summary;
        } else {
          // Legg til nytt tema, fjern eldste hvis over grensen
          if (existing.topics.length >= MAX_TOPICS_PER_COURSE) {
            existing.topics.sort(
              (a, b) => a.lastAskedAt.getTime() - b.lastAskedAt.getTime(),
            );
            existing.topics.shift();
          }
          existing.topics.push({
            topic,
            queryCount: 1,
            lastAskedAt: new Date(),
            summary,
          });
        }
      }

      if (detectedLevel) {
        existing.preferredExplanationLevel = detectedLevel;
      }

      existing.totalInteractions += 1;
      await existing.save();
    } else if (topic) {
      // Opprett ny studiekontekst for kurset
      await StudyContext.create({
        userId,
        courseId,
        courseName,
        topics: [{
          topic: topic!,
          queryCount: 1,
          lastAskedAt: new Date(),
          summary,
        }],
        totalInteractions: 1,
        preferredExplanationLevel: detectedLevel ?? undefined,
      });
    }
  } catch (error) {
    // Aldri la kontekst-oppdatering feile chat-flyten
    logger.warn(
      { err: error, userId, courseId },
      "Feil ved oppdatering av studiekontekst",
    );
  }
}

/**
 * Laster studiekontekst for en bruker og formaterer som prompt-kontekst.
 * Returnerer tom streng hvis ingen kontekst finnes.
 */
export async function loadStudyContextForUser(
  userId: string,
  courseId?: string | null,
): Promise<string> {
  try {
    const query = courseId
      ? { userId, courseId }
      : { userId };

    const contexts = await StudyContext.find(query)
      .sort({ updatedAt: -1 })
      .limit(MAX_COURSES_IN_CONTEXT)
      .lean();

    if (contexts.length === 0) return "";

    let kontekst = "\n\n[STUDIEKONTEKST — Tidligere samtaler]\n";
    kontekst += "Studenten har tidligere diskutert følgende temaer. Bruk dette for å gi mer målrettede svar, ";
    kontekst += "men ikke referer direkte til denne konteksten med mindre studenten spør om noe relatert.\n\n";

    for (const ctx of contexts) {
      kontekst += `Kurs: ${ctx.courseName}\n`;
      kontekst += `Totalt ${ctx.totalInteractions} samtaler\n`;
      if (ctx.preferredExplanationLevel) {
        kontekst += `Foretrukket forklaringsnivå (lært implisitt): ${ctx.preferredExplanationLevel}\n`;
      }

      // Sorter temaer etter relevans (nyeste og mest spurte først)
      const sortedTopics = [...ctx.topics].sort((a, b) => {
        const recencyScore = b.lastAskedAt.getTime() - a.lastAskedAt.getTime();
        const frequencyScore = (b.queryCount - a.queryCount) * 86400000; // Vekt: 1 dag per spørsmål
        return recencyScore + frequencyScore;
      });

      // Vis maks 8 temaer per kurs
      for (const topic of sortedTopics.slice(0, 8)) {
        const dagerSiden = Math.floor(
          (Date.now() - topic.lastAskedAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        kontekst += `- ${topic.topic} (${topic.queryCount}x, ${dagerSiden}d siden): ${topic.summary}\n`;
      }
      kontekst += "\n";
    }

    kontekst += "[SLUTT STUDIEKONTEKST]\n";
    return kontekst;
  } catch (error) {
    logger.warn(
      { err: error, userId },
      "Feil ved lasting av studiekontekst",
    );
    return "";
  }
}

// ─── Hjelpefunksjoner ─────────────────────────────────────

/**
 * Detekterer implisitt signal om ønsket forklaringsnivå fra brukerens melding.
 * Returnerer null hvis ingen tydelig signal funnet.
 */
function detectExplanationLevelSignal(
  message: string,
): "simple" | "standard" | "detailed" | "expert" | null {
  const t = message.toLowerCase();
  if (/\b(forklar (det )?enkl(ere|t)|som om jeg er fem|mer grunnleggende|på en enklere måte|kortere)\b/.test(t)) {
    return "simple";
  }
  if (/\b(mer detaljert|gå i dybden|forklar grundig(ere)?|utdyp|dypere forklaring)\b/.test(t)) {
    return "detailed";
  }
  if (/\b(teknisk dypdykk|på ekspertnivå|formell definisjon|akademisk svar)\b/.test(t)) {
    return "expert";
  }
  return null;
}


/**
 * Ekstraherer et kort tematittel fra brukerens melding.
 * Fjerner vanlige spørsmålsord og returnerer kjernen av spørsmålet.
 */
function extractTopic(message: string): string | null {
  let cleaned = message
    .replace(/[?!.]+$/g, "")
    .trim();

  // Fjern vanlige innledende ord
  const prefixes = [
    /^hei,?\s+/i,
    /^kan du\s+/i,
    /^(?:forklar|beskriv|fortell om|hva er|hva betyr|hvordan fungerer|sammenlign)\s+/i,
    /^gi meg (?:en|et)?\s*(?:oversikt|forklaring|oppsummering) (?:av|på|om)\s+/i,
  ];

  for (const prefix of prefixes) {
    cleaned = cleaned.replace(prefix, "");
  }

  cleaned = cleaned.trim();

  // Returner null hvis for kort eller for langt
  if (cleaned.length < 3 || cleaned.length > 80) return null;

  // Kapp ved første setningsslutt
  const sentenceEnd = cleaned.search(/[.!?\n]/);
  if (sentenceEnd > 0) {
    cleaned = cleaned.substring(0, sentenceEnd);
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Ekstraherer en kort oppsummering fra AI-svaret.
 * Tar første meningsfulle setning etter eventuelle analyse-tags.
 */
function extractSummary(response: string): string {
  // Fjern <analyse>...</analyse> og <svar> tags
  let text = response
    .replace(/<analyse>[\s\S]*?<\/analyse>/gi, "")
    .replace(/<\/?svar>/gi, "")
    .trim();

  // Fjern markdown-overskrifter
  text = text.replace(/^#+\s+.+$/gm, "").trim();

  // Finn første meningsfulle setning
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length >= 20 && trimmed.length <= 200) {
      return trimmed;
    }
  }

  // Fallback: første 200 tegn
  return text.substring(0, 200).trim();
}
