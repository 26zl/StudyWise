/**
 * Quiz API — genererer KI-baserte quizer fra Canvas-kursinnhold.
 * POST /api/quiz/generate — aksepterer forespørselen og returnerer jobId (asynkron).
 * GET  /api/quiz/status/:jobId — poller for ferdig resultat.
 *
 * Bakgrunnsbehandling unngår Heroku sin 30s HTTP-timeout ved å sende
 * 202 Accepted umiddelbart og lagre resultatet i Redis når det er klart.
 */
import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import {
  QuizGenerateRequestSchema,
  QuizGenerateResponseSchema,
  QuizQuestionSchema,
  AsyncJobAcceptedSchema,
  AsyncJobStatusSchema,
} from "common/ki";
import { logger } from "../../utils/logger.js";
import {
  apiError,
  sendZodError,
  sendUnknownError,
  requireUserId,
} from "../../utils/apiError.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import { DEFAULT_MODEL } from "../ki/aiModels.js";
import { chatCompletion, isClientAvailable } from "../ki/aiClient.js";
import { knyttCanvasToken } from "../../middleware/auth.js";
import { loadCanvasContext, ensureCanvasSync } from "../../services/context-loader.service.js";
import { isSyncing, waitForSync } from "../../services/canvas-sync.service.js";
import {
  AI_COMPLETION_PUSH_MIN_DURATION_MS,
  sendAICompletionWebPush,
} from "../../services/webPush.service.js";
import {
  createCourseTargetedQuery,
  extractJsonArray,
  extractJsonObject,
} from "../ki/studyContentUtils.js";
import { getCache, setCache } from "../../cache/redis.js";

/** Maks ventetid på Canvas-sync før quiz fortsetter med tilgjengelig data */
const QUIZ_SYNC_WAIT_MS = 8_000;

/** TTL for jobb-resultat i Redis (10 minutter) */
const JOB_TTL_SECONDS = 600;

/** Redis-nøkkelprefix for quiz-jobber */
const JOB_KEY_PREFIX = "quiz-job:";

/** Wrapper-skjema som binder en lagret jobb-state til eieren. */
const JobWrapperSchema = z.object({
  ownerUserId: z.string().min(1),
  state: AsyncJobStatusSchema,
});

/** Lagrer jobb-state innpakket med eier-ID slik at status-endepunktet
 *  kan validere at kun eieren får lese status og resultat. */
async function setJobState(
  jobId: string,
  ownerUserId: string,
  state: import("common/ki").AsyncJobStatus,
): Promise<void> {
  await setCache(
    `${JOB_KEY_PREFIX}${jobId}`,
    JSON.stringify({ ownerUserId, state }),
    JOB_TTL_SECONDS,
  );
}

const router = Router();
router.use(rateLimitKi);

