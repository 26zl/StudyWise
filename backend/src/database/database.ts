/*
 * Database tilkobling
 * Kobler til MongoDB via Mongoose
 */

import mongoose from "mongoose";
import { logger } from "../utils/logger.js";
import { AuditLog } from "./models/AuditLog.js";
import { Arbeidsplan } from "./models/arbeidsplan.js";
import { CanvasUser } from "./models/CanvasUser.js";
import { CanvasStructureModel } from "./models/CanvasStructure.js";
import { ChatHistory } from "./models/ChatHistory.js";
import { ContentEmbedding } from "./models/ContentEmbedding.js";
import { ChatFeedback } from "./models/ChatFeedback.js";
import { SharedChat } from "./models/SharedChat.js";
import { TaskBreakdown } from "./models/TaskBreakdown.js";
import { User } from "./models/User.js";
import { DeletedUserTombstone } from "./models/DeletedUserTombstone.js";
import { PendingClerkDeletionModel } from "./models/PendingClerkDeletion.js";
import { PendingVectorDeletionModel } from "./models/PendingVectorDeletion.js";
import { WebPushSubscriptionModel } from "./models/WebPushSubscription.js";
import { StudyContext } from "./models/StudyContext.js";
import { KnowledgeBase } from "./models/Kunnskapsbase.js";
import { KBContentChunk } from "./models/KBContentChunk.js";

import { isProd } from "../utils/env.js";
import { runMigrations } from "./migrations.js";

// MongoDB klient opsjoner med connection pooling
const clientOptions: mongoose.ConnectOptions = {
    serverApi: {
        version: '1' as const,
        strict: true,
        deprecationErrors: true,
    },
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

/** Indeksnavn som MÅ eksistere på User-samlingen for dataintegritet. */
const REQUIRED_USER_INDEXES = [
    "email_1",                                       // unique (non-sparse) via schema field
    "clerk_id_unique",                               // unique sparse
    "username_normalized_unique",                     // unique sparse
    "oauth_accounts_provider_account_id_unique",     // unique sparse compound
] as const;

async function ensureDatabaseIndexes() {
    await Promise.all([
        User.createIndexes(),
        AuditLog.createIndexes(),
        Arbeidsplan.createIndexes(),
        CanvasUser.createIndexes(),
        CanvasStructureModel.createIndexes(),
        ChatHistory.createIndexes(),
        ContentEmbedding.createIndexes(),
        ChatFeedback.createIndexes(),
        SharedChat.createIndexes(),
        TaskBreakdown.createIndexes(),
        DeletedUserTombstone.createIndexes(),
        PendingClerkDeletionModel.createIndexes(),
        PendingVectorDeletionModel.createIndexes(),
        WebPushSubscriptionModel.createIndexes(),
        StudyContext.createIndexes(),
        KnowledgeBase.createIndexes(),
        KBContentChunk.createIndexes(),
    ]);

    // Verifiser at alle påkrevde unike indekser faktisk finnes på User-samlingen.
    // Fanger opp stille createIndexes-feil, manuelle index-slettinger eller migreringsproblemer.
    const userIndexes = await User.collection.indexes();
    const existingNames = new Set(userIndexes.map((idx) => idx.name));
    const missing = REQUIRED_USER_INDEXES.filter((name) => !existingNames.has(name));

    if (missing.length > 0) {
        logger.fatal(
            { missing, existing: [...existingNames] },
            "KRITISK: Påkrevde unike indekser mangler på User-collection — serveren kan ikke starte trygt",
        );
        throw new Error(`Missing required User indexes: ${missing.join(", ")}`);
    }

    logger.info("MongoDB-indekser verifisert (inkl. unike User-indekser)");
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
