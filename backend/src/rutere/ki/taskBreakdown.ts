/**
 * Task-breakdown API (GET/POST/PUT/DELETE).
 * Subtasks lagres som plaintext (ikke kryptert).
 */
import { randomUUID } from "crypto";
import { Router } from "express";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import {
  apiError,
  sendZodError,
  sendUnknownError,
  requireUserId,
} from "../../utils/apiError.js";
import {
  TaskBreakdown,
  type TaskBreakdownHydratedDocument,
} from "../../database/models/TaskBreakdown.js";
import { rateLimitKi } from "../../middleware/rate-limit.js";
import {
  SubTaskSchema,
  TaskBreakdownGenerateRequestSchema,
  TaskBreakdownResponseSchema,
  type SubTask,
} from "common/ki";
import { DEFAULT_MODEL } from "./aiModels.js";
import { chatCompletion, isClientAvailable } from "./aiClient.js";
import { handleAIJsonRouteError } from "./handleAIError.js";

const router = Router();
router.use(rateLimitKi);

/** Dedikert systemprompt for task breakdown — mye mindre enn full StudyWise-prompt. */
const TASK_BREAKDOWN_SYSTEM_PROMPT = `Du er en ekspert studieveileder som bryter ned oppgaver i konkrete deloppgaver for studenter.
Svar ALLTID med KUN et JSON-array uten ekstra tekst, markdown eller forklaring.
Hvert objekt i arrayet skal ha: "title" (kort), "description" (1-3 setninger), "estimatedTime" (f.eks. "2t", "1.5t"), "priority" ("high"/"medium"/"low").
Lag 4-6 deloppgaver i logisk rekkefølge tilpasset studentnivå.`;

const GeneratedSubTaskDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  estimatedTime: z.string().min(1).max(50),
  priority: z.enum(["low", "medium", "high"]),
});

function extractJsonArray(text: string): string {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("AI_RESPONSE_NOT_JSON_ARRAY");
  }
  return cleaned.slice(start, end + 1);
}

function parseGeneratedSubtasks(responseText: string): SubTask[] {
  const parsed = z.array(GeneratedSubTaskDraftSchema).min(1).max(8).parse(
    JSON.parse(extractJsonArray(responseText)),
  );

  return SubTaskSchema.array().parse(
    parsed.map((task) => ({
      id: randomUUID(),
      title: task.title.trim(),
      description: task.description.trim(),
      estimatedTime: task.estimatedTime.trim(),
      priority: task.priority,
      completed: false,
      approved: false,
    })),
  );
}

function readSubtasks(breakdown: TaskBreakdownHydratedDocument): SubTask[] {
  if (!Array.isArray(breakdown.subtasks)) return [];
  return SubTaskSchema.array().parse(breakdown.subtasks);
}

/** Validerer at assignmentId er en ikke-tom streng med maks 50 tegn (Canvas assignment ID). */
function isValidAssignmentId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0 && id.length <= 50;
}

// POST /api/ki/task-breakdown/:assignmentId/generate
router.post("/:assignmentId/generate", async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const { assignmentId } = req.params;
    if (!isValidAssignmentId(assignmentId)) {
      return apiError.badRequest(res, "Ugyldig oppgave-ID");
    }

    const parsed = TaskBreakdownGenerateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "task-breakdown generate");
    }

    if (!isClientAvailable(DEFAULT_MODEL)) {
      return apiError.serviceUnavailable(res, "KI-tjenesten");
    }

    const { assignmentTitle, assignmentDescription, dueDate } = parsed.data;
    const dueDateText = dueDate
      ? dueDate.toLocaleDateString("nb-NO", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "Ikke spesifisert";

    const userPrompt = `Bryt ned denne oppgaven:

Tittel: ${assignmentTitle}
Beskrivelse: ${assignmentDescription || "Ingen beskrivelse"}
Frist: ${dueDateText}`;

    const result = await chatCompletion({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: TASK_BREAKDOWN_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.3,
      signal: req.timeoutSignal,
    });

    const subtasks = parseGeneratedSubtasks(result.text);

    logger.info(
      { userId, assignmentId, subtaskCount: subtasks.length },
      "Genererte task breakdown via backend",
    );

    void audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.KI_TASK_BREAKDOWN,
      category: "ki",
      outcome: "success",
      metadata: { assignmentId, subtaskCount: subtasks.length },
      req,
    }).catch((err) => {
      logger.warn({ err, userId, assignmentId }, "Audit-feil for task-breakdown");
    });

    return res.json(TaskBreakdownResponseSchema.parse({ subtasks }));
  } catch (error) {
    if (res.headersSent || res.writableEnded || req.timeoutSignal?.aborted) return;

    if (
      handleAIJsonRouteError(res, error, {
        kontekst: "task-breakdown",
        timeoutMessage: "Genereringen tok for lang tid. Prøv igjen.",
        invalidResponseMessage: "KI-responsen kunne ikke tolkes som deloppgaver",
        invalidResponseTest: (candidate) =>
          candidate instanceof Error && candidate.message === "AI_RESPONSE_NOT_JSON_ARRAY",
      })
    ) {
      return;
    }

    return sendUnknownError(res, error, {
      kontekst: "POST task-breakdown generate",
      melding: "Kunne ikke generere deloppgaver. Prøv igjen.",
    });
  }
});

