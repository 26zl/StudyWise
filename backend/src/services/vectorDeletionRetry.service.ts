import { PendingVectorDeletionModel } from "../database/models/PendingVectorDeletion.js";
import { deleteStoredUserVectors } from "./embedding.service.js";
import { logger } from "../utils/logger.js";
import { audit, AUDIT_ACTIONS, getDeletedAuditActorId } from "../utils/auditLog.js";

export const VECTOR_DELETION_RETRY_INTERVAL_MS = 10 * 60 * 1000;
const VECTOR_DELETION_BATCH_SIZE = 20;
const MAX_VECTOR_DELETION_ATTEMPTS = 20;

function calculateNextRetryAt(attempts: number): Date {
  const delayMs = Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, attempts));
  return new Date(Date.now() + delayMs);
}

export async function enqueueVectorDeletionRetry(input: {
  userId: string;
  lastError?: string;
}): Promise<void> {
  await PendingVectorDeletionModel.findOneAndUpdate(
    { userId: input.userId },
    {
      $set: {
        lastError: input.lastError,
        nextRetryAt: new Date(),
      },
      $setOnInsert: {
        attempts: 0,
      },
    },
    {
      upsert: true,
      returnDocument: "after",
    },
  );
}

export async function processPendingVectorDeletions(): Promise<void> {
  const now = new Date();
  const pending = await PendingVectorDeletionModel.find({
    nextRetryAt: { $lte: now },
  })
    .sort({ nextRetryAt: 1 })
    .limit(VECTOR_DELETION_BATCH_SIZE);

  for (const item of pending) {
    const attempts = item.attempts ?? 0;

    // Dead-letter: merk som feilet permanent etter maks forsøk
    if (attempts >= MAX_VECTOR_DELETION_ATTEMPTS) {
      logger.error(
        { userId: item.userId, attempts },
        "Pinecone vektor-sletting ga opp etter maks forsøk — krever manuell oppfølging (GDPR)",
      );
      await audit({
        actorUserId: getDeletedAuditActorId(item.userId),
        action: AUDIT_ACTIONS.ACCOUNT_DELETED,
        category: "privacy",
        outcome: "failure",
        metadata: {
          phase: "vector_retry_exhausted",
          attempts,
          lastError: item.lastError,
        },
      });
      await PendingVectorDeletionModel.deleteOne({ _id: item._id });
      continue;
    }

    try {
      await deleteStoredUserVectors(item.userId);
      await PendingVectorDeletionModel.deleteOne({ _id: item._id });
      logger.info(
        { userId: item.userId, attempts },
        "Retry-slettet Pinecone-vektorer med suksess",
      );
      await audit({
        actorUserId: getDeletedAuditActorId(item.userId),
        action: AUDIT_ACTIONS.ACCOUNT_DELETED,
        category: "privacy",
        outcome: "success",
        metadata: { phase: "vector_retry", attempts: attempts + 1 },
      });
      continue;
    } catch (error) {
      logger.error(
        { err: error, userId: item.userId },
        "Uventet feil under retry av Pinecone vektor-sletting",
      );
    }

    const nextAttempts = attempts + 1;
    await PendingVectorDeletionModel.updateOne(
      { _id: item._id },
      {
        $set: {
          attempts: nextAttempts,
          lastAttemptAt: now,
          nextRetryAt: calculateNextRetryAt(nextAttempts),
          lastError: "Retry-sletting feilet",
        },
      },
    );

    logger.warn(
      { userId: item.userId, attempts: nextAttempts },
      "Retry av Pinecone vektor-sletting feilet, planlegger nytt forsøk",
    );
  }
}

export function startPendingVectorDeletionPolling() {
  const interval = setInterval(() => {
    void processPendingVectorDeletions().catch((error) => {
      logger.warn({ err: error }, "Periodisk retry av vektor-sletting feilet");
    });
  }, VECTOR_DELETION_RETRY_INTERVAL_MS);
  interval.unref?.();
  return interval;
}