const QUIZ_SYSTEM_PROMPT = `Du er en ekspert studieveileder som lager quiz-spørsmål basert på kursmateriell.
Svar ALLTID med KUN et JSON-array uten ekstra tekst, markdown eller forklaring.
Hvert objekt i arrayet skal ha:
- "question": spørsmålet
- "options": nøyaktig 4 svaralternativer (array med 4 strenger)
- "correctIndex": indeks (0-3) til riktig svar
- "explanation": kort forklaring på hvorfor svaret er riktig (1-3 setninger)

### Hva er et godt quiz-spørsmål?
Spørsmålene skal teste FAGLIG FORSTÅELSE av pensumet — definisjoner, konsepter, årsakssammenhenger, prosesser, metoder, begreper. Tenk "hva må en student kunne for å bestå eksamen i dette?".

### ABSOLUTT FORBUDT — metaspørsmål om kursstrukturen
Du skal ALDRI lage spørsmål om:
- Hvilken modul/leksjon et tema tilhører (f.eks. "Hvilken modul inneholder leksjon X?")
- Hvilken aktivitet/oppgavetype som følger etter en leksjon (f.eks. "Hva følger etter leksjon 2?")
- Rekkefølgen på moduler/leksjoner
- Antall moduler, leksjoner eller oppgaver
- Navn på filer, dokumenter eller Canvas-ressurser
- Administrative detaljer (frister, innleveringsformat, gruppearbeid)

Disse spørsmålene tester ikke kunnskap — de tester at studenten har lest innholdslista. Hvis kursmateriellet mest er metadata, prøv å dra ut det lille faglige innholdet som finnes (oppgavebeskrivelser, korte forklaringer) og bygg spørsmål derfra i stedet.

### Språk — ABSOLUTT KRAV
Alt quiz-output (question, options, explanation) MÅ være på norsk Bokmål.
Dette gjelder UANSETT hvilket språk kildematerialet er på. Nynorsk, Svensk
og Dansk er IKKE akseptable. Oversett terminologi ved behov.

Selv når kildene er på Nynorsk (f.eks. "Førelesingsplan", "oppgåve",
"skilnaden"), skriv alt på Bokmål. Vanlige Nynorsk → Bokmål-erstatninger:
- "kva" → "hva"
- "kvifor" → "hvorfor"
- "korleis" → "hvordan"
- "ikkje" → "ikke"
- "berre" → "bare"
- "eg" → "jeg"
- "ei" → "en/ei (ubestemt artikkel)"
- "skilnaden" → "forskjellen"
- "viktigaste" → "viktigste"
- "å vere/vera" → "å være"
- "har vore" → "har vært"
- "noko" → "noe"
- "verta/verte" → "bli"
- "oppgåve" → "oppgave"
- "førelesing" → "forelesning"
- "studiar" → "studier"
- "baserte" → "basert"

Unntak: svar på engelsk KUN hvis studenten eksplisitt skrev på engelsk.

### Andre regler
- Spørsmålene skal variere i vanskelighetsgrad (lett, middels, vanskelig)
- Alternativene skal være plausible — unngå åpenbart feil distraktorer
- Alternativene skal ha omtrentlig lik lengde og format
- Unngå at riktig svar er merkbart lengre enn de andre (ikke legg inn ekstra forklaringer i riktig alternativ)
- Hold svaralternativene korte og parallelle (samme setningsstruktur der det gir mening)
- Svaralternativene skal ha omtrent samme antall ord (+/- 2 ord)
- Basér spørsmålene UTELUKKENDE på det medfølgende kursmateriellet — ikke bruk ekstern kunnskap
- Shuffle riktig svar-posisjon — IKKE sett correctIndex til 0 for alle spørsmål
- Dekk ulike deler av materiellet — ikke still flere spørsmål om samme konsept
- Bruk fagterminologi fra kursmateriellet (men oversatt til Bokmål hvis kilden er på Nynorsk)

### Forklaringer (KRITISK)
Backend stokker alternativene etter at du har svart, så posisjoner er ustabile. Forklaringen MÅ derfor være posisjons-agnostisk:
- Skriv ALDRI "alternativ A/B/C/D", "første alternativ", "nummer 2", "option B", "svar 3" eller lignende
- Skriv ALDRI "indeks 0/1/2/3" eller refererer til plassering i lista
- Gjenta heller selve SVARET med egne ord: "Riktig svar er 'kvantitativ metode' fordi..."
- Eller forklar KONSEPTET direkte uten å referere til alternativ-posisjon: "Dette skyldes at..."`;

const QUIZ_OPTION_REWRITE_PROMPT = `Du er en norsk quiz-redaktor.
Svar KUN med et JSON-objekt uten ekstra tekst, markdown eller forklaring.
JSON-objektet skal ha:
- "options": nøyaktig 4 svaralternativer (array med 4 strenger)
- "correctIndex": indeks (0-3) til riktig svar
- "explanation": kort forklaring på hvorfor svaret er riktig (1-3 setninger)

Regler:
- Alt skal være på norsk Bokmal.
- Alternativene skal ha omtrent lik lengde og lik setningsstruktur.
- Svaralternativene skal ha omtrent samme antall ord (+/- 2 ord).
- Riktig svar skal IKKE være merkbart lengre enn de andre.
- Behold faglig korrekthet: riktig svar skal fortsatt være riktig.
- Forklaringen skal vaere posisjons-agnostisk (ikke referer til alternativ A/B eller indeks).
`;

