/*
* Cache for redis primært brukt for Canvas API
*/
import { createClient } from "redis";
import { logger } from "../utils/logger.js";

const client = createClient({
    url: process.env.REDIS_URL,
});

client.on("error", (err) => logger.error({ err }, "Redis Client Error"));

// Kobler til redis
client.connect().catch((err) => logger.error({ err }, "Redis tilkobling feilet"));

export const getCache = async (key: string): Promise<string | null> => {
    if (!client.isOpen)
        return null;
    try {
        return await client.get(key);
    } catch (error) {
        logger.warn({ err: error }, "Redis error");
        return null;
    }
};

// Setter cache (standard 10 minutter)
export const setCache = async (key: string, value: string, ttlSeconds: number = 600) => {
    if (!client.isOpen)
        return;
    try {
        await client.set(key, value, {
            EX: ttlSeconds,
        });
    } catch (error) {
        logger.warn({ err: error }, "Redis error");
    }
};

export default client;
