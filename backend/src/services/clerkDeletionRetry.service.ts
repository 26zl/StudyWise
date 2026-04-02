import { PendingClerkDeletionModel } from "../database/models/PendingClerkDeletion.js";
import { deleteClerkUserById } from "../rutere/auth/clerkAuth.js";
import { logger } from "../utils/logger.js";
import { audit, AUDIT_ACTIONS, getDeletedAuditActorId } from "../utils/auditLog.js";

export const CLERK_DELETION_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const CLERK_DELETION_BATCH_SIZE = 20;

function calculateNextRetryAt(attempts: number): Date {
  const delayMs = Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, attempts));
  return new Date(Date.now() + delayMs);
}

export async function enqueueClerkDeletionRetry(input: {
  clerkId: string;
  userId?: string;
  lastError?: string;
}): Promise<void> {
  await PendingClerkDeletionModel.findOneAndUpdate(
    { clerkId: input.clerkId },
    {
      $set: {
        userId: input.userId,
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

export async function processPendingClerkDeletions(): Promise<void> {
  const now = new Date();
  const pending = await PendingClerkDeletionModel.find({
    nextRetryAt: { $lte: now },
  })
    .sort({ nextRetryAt: 1 })
    .limit(CLERK_DELETION_BATCH_SIZE);

  for (const item of pending) {
    const attempts = item.attempts ?? 0;
    try {
      const deleted = await deleteClerkUserById(item.clerkId);
      if (deleted) {
        await PendingClerkDeletionModel.deleteOne({ _id: item._id });
        logger.info(
          { clerkId: item.clerkId, userId: item.userId, attempts },
          "Retry-slettet Clerk-konto med suksess",
        );
        if (item.userId) {
          await audit({
            actorUserId: getDeletedAuditActorId(item.userId),
            action: AUDIT_ACTIONS.ACCOUNT_DELETED,
            category: "privacy",
            outcome: "success",
            metadata: { phase: "clerk_retry", attempts: attempts + 1 },
          });
        }
        continue;
      }
    } catch (error) {
      logger.error(
        { err: error, clerkId: item.clerkId, userId: item.userId },
        "Uventet feil under retry av Clerk-sletting",
      );
    }

    const nextAttempts = attempts + 1;
    await PendingClerkDeletionModel.updateOne(
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
      {
        clerkId: item.clerkId,
        userId: item.userId,
        attempts: nextAttempts,
      },
      "Retry av Clerk-sletting feilet, planlegger nytt forsøk",
    );
  }
}

export function startPendingClerkDeletionPolling() {
  const interval = setInterval(() => {
    void processPendingClerkDeletions().catch((error) => {
      logger.warn({ err: error }, "Periodisk retry av Clerk-sletting feilet");
    });
  }, CLERK_DELETION_RETRY_INTERVAL_MS);
  interval.unref?.();
  return interval;
}
