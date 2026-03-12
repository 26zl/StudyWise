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
// Vector search bruker nå Pinecone; Atlas Vector Search-indeks er fjernet.
const migrations: Migration[] = [];

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
