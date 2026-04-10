/*
 * BullMQ-kø for retry av Pinecone vektor-sletting (GDPR).
 *
 * Erstatter den tidligere MongoDB-pollingen i `vectorDeletionRetry.service.ts`.
 * Semantikk:
 *   - Maks 20 forsøk
 *   - Eksponentiell backoff: 1 min → 2 → 4 → … kappet ved 1 time
 *   - Job-ID = userId for naturlig dedup
 *   - Failed jobs beholdes for inspeksjon (GDPR krever manuell oppfølging)
 */

import { Queue, Worker, type Job } from "bullmq";
import { getSharedQueueConnection, createWorkerConnection } from "./connection.js";
import { deleteStoredUserVectors } from "../services/embedding.service.js";
import { deleteAllKBContentForUser } from "../services/kunnskapsbase-indeksering.service.js";
import { logger } from "../utils/logger.js";
import {
  audit,
  AUDIT_ACTIONS,
  getDeletedAuditActorId,
} from "../utils/auditLog.js";

export const PINECONE_CLEANUP_QUEUE_NAME = "pinecone-cleanup";
const MAX_ATTEMPTS = 20;

export interface PineconeCleanupJobData {
  userId: string;
  lastError?: string;
  kbBaseIds?: string[];
}

let queue: Queue<PineconeCleanupJobData> | null = null;
let worker: Worker<PineconeCleanupJobData> | null = null;

export function getPineconeCleanupQueue(): Queue<PineconeCleanupJobData> {
  if (queue) return queue;
  queue = new Queue<PineconeCleanupJobData>(PINECONE_CLEANUP_QUEUE_NAME, {
    connection: getSharedQueueConnection(),
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: false,
    },
  });
  return queue;
}

export async function enqueueVectorDeletionRetry(input: {
  userId: string;
  lastError?: string;
  kbBaseIds?: string[];
}): Promise<void> {
  const q = getPineconeCleanupQueue();
  const normalizedKbBaseIds = Array.from(
    new Set(
      (input.kbBaseIds ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const existingJob = await q.getJob(input.userId);
  if (existingJob) {
    await existingJob.updateData({
      userId: input.userId,
      lastError: input.lastError ?? existingJob.data.lastError,
      kbBaseIds: Array.from(
        new Set([...(existingJob.data.kbBaseIds ?? []), ...normalizedKbBaseIds]),
      ),
    });
    return;
  }

  await q.add(
    "delete",
    {
      userId: input.userId,
      lastError: input.lastError,
      kbBaseIds: normalizedKbBaseIds,
    },
    { jobId: input.userId },
  );
}

async function processJob(job: Job<PineconeCleanupJobData>): Promise<void> {
  const { userId, kbBaseIds } = job.data;
  const attempt = job.attemptsMade + 1;

  await deleteStoredUserVectors(userId);
  await deleteAllKBContentForUser(userId, kbBaseIds);

  logger.info({ userId, attempt }, "Retry-slettet Pinecone-vektorer");
  await audit({
    actorUserId: getDeletedAuditActorId(userId),
    action: AUDIT_ACTIONS.ACCOUNT_DELETED,
    category: "privacy",
    outcome: "success",
    metadata: { phase: "vector_retry", attempts: attempt },
  });
}

export function startPineconeCleanupWorker(): Worker<PineconeCleanupJobData> {
  if (worker) return worker;

  worker = new Worker<PineconeCleanupJobData>(
    PINECONE_CLEANUP_QUEUE_NAME,
    processJob,
    {
      connection: createWorkerConnection(PINECONE_CLEANUP_QUEUE_NAME),
      concurrency: 2,
    },
  );

  worker.on("failed", async (job, err) => {
    if (!job) return;
    logger.warn(
      {
        err,
        userId: job.data.userId,
        attemptsMade: job.attemptsMade,
        maxAttempts: MAX_ATTEMPTS,
      },
      "Pinecone vektor-sletting feilet",
    );

    if (job.attemptsMade >= MAX_ATTEMPTS) {
      logger.error(
        { userId: job.data.userId },
        "Pinecone vektor-sletting ga opp etter maks forsøk — krever manuell oppfølging (GDPR)",
      );
      await audit({
        actorUserId: getDeletedAuditActorId(job.data.userId),
        action: AUDIT_ACTIONS.ACCOUNT_DELETED,
        category: "privacy",
        outcome: "failure",
        metadata: {
          phase: "vector_retry_exhausted",
          attempts: job.attemptsMade,
          lastError: `Vektor-sletting feilet etter ${job.attemptsMade} forsøk`,
        },
      });
    }
  });

  worker.on("error", (err) => {
    logger.error({ err }, "Pinecone-cleanup worker feilet");
  });

  logger.info("Pinecone-cleanup worker startet");
  return worker;
}

export async function closePineconeCleanupWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
