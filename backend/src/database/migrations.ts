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

import mongoose from "mongoose";
import crypto from "crypto";
import { logger } from "../utils/logger.js";

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