// GET /api/ki/task-breakdown/:assignmentId
router.get("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    if (!isValidAssignmentId(assignmentId)) {
      return apiError.badRequest(res, "Ugyldig oppgave-ID");
    }
    const userId = requireUserId(req, res);
    if (!userId) return;

    const breakdown = await TaskBreakdown.findOne({ userId, assignmentId });

    if (!breakdown) {
      const empty = TaskBreakdownResponseSchema.parse({ subtasks: [] });
      return res.json(empty);
    }

    const subtasks = readSubtasks(breakdown);
    const payload = TaskBreakdownResponseSchema.parse({
      subtasks,
    });
    return res.json(payload);
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "GET task-breakdown", melding: "Kunne ikke laste oppgavedeling. Prøv igjen." });
  }
});

// POST /api/ki/task-breakdown/:assignmentId
router.post("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    if (!isValidAssignmentId(assignmentId)) {
      return apiError.badRequest(res, "Ugyldig oppgave-ID");
    }
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = SubTaskSchema.array().safeParse(req.body.subtasks);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "subtasks");
    }

    await TaskBreakdown.findOneAndUpdate(
      { userId, assignmentId },
      {
        userId,
        assignmentId,
        subtasks: parsed.data,
        updatedAt: new Date(),
      },
      { upsert: true, returnDocument: "after" },
    );

    logger.info({ userId, assignmentId }, "Saved task breakdown");
    const payload = TaskBreakdownResponseSchema.parse({
      subtasks: parsed.data,
    });
    return res.json(payload);
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "POST task-breakdown", melding: "Kunne ikke lagre oppgavedeling. Prøv igjen." });
  }
});

// PUT /api/ki/task-breakdown/:assignmentId/toggle/:taskId
router.put("/:assignmentId/toggle/:taskId", async (req, res) => {
  try {
    const { assignmentId, taskId } = req.params;
    if (!isValidAssignmentId(assignmentId) || !taskId?.trim()) {
      return apiError.badRequest(res, "Ugyldig oppgave-ID eller deloppgave-ID");
    }
    const userId = requireUserId(req, res);
    if (!userId) return;

    const breakdown = await TaskBreakdown.findOne({ userId, assignmentId });
    if (!breakdown) {
      return apiError.notFound(res, "Task breakdown");
    }

    const subtasks = readSubtasks(breakdown);
    const task = subtasks.find((t) => t.id === taskId);
    if (!task) {
      return apiError.notFound(res, "Subtask");
    }

    task.completed = !task.completed;
    breakdown.subtasks = subtasks;
    breakdown.updatedAt = new Date();
    await breakdown.save();

    const payload = TaskBreakdownResponseSchema.parse({
      subtasks,
    });
    return res.json(payload);
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "PUT task-breakdown toggle", melding: "Kunne ikke oppdatere deloppgave. Prøv igjen." });
  }
});

// DELETE /api/ki/task-breakdown/:assignmentId
router.delete("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;
    if (!isValidAssignmentId(assignmentId)) {
      return apiError.badRequest(res, "Ugyldig oppgave-ID");
    }
    const userId = requireUserId(req, res);
    if (!userId) return;

    await TaskBreakdown.deleteOne({ userId, assignmentId });

    logger.info({ userId, assignmentId }, "Deleted task breakdown");
    const payload = TaskBreakdownResponseSchema.parse({ subtasks: [] });
    return res.json(payload);
  } catch (error) {
    return sendUnknownError(res, error, { kontekst: "DELETE task-breakdown", melding: "Kunne ikke slette oppgavedeling. Prøv igjen." });
  }
});

export default router;
