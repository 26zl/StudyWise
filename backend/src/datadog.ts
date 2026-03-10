/**
 * Datadog APM + Logging-integrasjon
 * - Datadog APM (Application Performance Monitoring) sporer ytelse og feil i applikasjonen.
 * dd-trace instrumenterer automatisk Express, Mongoose, Redis, og HTTP-kall.
 */

import { isProd } from "./utils/env.js";

const ddApiKey = process.env.DD_API_KEY;

if (ddApiKey) {
    const tracer = await import("dd-trace");
    // DD_SITE settes som env var (f.eks. "datadoghq.eu") — ikke som TracerOptions
    tracer.default.init({
        service: process.env.DD_SERVICE ?? "studywise-backend",
        env: process.env.DD_ENV ?? process.env.NODE_ENV ?? "development",
        version: process.env.DD_VERSION ?? "0.0.0",
        logInjection: true,       // Injiserer trace-ID i Pino-logger automatisk
        runtimeMetrics: true,     // CPU, memory, event loop, GC-metrics
        profiling: isProd,        // Continuous profiling kun i prod
        appsec: isProd,           // Application security monitoring kun i prod
        // Automatisk instrumentering av: Express, Mongoose, Redis, HTTP/HTTPS
    });
} else if (isProd) {
    // Bruk dynamisk import for å unngå at logger lastes før env er klar
    const { logger } = await import("./utils/logger.js");
    logger.warn("DD_API_KEY ikke satt — Datadog APM er deaktivert i produksjon");
}
