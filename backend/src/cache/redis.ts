/*
* Cache for redis primært brukt for Canvas API
*/
import { createClient } from "redis";

const client = createClient({
    url: process.env.REDIS_URL,
});

client.on("error", (err) => console.log("Redis Client Error", err));

// Kobler til redis
client.connect().catch(console.error);

export const getCache = async (key: string): Promise<string | null> => {
    if (!client.isOpen) return null;
    try {
        return await client.get(key);
    } catch (error) {
        console.warn("Redis error:", error);
        return null;
    }
};

// Setter cache
export const setCache = async (key: string, value: string, ttlSeconds: number = 300) => {
    if (!client.isOpen) return;
    try {
        await client.set(key, value, {
            EX: ttlSeconds,
        });
    } catch (error) {
        console.warn("Redis error:", error);
    }
};

export default client;