/**
 * Resolver posisjonsreferanser i en quiz-forklaring til faktisk alternativtekst.
 * Mål: en forklaring skrevet mot PRE-shuffle-rekkefølgen ("alternativ B er
 * riktig") skal fortsatt gi mening etter at backend shuffler options. Vi
 * substituerer matchede posisjonsuttrykk med innholdet på den opprinnelige
 * indeksen i sitat, slik at referansen blir innholds-basert i stedet for
 * posisjons-basert.
 *
 * Dekker:
 *   - Bokstavlabels: "alternativ A/B/C/D", "option A/B/C/D"
 *   - Ordinaler på norsk og engelsk: "første/andre/tredje/fjerde alternativ",
 *     "first/second/third/fourth option"
 *   - Numeriske: "svar 1/2/3/4", "nummer 1/2/3/4", "answer 1/2/3/4"
 *
 * Returnerer den omskrevne teksten + indikatorer for logging. Hvis en
 * substitusjonsindeks er utenfor `options`-lengden, beholder vi originalteksten.
 */
type ExplanationSanitizeResult = {
  text: string;
  /** true hvis vi oppdaget posisjonsreferanser (brukes til logg-varsel). */
  detected: boolean;
  /** true hvis vi faktisk endret teksten (minst én substitusjon gjennomført). */
  changed: boolean;
};

const NORDINAL_TO_INDEX: Record<string, number> = {
  forste: 0,
  første: 0,
  andre: 1,
  tredje: 2,
  fjerde: 3,
  first: 0,
  second: 1,
  third: 2,
  fourth: 3,
};

export function resolvePositionReferencesInExplanation(
  explanation: string,
  options: string[],
): ExplanationSanitizeResult {
  if (!explanation || options.length === 0) {
    return { text: explanation, detected: false, changed: false };
  }

  let detected = false;
  let changed = false;
  const safeReplace = (idx: number): string | null => {
    if (idx < 0 || idx >= options.length) return null;
    const content = options[idx].trim();
    if (!content) return null;
    changed = true;
    return `«${content}»`;
  };

  let text = explanation;

  // Bokstavlabel: "alternativ A", "option B"
  text = text.replace(
    /\b(alternativ|option)\s+([A-Da-d])\b/gi,
    (match, _label: string, letter: string) => {
      detected = true;
      const idx = "abcd".indexOf(letter.toLowerCase());
      return safeReplace(idx) ?? match;
    },
  );

  // Ordinal-ord: "første alternativ", "second option"
  text = text.replace(
    /\b(første|forste|andre|tredje|fjerde|first|second|third|fourth)\s+(?:alternativ|option|svaret|answer)\b/gi,
    (match, ord: string) => {
      detected = true;
      const idx = NORDINAL_TO_INDEX[ord.toLowerCase()];
      return idx !== undefined ? (safeReplace(idx) ?? match) : match;
    },
  );

  // Numerisk: "svar 1", "nummer 2", "answer 3", "option 4"
  text = text.replace(
    /\b(svar|svaret|nummer|answer|option)\s+([1-4])\b/gi,
    (match, _label: string, digit: string) => {
      detected = true;
      const idx = parseInt(digit, 10) - 1;
      return safeReplace(idx) ?? match;
    },
  );

  // "indeks 0/1/2/3", "index 2"
  text = text.replace(
    /\b(indeks|index)\s+([0-3])\b/gi,
    (match, _label: string, digit: string) => {
      detected = true;
      const idx = parseInt(digit, 10);
      return safeReplace(idx) ?? match;
    },
  );

  return { text, detected, changed };
}

