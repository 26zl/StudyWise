/*
 * Database tilkobling
 * Kobler til MongoDB via Mongoose
 */

import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

const clientOptions = {
    serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true,
    }
};
export const connectToDatabase = async () => {
    const mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
        throw new Error("MONGO_URI er ikke defineret i .env");
    }
    try {
        await mongoose.connect(mongoURI, clientOptions as mongoose.ConnectOptions);
        logger.info("Tilkoblet til MongoDB");
    } catch (error) {
        logger.error({ err: error }, "Kunne ikke koble til MongoDB");
        process.exit(1);
    }
};
