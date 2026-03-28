/**
 * Database-migrasjoner
 *
 * Enkelt migrasjonssystem for MongoDB/Mongoose.
 * Kjøres automatisk ved serveroppstart — allerede kjørte migrasjoner hoppes over.
 *
 * BRUK:
 * 1. Legg til en ny migrasjon i `migrations`-arrayet nederst
 * 2. Gi den et unikt `id` (bruk dato + kort beskrivelse, f.eks. "2026-03-10-add-language")
 * 3. Skriv `up`-funksjonen som utfører endringen
 *
 * Migrasjoner kjøres i rekkefølge og er idempotente (kjøres kun én gang).
 */

import mongoose, { type AnyBulkWriteOperation } from "mongoose";
import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { sanitizeUsername, type IUser } from "./models/User.js";

// Schema for å spore hvilke migrasjoner som er kjørt
const migrationSchema = new mongoose.Schema({
    migrationId: { type: String, required: true, unique: true },
    appliedAt: { type: Date, default: Date.now },
});

const MigrationRecord = mongoose.model("MigrationRecord", migrationSchema);

export interface Migration {
    /** Unikt ID, f.eks. "2026-03-10-add-user-language" */
    id: string;
    /** Kort beskrivelse av hva migrasjonen gjør */
    description: string;
    /** Funksjonen som utfører endringen */
    up: () => Promise<void | { applied: boolean; reason?: string; skipFutureRuns?: boolean }>;
}