/**
 * Deteksjon av Nynorsk-ord som IKKE finnes i Bokmål (eller der bruken er
 * sterkt Nynorsk-markert). Brukes til å logge varsel når Claude ignorerer
 * språk-regelen og produserer Nynorsk-quiz på tross av instruksjonen.
 *
 * Vi prøver IKKE å auto-oversette — grammatikk og kontekst er for subtil.
 * Detektoren gir oss data til å se om prompt-regelen fungerer i praksis.
 */
const NYNORSK_MARKERS: RegExp[] = [
  /\bkva\b/i, // "hva"
  /\bkvifor\b/i, // "hvorfor"
  /\bkorleis\b/i, // "hvordan"
  /\bikkje\b/i, // "ikke"
  /\bberre\b/i, // "bare"
  /\beg\b(?!\s*\.|[.,;])/i, // "jeg" — unngå å matche "e.g." o.l.
  /\bskilnad\w*/i, // "forskjell"
  /\bviktigast\w*/i, // "viktigste"
  /\bå\s+vera\b/i, // "å være" (Nynorsk-variant)
  /\bnoko\b/i, // "noe"
  /\bverta\b/i, // "bli"
  /\boppgåv\w*/i, // "oppgave"
  /\bførelesing\w*/i, // "forelesning"
  /\bstudiar\b/i, // "studier"
  /\bfleire\b/i, // "flere" (Nynorsk: "fleire")
];

export function detectNynorskMarkers(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of NYNORSK_MARKERS) {
    const match = text.match(pattern);
    if (match) hits.push(match[0]);
  }
  return hits;
}

/**
 * Shuffler alternativene i et quiz-spørsmål med Fisher-Yates og returnerer
 * en NY versjon av spørsmålet med oppdatert `correctIndex`. Eksportert for
 * testbarhet — vi vil kunne verifisere at distribusjonen er uniform og
 * hindre skjevheter som LLM-biasen mot `correctIndex: 0` (eller rapportert
 * "1-4-1-4"-mønster).
 */
export function shuffleQuizOptions<
  Q extends { options: string[]; correctIndex: number },
>(q: Q, random: () => number = Math.random): Q {
  const n = q.options.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const newOptions = indices.map((oldIdx) => q.options[oldIdx]);
  const newCorrectIndex = indices.indexOf(q.correctIndex);
  return { ...q, options: newOptions, correctIndex: newCorrectIndex };
}

const QuizOptionRewriteSchema = z.object({
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
});

function optionLength(value: string): number {
  return value.trim().length;
}

function isCorrectOptionLengthBiased(options: string[], correctIndex: number): boolean {
  if (correctIndex < 0 || correctIndex >= options.length) return false;
  const lengths = options.map(optionLength);
  const correctLen = lengths[correctIndex] ?? 0;
  const otherLengths = lengths.filter((_, idx) => idx !== correctIndex);
  const avg = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const maxOther = Math.max(...otherLengths);
  return correctLen >= Math.max(avg * 1.35, maxOther + 20);
}

function areOptionLengthsBalanced(options: string[]): boolean {
  if (options.length === 0) return true;
  const lengths = options.map(optionLength);
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  const avg = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  return max - min <= 18 && max <= avg * 1.2;
}

async function rewriteQuizOptionsIfNeeded(
  question: { question: string; options: string[]; correctIndex: number; explanation: string },
  model: string,
): Promise<typeof question> {
  if (areOptionLengthsBalanced(question.options)) {
    return question;
  }

  const correctAnswer = question.options[question.correctIndex] ?? "";
  if (!correctAnswer) return question;

  const rewritePrompt = `Sporsmal: ${question.question}
Riktig svar (maa bevares i betydning): ${correctAnswer}
Naverende alternativer:
${question.options.map((opt, idx) => `${idx + 1}. ${opt}`).join("\n")}

Lag nye alternativer i samme betydning, men med jevn lengde.`;

  try {
    const result = await chatCompletion({
      model,
      messages: [
        { role: "system", content: QUIZ_OPTION_REWRITE_PROMPT },
        { role: "user", content: rewritePrompt },
      ],
      max_tokens: 1200,
      temperature: 0.5,
      traceName: "quiz-options-rewrite",
    });

    const parsed = QuizOptionRewriteSchema.parse(JSON.parse(extractJsonObject(result.text)));
    return {
      ...question,
      options: parsed.options,
      correctIndex: parsed.correctIndex,
      explanation: parsed.explanation,
    };
  } catch (error) {
    logger.warn({ err: error }, "Kunne ikke balansere quiz-alternativer");
    return question;
  }
}

