/**
 * Bakgrunnsjobb som SLETTER ChatHistory-rader hvor `encryptedMessages` ikke lar seg dekryptere.
 *
 * Bakgrunn: ved nøkkel-mismatch (f.eks. delt MongoDB mellom miljøer med forskjellig
 * `ENCRYPTION_KEY`) blir gamle rader uleselige og kan ikke vises for brukeren uansett.
 * Disse fjernes derfor automatisk slik at de ikke samler seg opp eller forstyrrer UI.
 */
import { ChatHistory } from "../database/models/ChatHistory.js";
import { erGyldigKryptert } from "../utils/kryptering.js";
import { logger } from "../utils/logger.js";

const SCAN_BATCH_SIZE = 500;
export const CHAT_HISTORY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 time

let isRunning = false;

export async function sweepCorruptedChatHistory(): Promise<{
  scanned: number;
  deleted: number;
}> {
  if (isRunning) {
    return { scanned: 0, deleted: 0 };
  }
  isRunning = true;
  let scanned = 0;
  const idsToDelete: import("mongoose").Types.ObjectId[] = [];
  try {
    const cursor = ChatHistory.find({})
      .select({ _id: 1, user: 1, encryptedMessages: 1 })
      .sort({ updatedAt: -1 })
      .limit(SCAN_BATCH_SIZE)
      .lean()
      .cursor();

    for await (const doc of cursor) {
      scanned++;
      if (!erGyldigKryptert(doc.encryptedMessages)) {
        idsToDelete.push(doc._id);
        logger.warn(
          { chatId: doc._id.toString(), userId: doc.user?.toString() },
          "ChatHistory-cleanup: sletter korrupt rad (kan ikke dekrypteres)",
        );
      }
    }

    let deleted = 0;
    if (idsToDelete.length > 0) {
      const result = await ChatHistory.deleteMany({ _id: { $in: idsToDelete } });
      deleted = result.deletedCount ?? idsToDelete.length;
      logger.warn(
        { scanned, deleted },
        "ChatHistory-cleanup: fjernet korrupte rader",
      );
    } else {
      logger.debug({ scanned }, "ChatHistory-cleanup: ingen korrupte rader funnet");
    }
    return { scanned, deleted };
  } catch (err) {
    logger.error({ err }, "ChatHistory-cleanup feilet");
    return { scanned, deleted: 0 };
  } finally {
    isRunning = false;
  }
}

export function startChatHistoryCleanupPolling(): NodeJS.Timeout {
  const interval = setInterval(() => {
    void sweepCorruptedChatHistory();
  }, CHAT_HISTORY_CLEANUP_INTERVAL_MS);
  interval.unref?.();
  return interval;
}
