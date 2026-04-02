/**
 * KI ukeplan-generator.
 *
 * Genererer et strukturert forslag til ukeplan basert på oppgaver, frister og tilgjengelige tidsluker.
 * Returnerer alltid validert JSON iht. `common/ki`.
 */
import { Router } from "express";
import { z } from "zod";
import {
  WeeklyPlanGenerateRequestSchema,
  WeeklyPlanSuggestionBlockSchema,
  WeeklyPlanSuggestionDraftSchema,
  WeeklyPlanSuggestionResponseSchema,
  type WeeklyPlanAssignment,
  type WeeklyPlanSuggestionBlock,
} from "common/ki";
import { getIsoWeekInfo, parseTimerStreng } from "common/dateUtils";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import {
  apiError,
  requireUserId,
  sendUnknownError,
  sendZodError,
} from "../../utils/apiError.js";
import { logger } from "../../utils/logger.js";
import { DEFAULT_MODEL } from "./aiModels.js";
import { chatCompletion, isClientAvailable } from "./aiClient.js";
import { handleAIJsonRouteError } from "./handleAIError.js";
import { extractJsonObject } from "./studyContentUtils.js";
import {
  AI_COMPLETION_PUSH_MIN_DURATION_MS,
  sendAICompletionWebPush,
} from "../../services/webPush.service.js";

const router = Router();
router.use(rateLimitKi);

/** Dedikert systemprompt for ukeplangenerering — mye mindre enn full StudyWise-prompt. */
const WEEKLY_PLAN_SYSTEM_PROMPT = `Du er en strukturert studieveileder som lager realistiske ukeplaner for studenter.
Svar ALLTID med KUN et JSON-objekt uten ekstra tekst, markdown eller forklaring.
Fordel studieblokkene jevnt utover uken, prioriter oppgaver med nær frist, og gi konkrete studietips.`;

const STANDARD_TIDSLOTT = [
  "08:00-10:00",
  "10:00-12:00",
  "13:00-15:00",
  "15:00-17:00",
  "17:00-19:00",
  "19:00-21:00",
] as const;

const DEFAULT_TIPS = [
  "Start med de mest tidssensitive oppgavene tidlig i uken.",
  "Legg inn korte pauser mellom studieøktene for å holde konsentrasjonen oppe.",
  "Bruk de siste øktene i uken til oppsummering og finpuss før frister.",
] as const;