/**
 * Kjører selve quiz-genereringen i bakgrunnen og lagrer resultatet i Redis.
 * Kalles som fire-and-forget fra POST-endepunktet.
 */
async function processQuizJob(
  jobId: string,
  userId: string,
  canvasToken: string,
  canvasBaseUrl: string | undefined,
  courseId: number,
  courseName: string,
  moduleNames: string[],
  fileNames: string[],
  questionCount: number,
): Promise<void> {
  const generationStartedAt = Date.now();
  try {
    // Sørg for at Canvas-data er synkronisert
    await ensureCanvasSync(userId, canvasToken, canvasBaseUrl);
    if (isSyncing(userId)) {
      logger.info({ userId, courseId }, "Venter på Canvas sync før quiz-generering");
      await waitForSync(userId, QUIZ_SYNC_WAIT_MS);
    }

    // Hent Canvas-kontekst
    const allNames = [...moduleNames, ...fileNames];
    const contentListStr = allNames.join(", ");
    const contextResult = await loadCanvasContext(
      userId,
      canvasToken,
      "canvas_full",
      createCourseTargetedQuery(courseId, courseName, moduleNames, fileNames),
      `Quiz om ${contentListStr} i ${courseName}`,
      canvasBaseUrl,
    );

    if (!contextResult.hasCanvasData) {
      logger.warn(
        {
          userId,
          courseId,
          courseName,
          moduleCount: moduleNames.length,
          fileCount: fileNames.length,
          contextSource: contextResult.source,
          syncWaited: !!contextResult.syncWaited,
          reason: contextResult.syncWaited ? "sync_just_triggered_no_chunks_yet" : "no_chunks_for_selection",
        },
        "Quiz-generering avbrutt: ingen Canvas-data for valgte moduler/filer",
      );
      await setJobState(jobId, userId, {
        status: "failed",
        error: "Ingen kursinnhold funnet for valgte moduler/filer. Prøv å åpne KI-chatten først slik at Canvas-data synkroniseres.",
      });
      return;
    }

    const userPrompt = `Lag ${questionCount} quiz-spørsmål om følgende innhold i emnet "${courseName}":
${allNames.map((m) => `- ${m}`).join("\n")}

KURSMATERIELL:
${contextResult.kontekst}

Generer nøyaktig ${questionCount} spørsmål som JSON-array.`;

    logger.info(
      { userId, courseId, courseName, contextLength: contextResult.kontekst.length },
      "Starter quiz-generering via Claude",
    );

    // Skalér max_tokens med questionCount: hvert spørsmål ≈ 250-350 tokens
    // (JSON-struktur, 4 alternativer, forklaring). 4096 var hardkodet og kuttet
    // JSON-outputen for 20 spørsmål (observert 6105N: responseLength 12666
    // men JSON.parse feilet på posisjon 12540 pga midt-i-objekt-avkutting).
    const quizMaxTokens = Math.min(16000, Math.max(4096, 600 + questionCount * 350));
    const result = await chatCompletion({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: QUIZ_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: quizMaxTokens,
      temperature: 0.7,
      traceName: "quiz-generate",
      traceMeta: {
        userId,
        courseId,
        intent: "canvas_full",
        mode: "quiz",
      },
    });

    logger.info(
      { userId, courseId, responseLength: result.text.length },
      "Claude-svar mottatt for quiz-generering",
    );

    // Defensiv størrelses-guard: max_tokens er ikke det samme som bytes — et uvanlig
    // stort svar kan gi OOM eller blokkere event loop i JSON.parse.
    const MAX_RESPONSE_BYTES = 1_000_000; // 1 MB
    if (result.text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`Quiz-svaret er for stort (${result.text.length} bytes)`);
    }

    const rawQuestions = z
      .array(QuizQuestionSchema.omit({ id: true }))
      .min(1)
      .max(50)
      .parse(JSON.parse(extractJsonArray(result.text)));

    // Rebalanser alternativer hvis riktig svar ofte blir merkbart lengre.
    const biasedQuestions = rawQuestions.filter((q) =>
      isCorrectOptionLengthBiased(q.options, q.correctIndex),
    );
    const rewrittenQuestions: typeof rawQuestions = [];
    let rewritesDone = 0;
    for (const q of rawQuestions) {
      if (!areOptionLengthsBalanced(q.options)) {
        const rewritten = await rewriteQuizOptionsIfNeeded(q, DEFAULT_MODEL);
        rewrittenQuestions.push(rewritten);
        rewritesDone++;
        continue;
      }
      rewrittenQuestions.push(q);
    }
    if (rewritesDone > 0) {
      logger.info(
        { userId, courseId, rewritesDone, biasedCount: biasedQuestions.length },
        "Rebalanserte quiz-alternativer for a unnga lengde-bias",
      );
    }

    // LLM-er har en tendens til å legge riktig svar på samme posisjon (ofte
    // indeks 0 eller 1) selv når prompten ber om variasjon. Shuffle server-side
    // er den eneste pålitelige måten å fjerne denne biasen på. Før vi shuffler,
    // resolver vi posisjonsreferanser i forklaringen ("alternativ B", "første
    // alternativ", "option C" osv.) til faktisk alternativtekst — da er
    // forklaringen immun mot at posisjonene endres ved shuffle.
    let sanitizedExplanations = 0;
    let detectedPositionRefs = 0;
    const normalizedQuestions = rewrittenQuestions.map((q) => {
      const sanitized = resolvePositionReferencesInExplanation(
        q.explanation,
        q.options,
      );
      if (sanitized.detected) detectedPositionRefs++;
      if (sanitized.changed) sanitizedExplanations++;
      return { ...q, explanation: sanitized.text };
    });
    if (detectedPositionRefs > 0) {
      logger.warn(
        {
          userId,
          courseId,
          detectedPositionRefs,
          sanitizedExplanations,
          totalQuestions: rawQuestions.length,
        },
        "Quiz-forklaringer inneholdt posisjonsreferanser — resolvet til alternativtekst før shuffle",
      );
    }

    const shuffledQuestions = normalizedQuestions.map((q) => shuffleQuizOptions(q));
    // Logg resulterende correctIndex-distribusjon — hvis admin rapporterer
    // skjev fordeling skal vi kunne verifisere mot faktiske tall fra produksjon.
    const distribution = [0, 0, 0, 0];
    for (const q of shuffledQuestions) {
      if (q.correctIndex >= 0 && q.correctIndex < 4) {
        distribution[q.correctIndex]++;
      }
    }
    logger.info(
      { userId, courseId, questionCount: shuffledQuestions.length, correctIndexDistribution: distribution },
      "Quiz-shuffle fullført — correctIndex-distribusjon",
    );

    // Språk-kontroll: varsle hvis Claude slapp gjennom Nynorsk-ord til tross
    // for regelen i system-prompten. Auto-oversettelse er for risikabelt
    // (grammatikk + kontekst), men deteksjonen lar oss se hvor ofte det
    // skjer og om vi trenger sterkere tiltak.
    const nynorskHits = new Set<string>();
    for (const q of shuffledQuestions) {
      const combined = [q.question, ...q.options, q.explanation].join(" ");
      for (const hit of detectNynorskMarkers(combined)) {
        nynorskHits.add(hit.toLowerCase());
      }
    }
    if (nynorskHits.size > 0) {
      logger.warn(
        {
          userId,
          courseId,
          courseName,
          detectedNynorskWords: Array.from(nynorskHits),
          questionCount: shuffledQuestions.length,
        },
        "Quiz-output inneholdt Nynorsk-markører til tross for Bokmål-regel",
      );
    }

    const questions = shuffledQuestions.map((q) => ({
      id: randomUUID(),
      ...q,
    }));

    logger.info(
      { userId, courseName, moduleNames, questionCount: questions.length },
      "Genererte quiz-spørsmål via KI",
    );

    // Lagre ferdig resultat i Redis
    const responsePayload = QuizGenerateResponseSchema.parse({ questions });
    await setJobState(jobId, userId, { status: "completed", result: responsePayload });

    const generationDurationMs = Date.now() - generationStartedAt;
    if (generationDurationMs >= AI_COMPLETION_PUSH_MIN_DURATION_MS) {
      void sendAICompletionWebPush({
        userId,
        title: "StudyWise: Quizen er klar",
        body: "KI har generert quiz-spørsmål for deg.",
        url: "/dashboard?view=quiz",
        tag: `studywise-ai-quiz-${userId}-${courseId}`,
      }).catch((err) => {
        logger.warn(
          { err, userId, courseId },
          "Kunne ikke sende nettleservarsel for ferdig quiz",
        );
      });
    }
  } catch (error) {
    logger.error({ err: error, jobId, userId, courseId }, "Quiz-jobb feilet");
    await setJobState(jobId, userId, {
      status: "failed",
      error: "Kunne ikke generere quiz. Prøv igjen.",
    }).catch((err) => {
      logger.warn({ err, jobId, userId }, "Kunne ikke skrive failed-status til cache (quiz)");
    });
  }
}

