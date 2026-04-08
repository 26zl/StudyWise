/**
 * Admin BullMQ-køer.
 * Monteres under /api/admin (allerede beskyttet med requireAuth + requireRole("admin")).
 *
 * Endepunkter:
 *   GET    /queues/overview                    – Liste over alle køer med counts
 *   GET    /queues/:name/jobs?status=...&limit – Jobs for én kø, filtrert på status
 *   POST   /queues/:name/jobs/:id/retry        – Retry en failed job
 *   DELETE /queues/:name/jobs/:id              – Fjern en job
 */
import { Router } from "express";
import {
  AdminQueueJobsQuerySchema,
  AdminQueueJobsResponseSchema,
  AdminQueueOverviewResponseSchema,
  type AdminQueueJob,
  type QueueJobStatus,
} from "common/admin";
import type { Job, JobType } from "bullmq";
import { requireRecentAuth } from "../../middleware/auth.js";
import { getAllQueues, getQueueByName } from "../../queues/index.js";
import { apiError, sendUnknownError, sendZodError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";

const router = Router();

const MAX_JOBS_LIMIT = 100;
const DEFAULT_JOBS_LIMIT = 25;

/**
 * Sanitiserer job-data for å unngå å lekke sensitive felt til frontend.
 * Vi tar med kun de feltene vi vet er trygge per kø-type.
 */
function sanitizeJobData(
  queueName: string,
  raw: unknown,
): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  if (queueName === "clerk-deletion") {
    return {
      clerkId: obj.clerkId,
      userId: obj.userId,
      lastError: obj.lastError,
    };
  }
  if (queueName === "pinecone-cleanup") {
    return {
      userId: obj.userId,
      lastError: obj.lastError,
      kbBaseIdsCount: Array.isArray(obj.kbBaseIds) ? obj.kbBaseIds.length : 0,
    };
  }
  return {};
}

async function jobToDto(
  job: Job,
  queueName: string,
  fallbackStatus: QueueJobStatus,
): Promise<AdminQueueJob> {
  // BullMQ getState() er asynkron og kan i sjeldne tilfeller feile — fall tilbake
  let status: QueueJobStatus = fallbackStatus;
  try {
    const s = (await job.getState()) as QueueJobStatus | "unknown";
    if (s !== "unknown") status = s;
  } catch {
    // Behold fallback
  }
  return {
    id: String(job.id ?? ""),
    name: job.name,
    status,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? 0,
    data: sanitizeJobData(queueName, job.data),
    timestamp: job.timestamp,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
    delay: job.opts.delay,
  };
}

router.get("/queues/overview", async (_req, res) => {
  try {
    const queues = getAllQueues();
    const overview = await Promise.all(
      queues.map(async (q) => {
        const counts = await q.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "completed",
          "failed",
          "paused",
        );
        const isPaused = await q.isPaused();
        return {
          name: q.name,
          counts: {
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            delayed: counts.delayed ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            paused: counts.paused ?? 0,
          },
          isPaused,
        };
      }),
    );

    const payload = AdminQueueOverviewResponseSchema.parse({ queues: overview });
    return res.json(payload);
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.queues.overview" });
  }
});

router.get("/queues/:name/jobs", async (req, res) => {
  const queueName = String(req.params.name);
  const queue = getQueueByName(queueName);
  if (!queue) return apiError.notFound(res, "Ukjent kø");

  const parsed = AdminQueueJobsQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendZodError(res, parsed.error, "queue jobs query");

  const status = parsed.data.status ?? "failed";
  const limit = Math.min(
    MAX_JOBS_LIMIT,
    Number(parsed.data.limit ?? DEFAULT_JOBS_LIMIT),
  );

  try {
    const jobs = await queue.getJobs([status as JobType], 0, limit - 1, false);
    const dtos = await Promise.all(
      jobs.map((j) => jobToDto(j, queue.name, status)),
    );
    const counts = await queue.getJobCountByTypes(status);
    const payload = AdminQueueJobsResponseSchema.parse({
      jobs: dtos,
      total: counts ?? dtos.length,
    });
    return res.json(payload);
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.queues.jobs" });
  }
});

router.post("/queues/:name/jobs/:id/retry", requireRecentAuth, async (req, res) => {
  const queueName = String(req.params.name);
  const jobId = String(req.params.id);
  const queue = getQueueByName(queueName);
  if (!queue) return apiError.notFound(res, "Ukjent kø");

  try {
    const job = await queue.getJob(jobId);
    if (!job) return apiError.notFound(res, "Job ikke funnet");

    await job.retry();

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        subAction: "queue.retry",
        queue: queue.name,
        jobId,
      },
      req,
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error(
      { err, queue: queue.name, jobId },
      "Admin queue retry feilet",
    );
    return sendUnknownError(res, err, { kontekst: "admin.queues.retry" });
  }
});

router.delete("/queues/:name/jobs/:id", requireRecentAuth, async (req, res) => {
  const queueName = String(req.params.name);
  const jobId = String(req.params.id);
  const queue = getQueueByName(queueName);
  if (!queue) return apiError.notFound(res, "Ukjent kø");

  try {
    const job = await queue.getJob(jobId);
    if (!job) return apiError.notFound(res, "Job ikke funnet");

    await job.remove();

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        subAction: "queue.remove",
        queue: queue.name,
        jobId,
      },
      req,
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error(
      { err, queue: queue.name, jobId },
      "Admin queue remove feilet",
    );
    return sendUnknownError(res, err, { kontekst: "admin.queues.remove" });
  }
});

export default router;
