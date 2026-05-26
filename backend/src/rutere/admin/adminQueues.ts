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
  AdminQueueStateResponseSchema,
  type AdminQueueJob,
  type QueueJobStatus,
} from "common/admin";
import type { Job, JobType } from "bullmq";
import { requireRecentAuth } from "../../middleware/auth.js";
import { getAllQueues, getQueueByName } from "../../queues/index.js";
import { apiError, requireUserId, sendUnknownError, sendZodError } from "../../utils/apiError.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import { logger } from "../../utils/logger.js";

const router = Router();

const MAX_JOBS_LIMIT = 100;
const DEFAULT_JOBS_LIMIT = 25;

/**
 * Sanitiserer job-data for å unngå å lekke sensitive felt til frontend.
 * Vi tar med kun de feltene vi vet er trygge per kø-type.
 */
function sanitizeJobData(jobName: string, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  if (jobName === "clerk-deletion") {
    return {
      clerkId: obj.clerkId,
      userId: obj.userId,
      lastError: obj.lastError,
    };
  }
  if (jobName === "pinecone-cleanup") {
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
    stacktrace:
      Array.isArray(job.stacktrace) && job.stacktrace.length > 0
        ? job.stacktrace.slice(-5)
        : undefined,
  };
}

/**
 * Tell dead-letter jobs: failed jobs som har brukt opp alle retry-forsøk.
 * Henter maks 100 failed jobs og filtrerer på attemptsMade >= maxAttempts.
 */
async function countDeadLetterJobs(q: ReturnType<typeof getQueueByName>): Promise<number> {
  if (!q) return 0;
  try {
    const failedJobs = await q.getJobs(["failed"], 0, 99, false);
    return failedJobs.filter((j) => j.attemptsMade >= (j.opts.attempts ?? 1)).length;
  } catch {
    return 0;
  }
}

/**
 * Teller jobs per job-type (name) innenfor den unified køen.
 * Henter maks 500 jobs per status og grupperer etter job.name.
 */
async function countJobsByType(q: ReturnType<typeof getAllQueues>[number]) {
  const statuses = ["waiting", "active", "delayed", "completed", "failed"] as const;
  const typeCounts = new Map<string, Record<string, number>>();

  for (const status of statuses) {
    try {
      const jobs = await q.getJobs([status], 0, 499, false);
      for (const job of jobs) {
        if (!typeCounts.has(job.name)) {
          typeCounts.set(job.name, { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 });
        }
        typeCounts.get(job.name)![status]++;
      }
    } catch {
      // Ignorer feil for enkelt-status
    }
  }

  return Array.from(typeCounts.entries()).map(([name, counts]) => ({
    name,
    ...counts,
  }));
}

router.get("/queues/overview", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  try {
    const queues = getAllQueues();
    const overview = await Promise.all(
      queues.map(async (q) => {
        const [counts, isPaused, deadLetterCount, jobTypeCounts] = await Promise.all([
          q.getJobCounts("waiting", "active", "delayed", "completed", "failed", "paused"),
          q.isPaused(),
          countDeadLetterJobs(q),
          countJobsByType(q),
        ]);
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
          deadLetterCount,
          jobTypeCounts,
        };
      }),
    );

    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "queues.overview" },
      req,
    });

    const payload = AdminQueueOverviewResponseSchema.parse({ queues: overview });
    return res.json(payload);
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.queues.overview" });
  }
});

router.get("/queues/:name/jobs", async (req, res) => {
  const actorUserId = requireUserId(req, res);
  if (!actorUserId) return;

  const queueName = String(req.params.name);
  const queue = getQueueByName(queueName);
  if (!queue) return apiError.notFound(res, "Ukjent kø");

  const parsed = AdminQueueJobsQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendZodError(res, parsed.error, "queue jobs query");

  const status = parsed.data.status ?? "failed";
  const limit = Math.min(MAX_JOBS_LIMIT, Number(parsed.data.limit ?? DEFAULT_JOBS_LIMIT));

  try {
    const jobs = await queue.getJobs([status as JobType], 0, limit - 1, false);
    const dtos = await Promise.all(jobs.map((j) => jobToDto(j, j.name, status)));
    const counts = await queue.getJobCountByTypes(status);
    void audit({
      actorUserId,
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: { subAction: "queues.jobs", queue: queueName, status, resultCount: dtos.length },
      req,
    });

    const payload = AdminQueueJobsResponseSchema.parse({
      jobs: dtos,
      total: counts ?? dtos.length,
    });
    return res.json(payload);
  } catch (err) {
    return sendUnknownError(res, err, { kontekst: "admin.queues.jobs" });
  }
});

router.post("/queues/:name/pause", requireRecentAuth, async (req, res) => {
  const queueName = String(req.params.name);
  const queue = getQueueByName(queueName);
  if (!queue) return apiError.notFound(res, "Ukjent kø");

  try {
    await queue.pause();

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        subAction: "queue.pause",
        queue: queue.name,
      },
      req,
    });

    return res.json(AdminQueueStateResponseSchema.parse({ success: true, isPaused: true }));
  } catch (err) {
    logger.error({ err, queue: queue.name }, "Admin queue pause feilet");
    return sendUnknownError(res, err, { kontekst: "admin.queues.pause" });
  }
});

router.post("/queues/:name/resume", requireRecentAuth, async (req, res) => {
  const queueName = String(req.params.name);
  const queue = getQueueByName(queueName);
  if (!queue) return apiError.notFound(res, "Ukjent kø");

  try {
    await queue.resume();

    void audit({
      actorUserId: req.user?.id ?? "unknown",
      action: AUDIT_ACTIONS.ADMIN_ACTION,
      category: "admin",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        subAction: "queue.resume",
        queue: queue.name,
      },
      req,
    });

    return res.json(AdminQueueStateResponseSchema.parse({ success: true, isPaused: false }));
  } catch (err) {
    logger.error({ err, queue: queue.name }, "Admin queue resume feilet");
    return sendUnknownError(res, err, { kontekst: "admin.queues.resume" });
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
    logger.error({ err, queue: queue.name, jobId }, "Admin queue retry feilet");
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
    logger.error({ err, queue: queue.name, jobId }, "Admin queue remove feilet");
    return sendUnknownError(res, err, { kontekst: "admin.queues.remove" });
  }
});

export default router;
