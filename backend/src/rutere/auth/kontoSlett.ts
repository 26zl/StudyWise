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
import { ActivityLog } from "../../database/models/ActivityLog.js";
import { enqueueClerkDeletionRetry } from "../../queues/clerkDeletion.queue.js";
import { enqueueVectorDeletionRetry } from "../../queues/pineconeCleanup.queue.js";
import { DeletedUserTombstone } from "../../database/models/DeletedUserTombstone.js";
import { KnowledgeBase } from "../../database/models/Kunnskapsbase.js";
import { KBContentChunk } from "../../database/models/KBContentChunk.js";
import { deleteAllKBContentForUser } from "../../services/kunnskapsbase-indeksering.service.js";
import { SystemAnnouncement } from "../../database/models/SystemAnnouncement.js";

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
  /**
   * Sant hvis brukeren hadde en lagret Canvas-tilgangsnøkkel ved sletting.
   * Vi sletter ikke tokenet i Canvas selv — brukeren må gjøre det manuelt
   * i Canvas-innstillingene. Dette feltet brukes til å vise en påminnelse
   * etter sletting (kun når relevant).
   */
  hadCanvasToken: boolean;
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
  const user = await User.findById(id).select("+canvasApiToken +canvasTokenHash");
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
      hadCanvasToken: false,
    };
  }

  // Husk om brukeren hadde en Canvas-token før vi sletter brukerdocumentet.
  // Vi rører IKKE Canvas — brukeren må selv slette tokenet i Canvas-innstillingene.
  // Dette flagget brukes kun til å vise en påminnelse etter sletting.
  const hadCanvasToken = !!user.canvasApiToken;
  const kbBaseIds = (await KnowledgeBase.find({ userId }, { _id: 1 }).lean()).map((base) =>
    String(base._id),
  );

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // MongoDB-driveren krever at operasjoner på samme ClientSession kjøres
      // sekvensielt. `Promise.all` med flere parallelle ops mot `{ session }`
      // utløser `ConflictingOperationInProgress` (kode 117) ved retry inne i
      // `withTransaction`. Vi bruker derfor seriell await per op.
      // `deleteStoredUserMongoContent` sletter `FileExtractionStatus` selv,
      // så vi kaller det ikke separat lenger (unngår dobbeltsletting).
      const chatRes = await ChatHistory.deleteMany({ user: id }, { session });
      const sharedChatRes = await SharedChat.deleteMany({ ownerId: id }, { session });
      const taskRes = await TaskBreakdown.deleteMany({ userId: id }, { session });
      const contentRes = await deleteStoredUserMongoContent(userId, session);
      const canvasStructureRes = await CanvasStructureModel.deleteMany({ userId }, { session });
      const canvasRes = await CanvasUser.deleteMany({ localUser: id }, { session });
      const arbeidsplanRes = await Arbeidsplan.deleteMany({ userId }, { session });
      const webPushRes = await WebPushSubscriptionModel.deleteMany({ userId: id }, { session });
      const studyContextRes = await StudyContext.deleteMany({ userId }, { session });
      await ChatFeedback.deleteMany({ user: id }, { session });
      await KnowledgeBase.deleteMany({ userId }, { session });
      await KBContentChunk.deleteMany({ userId }, { session });
      await ActivityLog.deleteMany({ user: id }, { session });
      // Anonymiser publishedBy på systemmeldinger denne brukeren har publisert
      // (kun relevant hvis en admin sletter kontoen sin). $unset fjerner referansen
      // uten å påvirke meldingens innhold eller aktive status.
      await SystemAnnouncement.updateMany(
        { publishedBy: userId },
        { $unset: { publishedBy: 1 } },
        { session },
      );

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
    logger.error({ err: txError, userId }, "MongoDB-transaksjon feilet under kontosletting");
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
    const msg =
      kbCleanupError instanceof Error ? kbCleanupError.message : "KB Pinecone-opprydding feilet";
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
    if (options?.skipClerkDeletion) {
      // Clerk-brukeren er allerede slettet (f.eks. via Clerk webhook) — hopp over
      providerAccountDeleted = true;
    } else {
      try {
        providerAccountDeleted = await deleteClerkUserById(user.clerkId);
      } catch (clerkErr) {
        providerAccountDeleted = false;
        logger.error(
          { err: clerkErr, userId, clerkId: user.clerkId },
          "deleteClerkUserById kastet under kontosletting",
        );
      }
      if (!providerAccountDeleted) {
        logger.warn(
          { userId, clerkId: user.clerkId },
          "Klarte ikke å slette Clerk-konto under kontosletting",
        );
        try {
          await enqueueClerkDeletionRetry({
            clerkId: user.clerkId,
            userId,
            lastError: "Klarte ikke å slette Clerk-konto under kontosletting",
          });
        } catch (enqueueErr) {
          logger.error(
            { err: enqueueErr, userId, clerkId: user.clerkId },
            "Klarte ikke å legge Clerk-sletting i retry-kø",
          );
        }
      }
    }
  } else {
    providerAccountDeleted = true;
  }

  if (!result.user) {
    logger.warn({ userId }, "Account deletion: User tombstone could not be written");
  }

  return {
    deleted: result,
    providerAccountDeleted,
    vectorCleanupSucceeded,
    hadCanvasToken,
  };
}
