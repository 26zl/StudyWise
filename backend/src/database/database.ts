/*
 * Database tilkobling
 * Kobler til MongoDB via Mongoose
 */

import mongoose from "mongoose";

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
        console.log("Tilkoblet til MongoDB");
    } catch (error) {
        console.error("Kunne ikke koble til MongoDB:", error);
        process.exit(1);
    }
};
