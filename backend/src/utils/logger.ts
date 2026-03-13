/*
* Logger middleware med Pino
*/

import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";
const ddEnabled = !!process.env.DD_API_KEY;

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