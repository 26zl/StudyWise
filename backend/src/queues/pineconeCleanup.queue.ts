/*
 * Pinecone vektor-sletting (GDPR): job-type for den unified BullMQ-køen.
 *
 * Semantikk:
 *   - Maks 20 forsøk
 *   - Eksponentiell backoff: 1 min → 2 → 4 → … kappet ved 1 time
 *   - Job-ID = `pinecone_${userId}` for naturlig dedup
 *   - Failed jobs beholdes for inspeksjon (GDPR krever manuell oppfølging)
 */

import type { Job } from "bullmq";
import { getUnifiedQueue } from "./connection.js";
import { deleteStoredUserVectors } from "../services/embedding.service.js";
import { deleteAllKBContentForUser } from "../services/kunnskapsbase-indeksering.service.js";
import { logger } from "../utils/logger.js";
import { audit, AUDIT_ACTIONS, getDeletedAuditActorId } from "../utils/auditLog.js";

export const PINECONE_CLEANUP_JOB_NAME = "pinecone-cleanup";
const MAX_ATTEMPTS = 20;

export interface PineconeCleanupJobData {
  userId: string;
  lastError?: string;
  kbBaseIds?: string[];
}

const JOB_OPTIONS = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: 60_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: false,
};

export async function enqueueVectorDeletionRetry(input: {
  userId: string;
  lastError?: string;
  kbBaseIds?: string[];
}): Promise<void> {
  const q = getUnifiedQueue();
  const normalizedKbBaseIds = Array.from(
    new Set(
      (input.kbBaseIds ?? []).map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
  const jobId = `pinecone_${input.userId}`;
  const existingJob = await q.getJob(jobId);
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
    PINECONE_CLEANUP_JOB_NAME,
    {
      userId: input.userId,
      lastError: input.lastError,
      kbBaseIds: normalizedKbBaseIds,
    },
    { ...JOB_OPTIONS, jobId },
  );
}

export async function processPineconeCleanupJob(job: Job<PineconeCleanupJobData>): Promise<void> {
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

export function handlePineconeCleanupFailure(
  job: Job<PineconeCleanupJobData> | undefined,
  err: Error,
): void {
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
    void audit({
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
}