function formatFrist(dueAt?: Date): string {
  if (!dueAt) return "Ikke spesifisert";
  return dueAt.toLocaleDateString("nb-NO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function dagerTilFrist(dueAt?: Date): number | null {
  if (!dueAt) return null;
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((dueAt.getTime() - Date.now()) / msPerDay);
}

function beregnPrioritet(dueAt?: Date): "high" | "medium" | "low" {
  const dager = dagerTilFrist(dueAt);
  if (dager !== null && dager <= 3) return "high";
  if (dager !== null && dager <= 7) return "medium";
  return "low";
}

function normaliserTekst(verdi: string | undefined): string {
  return verdi?.trim().toLowerCase() ?? "";
}

function finnOppgaveForBlokk(
  blokk: WeeklyPlanSuggestionBlock,
  oppgaver: WeeklyPlanAssignment[],
  oppgaverPerId: Map<string, WeeklyPlanAssignment>,
): WeeklyPlanAssignment | null {
  if (blokk.assignmentId) {
    const fraId = oppgaverPerId.get(blokk.assignmentId);
    if (fraId) return fraId;
  }

  const blokkOppgave = normaliserTekst(blokk.task);
  const blokkEmne = normaliserTekst(blokk.courseName);

  return (
    oppgaver.find((oppgave) => {
      const navn = normaliserTekst(oppgave.name);
      const emne = normaliserTekst(oppgave.courseName);
      const navnMatcher =
        blokkOppgave.includes(navn) || navn.includes(blokkOppgave);
      const emneMatcher = !blokkEmne || !emne || blokkEmne === emne;
      return navnMatcher && emneMatcher;
    }) ?? null
  );
}

function normaliserBlokker(
  blokker: WeeklyPlanSuggestionBlock[],
  oppgaver: WeeklyPlanAssignment[],
): WeeklyPlanSuggestionBlock[] {
  const oppgaverPerId = new Map(oppgaver.map((oppgave) => [oppgave.id, oppgave]));
  const brukteSlots = new Set<string>();
  const normaliserte: WeeklyPlanSuggestionBlock[] = [];

  for (const blokk of blokker) {
    const oppgave = finnOppgaveForBlokk(blokk, oppgaver, oppgaverPerId);
    const slotKey = `${blokk.day}|${blokk.timeSlot}`;
    if (brukteSlots.has(slotKey)) {
      continue;
    }

    brukteSlots.add(slotKey);
    normaliserte.push(
      WeeklyPlanSuggestionBlockSchema.parse({
        ...blokk,
        assignmentId: oppgave?.id ?? blokk.assignmentId,
        courseName: oppgave?.courseName ?? blokk.courseName,
        priority: beregnPrioritet(oppgave?.dueAt),
        completed: false,
      }),
    );
  }

  if (normaliserte.length === 0) {
    throw new Error("AI_RESPONSE_EMPTY_BLOCKS");
  }

  return normaliserte;
}

function parseGeneratedWeeklyPlan(
  responseText: string,
  oppgaver: WeeklyPlanAssignment[],
): z.infer<typeof WeeklyPlanSuggestionResponseSchema> {
  const parsedDraft = WeeklyPlanSuggestionDraftSchema.parse(
    JSON.parse(extractJsonObject(responseText)),
  );

  const { weekNumber, weekYear } = getIsoWeekInfo(new Date());
  const blocks = normaliserBlokker(parsedDraft.blocks, oppgaver);
  const tips =
    parsedDraft.tips?.map((tip) => tip.trim()).filter(Boolean).slice(0, 5) ??
    [];

  const totalHours = blocks.reduce((sum, blokk) => {
    const timer = parseTimerStreng(blokk.duration);
    return sum + (timer > 0 ? timer : 1.5);
  }, 0);

  return WeeklyPlanSuggestionResponseSchema.parse({
    week: `Uke ${weekNumber}, ${weekYear}`,
    weekNumber,
    year: weekYear,
    totalHours,
    blocks,
    tips: tips.length > 0 ? tips : [...DEFAULT_TIPS],
  });
}

function buildPrompt(oppgaver: WeeklyPlanAssignment[]): string {
  const oppgaveliste = oppgaver
    .map((oppgave) => {
      const dager = dagerTilFrist(oppgave.dueAt);
      return [
        `- assignmentId: ${oppgave.id}`,
        `  navn: ${oppgave.name}`,
        `  emne: ${oppgave.courseName || "Ukjent emne"}`,
        `  frist: ${formatFrist(oppgave.dueAt)}`,
        `  dagerTilFrist: ${dager ?? "ukjent"}`,
        `  poeng: ${oppgave.pointsPossible ?? "ukjent"}`,
        `  beskrivelse: ${oppgave.description?.trim() || "Ingen beskrivelse"}`,
      ].join("\n");
    })
    .join("\n");

  return `Du er en strukturert studieveileder. Lag en realistisk ukeplan basert på disse oppgavene.

OPPGAVER:
${oppgaveliste}

KRAV:
- Bruk bare oppgavene i listen over.
- Hver studieblokk må ha feltene "day", "timeSlot", "task", "duration", "priority", "courseName", "assignmentId" og "completed".
- "assignmentId" må være eksakt en av ID-ene du fikk.
- Bruk kun disse tidslukene: ${STANDARD_TIDSLOTT.join(", ")}.
- Bruk norske dagnavn: Mandag, Tirsdag, Onsdag, Torsdag, Fredag, Lørdag, Søndag.
- Fordel belastningen jevnt utover uken.
- Ikke legg to blokker i samme dag og tidsluke.
- Prioriter oppgaver med nær frist først.
- "duration" må være realistisk og på format som "1.5 timer", "2 timer" eller "3 timer".
- "priority" må være "high", "medium" eller "low".
- "completed" skal alltid være false.
- Gi 3-5 konkrete studietips i "tips".

Svar KUN med et JSON-objekt på formatet:
{
  "blocks": [
    {
      "day": "Mandag",
      "timeSlot": "08:00-10:00",
      "task": "Oppgavenavn",
      "duration": "2 timer",
      "priority": "high",
      "courseName": "Emnenavn",
      "assignmentId": "abc123",
      "completed": false
    }
  ],
  "tips": ["Tips 1", "Tips 2", "Tips 3"]
}`;
}

router.post("/generate", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = WeeklyPlanGenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "weekly-plan generate");
    }

    if (!isClientAvailable(DEFAULT_MODEL)) {
      return apiError.serviceUnavailable(res, "KI-tjenesten");
    }

    const oppgaver = [...parsed.data.assignments].sort((a, b) => {
      const aTime = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
    const generationStartedAt = Date.now();

    const prompt = buildPrompt(oppgaver);
    const result = await chatCompletion({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: WEEKLY_PLAN_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.3,
      signal: req.timeoutSignal,
      traceName: "weekly-plan",
      traceMeta: {
        userId,
        intent: "general_chat",
        mode: "weekly_plan",
      },
    });

    const payload = parseGeneratedWeeklyPlan(result.text, oppgaver);

    logger.info(
      { userId, blockCount: payload.blocks.length, assignmentCount: oppgaver.length },
      "Genererte weekly plan via backend",
    );

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.KI_WEEKLY_PLAN,
      category: "ki",
      outcome: "success",
      metadata: { blockCount: payload.blocks.length, assignmentCount: oppgaver.length },
      req,
    }).catch((err) => {
      logger.warn({ err, userId }, "Audit-feil for weekly-plan");
    });

    const generationDurationMs = Date.now() - generationStartedAt;
    if (generationDurationMs >= AI_COMPLETION_PUSH_MIN_DURATION_MS) {
      void sendAICompletionWebPush({
        userId,
        title: "StudyWise: Ukeplanen er klar",
        body: "KI har generert en ukeplan for deg i oversikten.",
        url: "/oversikt",
        tag: `studywise-ai-weekly-plan-${userId}`,
      }).catch((err) => {
        logger.warn(
          { err, userId },
          "Kunne ikke sende nettleservarsel for ferdig ukeplan",
        );
      });
    }

    return res.json(payload);
  } catch (error) {
    if (res.headersSent || res.writableEnded || req.timeoutSignal?.aborted) return;

    if (
      handleAIJsonRouteError(res, error, {
        kontekst: "weekly-plan",
        timeoutMessage: "Genereringen tok for lang tid. Prøv igjen.",
        invalidResponseMessage: "KI-responsen kunne ikke tolkes som en ukeplan",
        invalidResponseTest: (candidate) =>
          candidate instanceof Error &&
          (candidate.message === "AI_RESPONSE_NOT_JSON_OBJECT" ||
            candidate.message === "AI_RESPONSE_EMPTY_BLOCKS"),
      })
    ) {
      return;
    }

    return sendUnknownError(res, error, {
      kontekst: "POST weekly-plan generate",
      melding: "Kunne ikke generere ukeplan. Prøv igjen.",
    });
  }
});

export default router;
