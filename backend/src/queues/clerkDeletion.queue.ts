/*
 * Clerk-sletting: job-type for den unified BullMQ-køen.
 *
 * Semantikk:
 *   - Maks 20 forsøk
 *   - Eksponentiell backoff: 1 min → 2 → 4 → … kappet ved 1 time
 *   - Job-ID = `clerk_${clerkId}` for naturlig dedup
 *   - Failed jobs beholdes for inspeksjon (dead-letter via admin-panel)
 */

import type { Job } from "bullmq";
import { getUnifiedQueue } from "./connection.js";
import { deleteClerkUserById } from "../rutere/auth/clerkAuth.js";
import { logger } from "../utils/logger.js";
import { audit, AUDIT_ACTIONS, getDeletedAuditActorId } from "../utils/auditLog.js";

export const CLERK_DELETION_JOB_NAME = "clerk-deletion";
const MAX_ATTEMPTS = 20;

export interface ClerkDeletionJobData {
  clerkId: string;
  userId?: string;
  lastError?: string;
}

const JOB_OPTIONS = {
  attempts: MAX_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: 60_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: false,
};

/**
 * Enqueue (eller re-enqueue) en Clerk-sletting for retry.
 * Bruker clerkId som jobId for å unngå duplikate jobs for samme bruker.
 */
export async function enqueueClerkDeletionRetry(input: {
  clerkId: string;
  userId?: string;
  lastError?: string;
}): Promise<void> {
  const q = getUnifiedQueue();
  await q.add(CLERK_DELETION_JOB_NAME, input, {
    ...JOB_OPTIONS,
    jobId: `clerk_${input.clerkId}`,
  });
}

export async function processClerkDeletionJob(job: Job<ClerkDeletionJobData>): Promise<void> {
  const { clerkId, userId } = job.data;
  const attempt = job.attemptsMade + 1;

  const deleted = await deleteClerkUserById(clerkId);
  if (!deleted) {
    throw new Error("deleteClerkUserById returnerte false");
  }

  logger.info({ clerkId, userId, attempt }, "Retry-slettet Clerk-konto");
  if (userId) {
    await audit({
      actorUserId: getDeletedAuditActorId(userId),
      action: AUDIT_ACTIONS.ACCOUNT_DELETED,
      category: "privacy",
      outcome: "success",
      metadata: { phase: "clerk_retry", attempts: attempt },
    });
  }
}

export function handleClerkDeletionFailure(
  job: Job<ClerkDeletionJobData> | undefined,
  err: Error,
): void {
  if (!job) return;
  logger.warn(
    {
      err,
      clerkId: job.data.clerkId,
      userId: job.data.userId,
      attemptsMade: job.attemptsMade,
      maxAttempts: MAX_ATTEMPTS,
    },
    "Clerk-sletting feilet",
  );

  if (job.attemptsMade >= MAX_ATTEMPTS && job.data.userId) {
    logger.error(
      { clerkId: job.data.clerkId, userId: job.data.userId },
      "Clerk-sletting ga opp etter maks forsøk — krever manuell oppfølging",
    );
    void audit({
      actorUserId: getDeletedAuditActorId(job.data.userId),
      action: AUDIT_ACTIONS.ACCOUNT_DELETED,
      category: "privacy",
      outcome: "failure",
      metadata: {
        phase: "clerk_retry_exhausted",
        attempts: job.attemptsMade,
        lastError: `Sletting feilet etter ${job.attemptsMade} forsøk`,
      },
    });
  }
}
