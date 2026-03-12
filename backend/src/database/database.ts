/*
 * Database tilkobling
 * Kobler til MongoDB via Mongoose
 */

import mongoose from "mongoose";
import { logger } from "../utils/logger.js";
import { CanvasUser } from "./models/CanvasUser.js";
import { ChatHistory } from "./models/ChatHistory.js";
import { ContentEmbedding } from "./models/ContentEmbedding.js";
import { TaskBreakdown } from "./models/TaskBreakdown.js";
import { User } from "./models/User.js";

import { isProd } from "../utils/env.js";
import { runMigrations } from "./migrations.js";

// MongoDB klient opsjoner med connection pooling
const clientOptions: mongoose.ConnectOptions = {
    serverApi: {
        version: '1' as const,
        strict: true,
        deprecationErrors: true,
    },
    // Tving SCRAM-SHA-256 (MongoDB 4.0+) — unngår MD5/SHA-1 i SCRAM-SHA-1 som flagges av sikkerhetsscannere
    authMechanism: "SCRAM-SHA-256",
    // Connection pooling - optimalisert for ytelse
    maxPoolSize: isProd ? 50 : 10,        // Maks samtidige tilkoblinger
    minPoolSize: isProd ? 5 : 2,          // Minimum tilkoblinger (holdes åpne)
    maxIdleTimeMS: 30000,                 // Lukk inaktive etter 30 sek
    serverSelectionTimeoutMS: 5000,       // Timeout for servervalg
    socketTimeoutMS: 45000,               // Socket timeout
    // Retry-konfigurasjon
    retryWrites: true,
    retryReads: true,
    autoIndex: false,
};

async function ensureDatabaseIndexes() {
    await Promise.all([
        User.createIndexes(),
        CanvasUser.createIndexes(),
        ChatHistory.createIndexes(),
        ContentEmbedding.createIndexes(),
        TaskBreakdown.createIndexes(),
    ]);
    logger.info("MongoDB-indekser verifisert");
}

// Funksjon for å koble til databasen
export const connectToDatabase = async () => {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
        throw new Error("MONGO_URI er ikke defineret i .env");
    }
    try {
        await mongoose.connect(mongoURI, clientOptions);
        await runMigrations();
        await ensureDatabaseIndexes();
        logger.info({
            maxPoolSize: clientOptions.maxPoolSize,
            minPoolSize: clientOptions.minPoolSize,
        }, "Tilkoblet til MongoDB");
    } catch (error) {
        logger.error({ err: error }, "Kunne ikke koble til MongoDB");
        process.exit(1);
    }
};
