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
    up: () => Promise<void>;
}

// ============================================================
// Registrer migrasjoner her (legg til nye nederst i arrayet)
// ============================================================
const migrations: Migration[] = [
    // Eksempel — fjern eller erstatt med ekte migrasjoner:
    //
    // {
    //     id: "2026-03-10-add-user-language",
    //     description: "Legg til preferredLanguage-felt på alle brukere",
    //     up: async () => {
    //         const db = mongoose.connection.db;
    //         if (!db) throw new Error("Database ikke tilkoblet");
    //         await db.collection("users").updateMany(
    //             { preferredLanguage: { $exists: false } },
    //             { $set: { preferredLanguage: "nb" } },
    //         );
    //     },
    // },
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
            await migration.up();
            await MigrationRecord.create({ migrationId: migration.id });
            logger.info({ id: migration.id }, "Migrasjon fullført");
        } catch (error) {
            logger.error({ err: error, id: migration.id }, "Migrasjon feilet — avbryter");
            throw error;
        }
    }

    logger.info({ count: pending.length }, "Alle migrasjoner fullført");
}
