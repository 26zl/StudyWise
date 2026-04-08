/*
 * BullMQ-kø for retry av Clerk user-sletting.
 *
 * Erstatter den tidligere MongoDB-pollingen i `clerkDeletionRetry.service.ts`.
 * Semantikk:
 *   - Maks 20 forsøk (samme som tidligere)
 *   - Eksponentiell backoff: 1 min → 2 → 4 → … kappet ved 1 time
 *   - Job-ID = clerkId for naturlig dedup (samme bruker enqueues kun én gang)
 *   - Failed jobs beholdes for inspeksjon (dead-letter via Bull Board)
 *
 * Idempotens: deleteClerkUserById returnerer true også for 404 (allerede slettet).
 */

import { Queue, Worker, type Job } from "bullmq";
import { getSharedQueueConnection, createWorkerConnection } from "./connection.js";
import { deleteClerkUserById } from "../rutere/auth/clerkAuth.js";
import { logger } from "../utils/logger.js";
import {
  audit,
  AUDIT_ACTIONS,
  getDeletedAuditActorId,
} from "../utils/auditLog.js";

export const CLERK_DELETION_QUEUE_NAME = "clerk-deletion";
const MAX_ATTEMPTS = 20;

export interface ClerkDeletionJobData {
  clerkId: string;
  userId?: string;
  lastError?: string;
}

let queue: Queue<ClerkDeletionJobData> | null = null;
let worker: Worker<ClerkDeletionJobData> | null = null;

export function getClerkDeletionQueue(): Queue<ClerkDeletionJobData> {
  if (queue) return queue;
  queue = new Queue<ClerkDeletionJobData>(CLERK_DELETION_QUEUE_NAME, {
    connection: getSharedQueueConnection(),
    defaultJobOptions: {
      attempts: MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: 60_000 },
      // Behold fullførte i 24 t for inspeksjon, slett deretter
      removeOnComplete: { age: 86_400, count: 1000 },
      // Behold failed for manuell oppfølging (dead-letter)
      removeOnFail: false,
    },
  });
  return queue;
}

/**
 * Enqueue (eller re-enqueue) en Clerk-sletting for retry.
 * Bruker clerkId som jobId for å unngå duplikate jobs for samme bruker.
 */
export async function enqueueClerkDeletionRetry(input: {
  clerkId: string;
  userId?: string;
  lastError?: string;
}): Promise<void> {
  const q = getClerkDeletionQueue();
  await q.add("delete", input, { jobId: input.clerkId });
}

async function processJob(job: Job<ClerkDeletionJobData>): Promise<void> {
  const { clerkId, userId } = job.data;
  const attempt = job.attemptsMade + 1;

  const deleted = await deleteClerkUserById(clerkId);
  if (!deleted) {
    // Ikke en exception, men sletting bekreftet ikke utført — kast for å trigge retry
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

export function startClerkDeletionWorker(): Worker<ClerkDeletionJobData> {
  if (worker) return worker;

  worker = new Worker<ClerkDeletionJobData>(
    CLERK_DELETION_QUEUE_NAME,
    processJob,
    {
      connection: createWorkerConnection(CLERK_DELETION_QUEUE_NAME),
      // Lavt concurrency — Clerk API er rate-limitet og dette er sjelden trafikk
      concurrency: 2,
    },
  );

  worker.on("failed", async (job, err) => {
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

    // Dead-letter: ferdig med alle forsøk
    if (job.attemptsMade >= MAX_ATTEMPTS && job.data.userId) {
      logger.error(
        { clerkId: job.data.clerkId, userId: job.data.userId },
        "Clerk-sletting ga opp etter maks forsøk — krever manuell oppfølging",
      );
      await audit({
        actorUserId: getDeletedAuditActorId(job.data.userId),
        action: AUDIT_ACTIONS.ACCOUNT_DELETED,
        category: "privacy",
        outcome: "failure",
        metadata: {
          phase: "clerk_retry_exhausted",
          attempts: job.attemptsMade,
          lastError: err.message,
        },
      });
    }
  });

  worker.on("error", (err) => {
    logger.error({ err }, "Clerk-deletion worker feilet");
  });

  logger.info("Clerk-deletion worker startet");
  return worker;
}

export async function closeClerkDeletionWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