// ============================================================
// Registrer migrasjoner her (legg til nye nederst i arrayet)
// ============================================================
const migrations: Migration[] = [
  {
    id: "2026-03-12-content-embedding-add-moduleId-tokenCount-contentHash",
    description: "Legg til moduleId, tokenCount og contentHash på eksisterende ContentEmbedding-dokumenter",
    up: async () => {
      const col = mongoose.connection.collection("contentembeddings");
      const count = await col.countDocuments({ contentHash: { $exists: false } });
      if (count === 0) return;

      logger.info({ count }, "Migrerer ContentEmbedding-dokumenter (legger til nye felt)");

      const cursor = col.find({ contentHash: { $exists: false } });
      let updated = 0;
      const BATCH_SIZE = 500;
      type BulkOp = { updateOne: { filter: object; update: object } };
      let batch: BulkOp[] = [];

      for await (const doc of cursor) {
        const text = (doc.text as string) ?? "";
        const contentHash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
        // Grovt token-estimat uten å laste tiktoken under migrering
        const tokenCount = Math.ceil(text.length / 4);

        batch.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { contentHash, tokenCount, moduleId: doc.moduleId ?? 0 } },
          },
        });

        if (batch.length >= BATCH_SIZE) {
          await col.bulkWrite(batch, { ordered: false });
          updated += batch.length;
          batch = [];
        }
      }

      if (batch.length > 0) {
        await col.bulkWrite(batch, { ordered: false });
        updated += batch.length;
      }

      logger.info({ updated }, "ContentEmbedding-migrering fullført");
    },
  },
  {
    id: "2026-03-12-add-user-role-and-clerk",
    description: "Sett role til 'user' for brukere uten role (RBAC + Clerk)",
    up: async () => {
      const { User } = await import("./models/User.js");
      const result = await User.updateMany(
        { $or: [{ role: { $exists: false } }, { role: null }] },
        { $set: { role: "user" } },
      );
      logger.info({ modifiedCount: result.modifiedCount }, "Migrasjon: brukere oppdatert med role");
    },
  },
  {
    id: "2026-03-12-remove-support-role",
    description: "Fjern support-rollen: sett brukere med role 'support' til 'user'",
    up: async () => {
      const { User } = await import("./models/User.js");
      const result = await User.updateMany(
        { role: "support" },
        { $set: { role: "user" } },
      );
      logger.info({ modifiedCount: result.modifiedCount }, "Migrasjon: support-brukere satt til user");
    },
  },
  {
    id: "2026-03-12-remove-legacy-refresh-token-fields",
    description: "Fjern gamle refresh-token-felt etter overgang til Clerk-only auth",
    up: async () => {
      const col = mongoose.connection.collection("users");
      const result = await col.updateMany(
        {
          $or: [
            { refreshTokenHash: { $exists: true } },
            { refreshTokenExpiresAt: { $exists: true } },
          ],
        },
        {
          $unset: {
            refreshTokenHash: 1,
            refreshTokenExpiresAt: 1,
          },
        },
      );
      logger.info(
        { modifiedCount: result.modifiedCount },
        "Migrasjon: legacy refresh-token-felt fjernet",
      );
    },
  },
  {
    id: "2026-03-13-remove-legacy-password-hashes",
    description: "Fjern gamle passwordHash-felt etter overgang til Clerk-only auth",
    up: async () => {
      const col = mongoose.connection.collection("users");
      const result = await col.updateMany(
        { passwordHash: { $exists: true } },
        {
          $unset: {
            passwordHash: 1,
          },
        },
      );
      logger.info(
        { modifiedCount: result.modifiedCount },
        "Migrasjon: legacy passwordHash-felt fjernet",
      );
    },
  },
  {
    id: "2026-03-13-revoke-legacy-chat-share-links",
    description: "Trekk tilbake gamle chat-delingslenker og rydd legacy share-felt",
    up: async () => {
      const { ChatHistory } = await import("./models/ChatHistory.js");
      const result = await ChatHistory.updateMany(
        {
          $or: [
            { shareToken: { $exists: true } },
            { isShared: true, sharedSnapshot: { $exists: false } },
          ],
        },
        {
          $set: { isShared: false },
          $unset: {
            shareToken: 1,
            shareTokenHash: 1,
            sharedAt: 1,
            shareExpiresAt: 1,
            sharedSnapshot: 1,
          },
        },
      );
      logger.info(
        { modifiedCount: result.modifiedCount },
        "Migrasjon: legacy chat-delinger trukket tilbake",
      );
    },
  },
  {
    id: "2026-03-13-auditlog-drop-requestid-index",
    description: "Dropp gammel requestId_1-indeks på AuditLog for å erstatte med sparse variant",
    up: async () => {
      const col = mongoose.connection.collection("auditlogs");
      const indexes = await col.indexes();
      const hasRequestId = indexes.some((idx) => idx.name === "requestId_1");
      if (!hasRequestId) return;
      await col.dropIndex("requestId_1");
      logger.info("Migrasjon: requestId_1 droppet på auditlogs (erstattes av sparse ved createIndexes)");
    },
  },
  {
    id: "2026-03-13-rename-student-role-to-user",
    description: "Bytt RBAC-rolle fra 'student' til 'user' for eksisterende brukere",
    up: async () => {
      const { User } = await import("./models/User.js");
      const result = await User.updateMany(
        { role: "student" },
        { $set: { role: "user" } },
      );
      logger.info({ modifiedCount: result.modifiedCount }, "Migrasjon: student-brukere satt til user");
    },
  },
  {
    id: "2026-03-27-normalize-usernames-and-remove-duplicates",
    description: "Normaliser brukernavn, fjern duplikater og forbered unik indeks",
    up: async () => {
      const col = mongoose.connection.collection("users");
      const cursor = col
        .find(
          {},
          {
            projection: {
              _id: 1,
              username: 1,
              usernameNormalized: 1,
              createdAt: 1,
            },
          },
        )
        .sort({ createdAt: 1, _id: 1 });

      const seen = new Set<string>();
      const BATCH_SIZE = 500;
      type BulkOp = { updateOne: { filter: object; update: object } };
      let batch: BulkOp[] = [];
      let updated = 0;
      let clearedDuplicates = 0;

      for await (const doc of cursor) {
        const sanitized = sanitizeUsername(
          typeof doc.username === "string" ? doc.username : undefined,
        );

        if (!sanitized) {
          if (doc.username !== undefined || doc.usernameNormalized !== undefined) {
            batch.push({
              updateOne: {
                filter: { _id: doc._id },
                update: {
                  $unset: {
                    username: 1,
                    usernameNormalized: 1,
                  },
                },
              },
            });
            updated++;
          }
        } else if (seen.has(sanitized.usernameNormalized)) {
          batch.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $unset: {
                  username: 1,
                  usernameNormalized: 1,
                },
              },
            },
          });
          updated++;
          clearedDuplicates++;
        } else {
          seen.add(sanitized.usernameNormalized);
          if (
            doc.username !== sanitized.username ||
            doc.usernameNormalized !== sanitized.usernameNormalized
          ) {
            batch.push({
              updateOne: {
                filter: { _id: doc._id },
                update: {
                  $set: {
                    username: sanitized.username,
                    usernameNormalized: sanitized.usernameNormalized,
                  },
                },
              },
            });
            updated++;
          }
        }

        if (batch.length >= BATCH_SIZE) {
          await col.bulkWrite(batch, { ordered: false });
          batch = [];
        }
      }

      if (batch.length > 0) {
        await col.bulkWrite(batch, { ordered: false });
      }

      logger.info(
        { updated, clearedDuplicates },
        "Migrasjon: brukernavn normalisert og duplikater ryddet",
      );
    },
  },
  {
    id: "2026-03-28-enforce-canvas-user-one-to-one-and-shared-chat-uniqueness",
    description: "Rydd CanvasUser 1:1-koblinger og deaktiver dupliserte aktive delingslenker",
    up: async () => {
      const { User } = await import("./models/User.js");
      const { CanvasUser } = await import("./models/CanvasUser.js");
      const { SharedChat } = await import("./models/SharedChat.js");

      const users = await User.find({}, { _id: 1, canvasUser: 1 }).lean();
      const existingUserIds = new Set(users.map((user) => String(user._id)));
      const canvasUsers = await CanvasUser.find(
        {},
        {
          _id: 1,
          localUser: 1,
          canvasBaseUrl: 1,
          canvasId: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ).lean();

      const getDocTimestamp = (doc: { updatedAt?: Date; createdAt?: Date; _id: unknown }) => {
        return doc.updatedAt?.getTime() ?? doc.createdAt?.getTime() ?? 0;
      };

      const canvasUsersSorted = [...canvasUsers].sort((a, b) => {
        const byTime = getDocTimestamp(b) - getDocTimestamp(a);
        if (byTime !== 0) return byTime;
        return String(b._id).localeCompare(String(a._id));
      });

      const keptCanvasUserByOwner = new Map<string, string>();
      const keptCanvasUserByIdentity = new Map<string, string>();
      const canvasUserDeleteIds: string[] = [];

      for (const canvasUser of canvasUsersSorted) {
        const canvasUserId = String(canvasUser._id);
        const ownerId = String(canvasUser.localUser ?? "");
        const identityKey = `${canvasUser.canvasBaseUrl}::${canvasUser.canvasId}`;

        if (!ownerId || !existingUserIds.has(ownerId)) {
          canvasUserDeleteIds.push(canvasUserId);
          continue;
        }

        if (
          keptCanvasUserByOwner.has(ownerId) ||
          keptCanvasUserByIdentity.has(identityKey)
        ) {
          canvasUserDeleteIds.push(canvasUserId);
          continue;
        }

        keptCanvasUserByOwner.set(ownerId, canvasUserId);
        keptCanvasUserByIdentity.set(identityKey, canvasUserId);
      }

      if (canvasUserDeleteIds.length > 0) {
        await CanvasUser.deleteMany({ _id: { $in: canvasUserDeleteIds } });
      }

      const userBulkOps: AnyBulkWriteOperation<IUser>[] = [];
      for (const user of users) {
        const ownerId = String(user._id);
        const expectedCanvasUserId = keptCanvasUserByOwner.get(ownerId);
        const currentCanvasUserId =
          user.canvasUser != null ? String(user.canvasUser) : null;

        if (expectedCanvasUserId) {
          if (currentCanvasUserId !== expectedCanvasUserId) {
            userBulkOps.push({
              updateOne: {
                filter: { _id: user._id },
                update: {
                  $set: {
                    canvasUser: new mongoose.Types.ObjectId(expectedCanvasUserId),
                  },
                },
              },
            });
          }
          continue;
        }

        if (currentCanvasUserId) {
          userBulkOps.push({
            updateOne: {
              filter: { _id: user._id },
              update: { $unset: { canvasUser: 1 } },
            },
          });
        }
      }

      if (userBulkOps.length > 0) {
        await User.bulkWrite(userBulkOps, { ordered: false });
      }

      const activeSharedChats = await SharedChat.find(
        { isActive: true },
        { _id: 1, ownerId: 1, chatId: 1, createdAt: 1, updatedAt: 1 },
      ).lean();

      const activeSharedChatsSorted = [...activeSharedChats].sort((a, b) => {
        const byTime = getDocTimestamp(b) - getDocTimestamp(a);
        if (byTime !== 0) return byTime;
        return String(b._id).localeCompare(String(a._id));
      });

      const seenActiveShares = new Set<string>();
      const sharedChatDeactivateIds: string[] = [];

      for (const sharedChat of activeSharedChatsSorted) {
        const key = `${sharedChat.ownerId}::${sharedChat.chatId}`;
        if (seenActiveShares.has(key)) {
          sharedChatDeactivateIds.push(String(sharedChat._id));
          continue;
        }
        seenActiveShares.add(key);
      }

      if (sharedChatDeactivateIds.length > 0) {
        await SharedChat.updateMany(
          { _id: { $in: sharedChatDeactivateIds } },
          { $set: { isActive: false } },
        );
      }

      logger.info(
        {
          deletedCanvasUsers: canvasUserDeleteIds.length,
          rewiredUsers: userBulkOps.length,
          deactivatedSharedChats: sharedChatDeactivateIds.length,
        },
        "Migrasjon: CanvasUser/SharedChat-relasjoner ryddet",
      );
    },
  },
];

