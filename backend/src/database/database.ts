/*
 * Database tilkobling
 * Kobler til MongoDB via Mongoose
 */

import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

import { isProd } from "../utils/env.js";

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
};

// Funksjon for å koble til databasen
export const connectToDatabase = async () => {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
        throw new Error("MONGO_URI er ikke defineret i .env");
    }
    try {
        await mongoose.connect(mongoURI, clientOptions);
        logger.info({
            maxPoolSize: clientOptions.maxPoolSize,
            minPoolSize: clientOptions.minPoolSize,
        }, "Tilkoblet til MongoDB");
    } catch (error) {
        logger.error({ err: error }, "Kunne ikke koble til MongoDB");
        process.exit(1);
    }
};