// POST /api/quiz/generate — returnerer jobId umiddelbart (202 Accepted)
// rateLimitKi er allerede anvendt på router-nivå (router.use(rateLimitKi) over);
// route-level her ville dobbelttelle.
router.post("/generate", knyttCanvasToken, async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = QuizGenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "quiz generate");
    }

    if (!isClientAvailable(DEFAULT_MODEL)) {
      return apiError.serviceUnavailable(res, "KI-tjenesten");
    }

    if (!req.canvasToken) {
      return apiError.unauthorized(res, "Canvas-token mangler");
    }

    const { courseId, courseName, moduleNames, fileNames, questionCount } = parsed.data;
    const jobId = randomUUID();

    // Sett initial status i Redis (innpakket med eier-ID for status-autorisasjon)
    await setJobState(jobId, userId, { status: "pending" });

    // Start bakgrunnsjobben — ikke await
    void processQuizJob(
      jobId,
      userId,
      req.canvasToken,
      req.canvasBaseUrl,
      courseId,
      courseName,
      moduleNames ?? [],
      fileNames ?? [],
      questionCount,
    );

    return res.status(202).json(AsyncJobAcceptedSchema.parse({ jobId }));
  } catch (error) {
    if (res.headersSent) return;
    return sendUnknownError(res, error, {
      kontekst: "POST quiz generate",
      melding: "Kunne ikke starte quiz-generering. Prøv igjen.",
    });
  }
});

// GET /api/quiz/status/:jobId — sjekker jobb-status (kun for eier)
router.get("/status/:jobId", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const { jobId } = req.params;

    if (!jobId || !z.uuid().safeParse(jobId).success) {
      return apiError.badRequest(res, "Ugyldig jobb-ID");
    }

    const cached = await getCache(`${JOB_KEY_PREFIX}${jobId}`);
    if (!cached) {
      return apiError.notFound(res, "Jobben finnes ikke eller har utløpt");
    }

    const wrapper = JobWrapperSchema.safeParse(JSON.parse(cached));
    if (!wrapper.success) {
      return apiError.serverError(res);
    }
    if (wrapper.data.ownerUserId !== userId) {
      // Skjul eksistens av andres jobber bak en 404 for å unngå enumeration.
      return apiError.notFound(res, "Jobben finnes ikke eller har utløpt");
    }
    return res.json(wrapper.data.state);
  } catch (error) {
    if (res.headersSent) return;
    return sendUnknownError(res, error, {
      kontekst: "GET quiz status",
      melding: "Kunne ikke sjekke jobb-status.",
    });
  }
});

export default router;