/**
 * Kjør alle ventende migrasjoner.
 * Kalles fra `connectToDatabase()` etter tilkobling.
 */
export async function runMigrations(): Promise<void> {
    if (migrations.length === 0) return;

    const applied = await MigrationRecord.find({}).lean();
    const appliedIds = new Set(applied.map((m) => m.migrationId));

    const pending = migrations.filter((m) => !appliedIds.has(m.id));

    if (pending.length === 0) {
        logger.info("Ingen ventende migrasjoner");
        return;
    }

    logger.info({ count: pending.length }, "Kjører ventende migrasjoner");

    for (const migration of pending) {
        try {
            logger.info({ id: migration.id }, `Migrasjon: ${migration.description}`);
            const result = await migration.up();
            if (result && result.applied === false) {
                if (result.skipFutureRuns) {
                    await MigrationRecord.create({ migrationId: migration.id });
                    logger.info(
                        { id: migration.id, reason: result.reason },
                        "Migrasjon registrert (hoppet over i dette miljøet — ikke prøv igjen)",
                    );
                } else {
                    logger.info(
                        { id: migration.id, reason: result.reason },
                        "Migrasjon hoppet over — vil prøves igjen senere",
                    );
                }
                continue;
            }
            await MigrationRecord.create({ migrationId: migration.id });
            logger.info({ id: migration.id }, "Migrasjon fullført");
        } catch (error) {
            logger.error({ err: error, id: migration.id }, "Migrasjon feilet — avbryter");
            throw error;
        }
    }

    logger.info({ count: pending.length }, "Alle migrasjoner fullført");
}
