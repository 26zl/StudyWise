/**
 * Sikker kontosletting: fjerner eller anonymiserer bruker og all tilknyttet data.
 * Anonymisering av revisjonslogg håndteres av kalleren etter sletting slik at
 * account_deleted-hendelsen heller ikke reintroduserer rå bruker-ID.
 */
import mongoose from "mongoose";
import { User } from "../../database/models/User.js";
import { ChatHistory } from "../../database/models/ChatHistory.js";
import { TaskBreakdown } from "../../database/models/TaskBreakdown.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { Arbeidsplan } from "../../database/models/arbeidsplan.js";
import { logger } from "../../utils/logger.js";
import { invalidateUserCanvasCache } from "../../services/canvas-sync.service.js";
import { deleteClerkUserById } from "./clerkAuth.js";

export interface AccountDeletionResult {
  deleted: {
    user: boolean;
    chatHistory: number;
    taskBreakdown: number;
    contentEmbedding: number;
    canvasUser: number;
    arbeidsplan: number;
  };
  providerAccountDeleted: boolean;
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
    taskBreakdown: 0,
    contentEmbedding: 0,
    canvasUser: 0,
    arbeidsplan: 0,
  };
  let providerAccountDeleted = false;

  const user = await User.findById(id).select("+canvasApiToken +canvasTokenHash");
  if (!user) {
    logger.warn({ userId }, "Account deletion: User document not found or already deleted");
    return { deleted: result, providerAccountDeleted: false };
  }

  result.contentEmbedding = (
    await invalidateUserCanvasCache(userId, { strictContentDeletion: true })
  ).contentEmbeddingDeleted;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // MERK: invalidateUserCanvasCache (Pinecone/Redis) kjørte allerede utenfor denne transaksjonen.
      // Hvis transaksjonen feiler, er innholdsdata allerede slettet fra Pinecone/MongoDB.
      // Dette er akseptert risiko siden Pinecone ikke støtter distribuerte transaksjoner.
      const [chatRes, taskRes, canvasRes, arbeidsplanRes] = await Promise.all([
        ChatHistory.deleteMany({ user: id }, { session }),
        TaskBreakdown.deleteMany({ userId: id }, { session }),
        CanvasUser.deleteMany({ localUser: id }, { session }),
        Arbeidsplan.deleteMany({ userId }, { session }),
      ]);

      result.chatHistory = chatRes.deletedCount ?? 0;
      result.taskBreakdown = taskRes.deletedCount ?? 0;
      result.canvasUser = canvasRes.deletedCount ?? 0;
      result.arbeidsplan = arbeidsplanRes.deletedCount ?? 0;

      const anonymizedEmail = `deleted-${user._id.toString()}@studywise.invalid`;
      const userRes = await User.updateOne(
        { _id: id, deletedAt: { $exists: false } },
        {
          $set: {
            email: anonymizedEmail,
            deletedAt: new Date(),
          },
          $unset: {
            canvasApiToken: 1,
            canvasBaseUrl: 1,
            canvasTokenHash: 1,
            canvasUser: 1,
            username: 1,
            firstName: 1,
            lastName: 1,
            canvasContextPreferences: 1,
            varslerState: 1,
          },
        },
        { session },
      );
      result.user = (userRes.modifiedCount ?? 0) > 0;
    });
  } catch (txError) {
    logger.error(
      { err: txError, userId, contentEmbeddingDeleted: result.contentEmbedding },
      "MongoDB-transaksjon feilet etter cache-invalidering — innholds-data er slettet fra Pinecone/MongoDB, men brukerprofil og historikk er ikke slettet",
    );
    throw txError;
  } finally {
    await session.endSession();
  }

  if (user.clerkId) {
    providerAccountDeleted = await deleteClerkUserById(user.clerkId);
    if (!providerAccountDeleted) {
      logger.warn({ userId, clerkId: user.clerkId }, "Klarte ikke å slette Clerk-konto under kontosletting");
    }
  } else {
    providerAccountDeleted = true;
  }

  if (!result.user) {
    logger.warn({ userId }, "Account deletion: User tombstone could not be written");
  }

  return { deleted: result, providerAccountDeleted };
}
