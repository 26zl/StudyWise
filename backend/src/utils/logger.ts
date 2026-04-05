/*
* Logger middleware med Pino
*/

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";
const isCI = !!process.env.CI;
const ddEnabled = !!process.env.DD_API_KEY;

// Sjekk om pino-pretty er installert (mangler i prod-install / Docker med --prod)
let hasPinoPretty = false;
if (isDev && !isCI) {
    try {
        await import("pino-pretty");
        hasPinoPretty = true;
    } catch {
        // pino-pretty ikke tilgjengelig — bruker standard JSON-logging
    }
}

// Påkrevd av validateEnv ved serverstart; ingen fallback (én sannhetskilde).
export const logger = pino({
    level: process.env.LOG_LEVEL || "info",
    // dd-trace injiserer dd.trace_id, dd.span_id automatisk via logInjection: true
    // mixin legger til service/env for Datadog log-korrelasjon
    ...(ddEnabled && {
        mixin: () => ({
            dd: {
                service: process.env.DD_SERVICE ?? "studywise-backend",
                env: process.env.DD_ENV ?? process.env.NODE_ENV ?? "development",
                version: process.env.DD_VERSION ?? "0.0.0",
            },
        }),
    }),
    redact: {
        paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers['set-cookie']",
            "req.headers['x-api-key']",
            "req.headers['x-clerk-request-data']",
            "req.headers['x-clerk-auth-signature']",
            "req.headers['x-clerk-auth-status']",
            "req.headers['x-clerk-auth-message']",
            "req.headers['x-clerk-auth-reason']",
            "req.headers['x-clerk-clerk-url']",
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
            "userId",
            "email",
            "err.email",
            "err.userId",
        ],
        remove: true,
    },
    transport: hasPinoPretty
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
