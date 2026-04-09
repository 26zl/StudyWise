/**
 * Sikker kontosletting: fjerner eller anonymiserer bruker og all tilknyttet data.
 * Anonymisering av revisjonslogg håndteres av kalleren etter sletting slik at
 * account_deleted-hendelsen heller ikke reintroduserer rå bruker-ID.
 */
import mongoose from "mongoose";
import { User } from "../../database/models/User.js";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { ChatFeedback } from "../../database/models/ChatFeedback.js";
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
import { StudyContext } from "../../database/models/StudyContext.js";
import { enqueueClerkDeletionRetry } from "../../queues/clerkDeletion.queue.js";
import { enqueueVectorDeletionRetry } from "../../queues/pineconeCleanup.queue.js";
import { DeletedUserTombstone } from "../../database/models/DeletedUserTombstone.js";
import { KnowledgeBase } from "../../database/models/Kunnskapsbase.js";
import { KBContentChunk } from "../../database/models/KBContentChunk.js";
import { deleteAllKBContentForUser } from "../../services/kunnskapsbase-indeksering.service.js";

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
export async function deleteAccountData(
  userId: string,
  options?: { skipClerkDeletion?: boolean },
): Promise<AccountDeletionResult> {
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

  // allow-deleted-users: kontosletting MÅ være idempotent — vi må kunne se soft-deleted
  // brukere for å kunne svare riktig (med tombstone-sjekk) ved gjentatte sletteforsøk
  const user = await User.findById(id).select(
    "+canvasApiToken +canvasTokenHash",
  );
  if (!user) {
    // Sjekk om brukeren allerede er slettet (idempotency)
    const alreadyDeleted = await DeletedUserTombstone.exists({
      originalUserId: id,
    });
    logger.warn(
      { userId, alreadyDeleted: !!alreadyDeleted },
      "Account deletion: User document not found or already deleted",
    );
    return {
      deleted: result,
      // Hvis tombstone finnes, ble slettingen fullført tidligere
      providerAccountDeleted: !!alreadyDeleted,
      vectorCleanupSucceeded: !!alreadyDeleted,
    };
  }
  const kbBaseIds = (await KnowledgeBase.find({ userId }, { _id: 1 }).lean()).map((base) =>
    String(base._id),
  );

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
        studyContextRes,
        _chatFeedbackRes,
      ] = await Promise.all([
        ChatHistory.deleteMany({ user: id }, { session }),
        SharedChat.deleteMany({ ownerId: id }, { session }),
        TaskBreakdown.deleteMany({ userId: id }, { session }),
        deleteStoredUserMongoContent(userId, session),
        CanvasStructureModel.deleteMany({ userId }, { session }),
        CanvasUser.deleteMany({ localUser: id }, { session }),
        Arbeidsplan.deleteMany({ userId }, { session }),
        WebPushSubscriptionModel.deleteMany({ userId: id }, { session }),
        StudyContext.deleteMany({ userId }, { session }),
        ChatFeedback.deleteMany({ user: id }, { session }),
        KnowledgeBase.deleteMany({ userId }, { session }),
        KBContentChunk.deleteMany({ userId }, { session }),
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

      if ((studyContextRes.deletedCount ?? 0) > 0) {
        logger.info(
          { userId, deletedCount: studyContextRes.deletedCount ?? 0 },
          "Slettet StudyContext som del av kontosletting",
        );
      }

      // Stale retry-oppføringer håndteres nå av BullMQ (clerk-deletion queue);
      // ingen MongoDB-cleanup nødvendig her.

      // Rydd opp tombstones med overlappende OAuth-kontoer innenfor transaksjonen
      // for å unngå duplicate key-feil fra asynkron opprydding (queueDeletedOAuthConflictCleanup)
      const oauthAccounts = user.oauthAccounts ?? [];
      if (oauthAccounts.length > 0) {
        await DeletedUserTombstone.updateMany(
          {
            $or: oauthAccounts.map((acc) => ({
              "oauthAccounts.provider": acc.provider,
              "oauthAccounts.providerAccountId": acc.providerAccountId,
            })),
          },
          { $unset: { oauthAccounts: 1 } },
          { session },
        );
      }

      // Opprett minimal tombstone for å håndtere OAuth/brukernavn-konflikter
      // Tombstones har 90-dagers TTL og slettes automatisk av MongoDB
      await DeletedUserTombstone.create(
        [
          {
            originalUserId: id,
            clerkId: user.clerkId,
            oauthAccounts,
            usernameNormalized: user.usernameNormalized,
            deletedAt: new Date(),
          },
        ],
        { session },
      );

      // Hard delete bruker - alle data fjernes permanent fra users-samlingen
      const userRes = await User.deleteOne({ _id: id }, { session });
      result.user = (userRes.deletedCount ?? 0) > 0;
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

  // Slett alle Pinecone-vektorer (KB + Canvas-innhold) og legg i retry-kø samlet ved feil.
  // Konsolidert til én enqueue for å unngå at feil i en av to separate enqueue-kall
  // fører til at kbBaseIds går tapt fra retry-jobben.
  const vectorErrors: string[] = [];

  try {
    await deleteAllKBContentForUser(userId, kbBaseIds);
  } catch (kbCleanupError) {
    vectorCleanupSucceeded = false;
    const msg = kbCleanupError instanceof Error ? kbCleanupError.message : "KB Pinecone-opprydding feilet";
    vectorErrors.push(`KB: ${msg}`);
    logger.error(
      { err: kbCleanupError, userId },
      "KB Pinecone-opprydding feilet under kontosletting",
    );
  }

  try {
    await deleteStoredUserVectors(userId);
  } catch (cleanupError) {
    vectorCleanupSucceeded = false;
    const msg = cleanupError instanceof Error ? cleanupError.message : "Pinecone-opprydding feilet";
    vectorErrors.push(`Vektorer: ${msg}`);
    logger.error(
      { err: cleanupError, userId },
      "Pinecone vektor-opprydding feilet under kontosletting",
    );
  }

  if (vectorErrors.length > 0) {
    try {
      await enqueueVectorDeletionRetry({
        userId,
        kbBaseIds,
        lastError: vectorErrors.join("; "),
      });
    } catch (retryEnqueueError) {
      logger.error(
        { err: retryEnqueueError, userId },
        "Klarte ikke å legge vektor-sletting i retry-kø",
      );
    }
  }

  const runtimeCleanupTasks: Array<Promise<unknown>> = [
    invalidateUserKISessionCache(userId),
  ];
  if (isRedisReady()) {
    runtimeCleanupTasks.push(
      invalidateCacheByPattern(`canvas:user:${userId}:*`),
    );
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
    if (options?.skipClerkDeletion) {
      // Clerk-brukeren er allerede slettet (f.eks. via Clerk webhook) — hopp over
      providerAccountDeleted = true;
    } else {
      providerAccountDeleted = await deleteClerkUserById(user.clerkId);
      if (!providerAccountDeleted) {
        logger.warn(
          { userId, clerkId: user.clerkId },
          "Klarte ikke å slette Clerk-konto under kontosletting",
        );
        await enqueueClerkDeletionRetry({
          clerkId: user.clerkId,
          userId,
          lastError: "Klarte ikke å slette Clerk-konto under kontosletting",
        });
      }
    }
  } else {
    providerAccountDeleted = true;
  }

  if (!result.user) {
    logger.warn(
      { userId },
      "Account deletion: User tombstone could not be written",
    );
  }

  return { deleted: result, providerAccountDeleted, vectorCleanupSucceeded };
}
