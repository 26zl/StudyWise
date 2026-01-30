/*
* Logger middleware med Pino
*/

import pino from "pino";

// Sjekker om vi er i utviklingsmodus
const isDev = process.env.NODE_ENV !== "production";

// Eksporterer logger-instans
export const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['set-cookie']",
            "req.headers['x-api-key']",
            "req.body.password",
            "req.body.token",
            "req.body.canvasToken",
            "req.body.canvasApiToken",
            "req.body.email",
            "req.body.firstName",
            "req.body.lastName",
            "req.query.token",
            "req.query.access_token",
            "req.canvasToken",
            "req.user",
            "res.headers['set-cookie']",
        ],
        remove: true,
    },
    transport: isDev
        ? {
            target: "pino-pretty",
            options: {
                colorize: true,
                translateTime: "HH:MM:ss Z",
                ignore: "pid,hostname",
            },
        }
        : undefined,
});