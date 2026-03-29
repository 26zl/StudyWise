/**
 * Sikker kontosletting: fjerner eller anonymiserer bruker og all tilknyttet data.
 * Anonymisering av revisjonslogg håndteres av kalleren etter sletting slik at
 * account_deleted-hendelsen heller ikke reintroduserer rå bruker-ID.
 */
import mongoose from "mongoose";
import { User } from "../../database/models/User.js";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { SharedChat } from "../../database/models/SharedChat.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { Arbeidsplan } from "../../database/models/arbeidsplan.js";
import { CanvasStructureModel } from "../../database/models/CanvasStructure.js";
import { logger } from "../../utils/logger.js";
import { invalidateUserKISessionCache } from "../../services/canvas-sync.service.js";
import {
  deleteStoredUserMongoContent,
  deleteStoredUserVectors,
} from "../../services/embedding.service.js";
import { invalidateCacheByPattern, isRedisReady } from "../../cache/redis.js";
import { deleteClerkUserById, invalidateTokenCacheByClerkId } from "./clerkAuth.js";
import { WebPushSubscriptionModel } from "../../database/models/WebPushSubscription.js";
import { enqueueClerkDeletionRetry } from "../../services/clerkDeletionRetry.service.js";

export interface AccountDeletionResult {
  deleted: {
    user: boolean;
    chatHistory: number;
    sharedChat: number;
    taskBreakdown: number;
    contentEmbedding: number;
    canvasUser: number;
    arbeidsplan: number;
  };
  providerAccountDeleted: boolean;
  vectorCleanupSucceeded: boolean;
}

/**
 * Sletter all data tilknyttet brukeren.
 * AuditLog slettes ikke her; kalleren må eventuelt anonymisere revisjonssporet separat.
 */
export async function deleteAccountData(userId: string): Promise<AccountDeletionResult> {
  const id = new mongoose.Types.ObjectId(userId);
  const result: AccountDeletionResult["deleted"] = {
    user: false,
    chatHistory: 0,
    sharedChat: 0,
    taskBreakdown: 0,
    contentEmbedding: 0,
    canvasUser: 0,
    arbeidsplan: 0,
  };
  let providerAccountDeleted = false;
  let vectorCleanupSucceeded = true;

  const user = await User.findById(id).select("+canvasApiToken +canvasTokenHash");
  if (!user) {
    logger.warn({ userId }, "Account deletion: User document not found or already deleted");
    return {
      deleted: result,
      providerAccountDeleted: false,
      vectorCleanupSucceeded: false,
    };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [
        chatRes,
        sharedChatRes,
        taskRes,
        contentRes,
        canvasStructureRes,
        canvasRes,
        arbeidsplanRes,
        webPushRes,
      ] = await Promise.all([
        ChatHistory.deleteMany({ user: id }, { session }),
        SharedChat.deleteMany({ ownerId: id }, { session }),
        TaskBreakdown.deleteMany({ userId: id }, { session }),
        deleteStoredUserMongoContent(userId, session),
        CanvasStructureModel.deleteMany({ userId }, { session }),
        CanvasUser.deleteMany({ localUser: id }, { session }),
        Arbeidsplan.deleteMany({ userId }, { session }),
        WebPushSubscriptionModel.deleteMany({ userId: id }, { session }),
      ]);

      result.chatHistory = chatRes.deletedCount ?? 0;
      result.sharedChat = sharedChatRes.deletedCount ?? 0;
      result.taskBreakdown = taskRes.deletedCount ?? 0;
      result.contentEmbedding = contentRes;
      result.canvasUser = canvasRes.deletedCount ?? 0;
      result.arbeidsplan = arbeidsplanRes.deletedCount ?? 0;

      if ((canvasStructureRes.deletedCount ?? 0) > 0) {
        logger.info(
          { userId, deletedCount: canvasStructureRes.deletedCount ?? 0 },
          "Slettet CanvasStructure som del av kontosletting",
        );
      }

      if ((webPushRes.deletedCount ?? 0) > 0) {
        logger.info(
          { userId, deletedCount: webPushRes.deletedCount ?? 0 },
          "Slettet web-push-abonnementer som del av kontosletting",
        );
      }

      const anonymizedEmail = `deleted-${user._id.toString()}@studywise.invalid`;
      const userRes = await User.updateOne(
        { _id: id, deletedAt: { $exists: false } },
        {
          $set: {
            email: anonymizedEmail,
            deletedAt: new Date(),
          },
            $unset: {
              clerkId: 1,
              oauthAccounts: 1,
              canvasApiToken: 1,
              canvasBaseUrl: 1,
              canvasTokenHash: 1,
              canvasUser: 1,
            username: 1,
            usernameNormalized: 1,
            firstName: 1,
            lastName: 1,
            clerkProfileSyncedAt: 1,
            authProvider: 1,
            canvasContextPreferences: 1,
            varslerState: 1,
            manuellInnleveringState: 1,
            browserPushPreferences: 1,
            browserPushSentState: 1,
            uiPreferences: 1,
          },
        },
        { session },
      );
      result.user = (userRes.modifiedCount ?? 0) > 0;
    });
  } catch (txError) {
    logger.error(
      { err: txError, userId },
      "MongoDB-transaksjon feilet under kontosletting",
    );
    throw txError;
  } finally {
    await session.endSession();
  }

  try {
    await deleteStoredUserVectors(userId);
  } catch (cleanupError) {
    vectorCleanupSucceeded = false;
    logger.error(
      { err: cleanupError, userId },
      "Kontosletting fullforte lokal sletting, men Pinecone-opprydding feilet",
    );
  }

  const runtimeCleanupTasks: Array<Promise<unknown>> = [invalidateUserKISessionCache(userId)];
  if (isRedisReady()) {
    runtimeCleanupTasks.push(invalidateCacheByPattern(`canvas:user:${userId}:*`));
  }
  const runtimeCleanupResults = await Promise.allSettled(runtimeCleanupTasks);
  for (const cleanupResult of runtimeCleanupResults) {
    if (cleanupResult.status === "rejected") {
      logger.warn(
        { err: cleanupResult.reason, userId },
        "Kontosletting fullforte, men runtime-cache-opprydding feilet",
      );
    }
  }

  if (user.clerkId) {
    invalidateTokenCacheByClerkId(user.clerkId);
    providerAccountDeleted = await deleteClerkUserById(user.clerkId);
    if (!providerAccountDeleted) {
      logger.warn({ userId, clerkId: user.clerkId }, "Klarte ikke å slette Clerk-konto under kontosletting");
      await enqueueClerkDeletionRetry({
        clerkId: user.clerkId,
        userId,
        lastError: "Klarte ikke å slette Clerk-konto under kontosletting",
      });
    }
  } else {
    providerAccountDeleted = true;
  }

  if (!result.user) {
    logger.warn({ userId }, "Account deletion: User tombstone could not be written");
  }

  return { deleted: result, providerAccountDeleted, vectorCleanupSucceeded };
}
