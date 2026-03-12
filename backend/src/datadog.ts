/**
 * Datadog APM + Logging-integrasjon
 * - Datadog APM (Application Performance Monitoring) sporer ytelse og feil i applikasjonen.
 * dd-trace instrumenterer automatisk Express, Mongoose, Redis, og HTTP-kall.
 * MÅ lastes før Express/Mongoose/Redis (index.ts importerer denne først).
 * Ingen top-level await her — init() må fullføre synkront før andre moduler lastes.
 *
 * Data som sendes til Datadog når DD_API_KEY er satt:
 * - APM-traces (requests, DB, Redis, HTTP-kall) — sample rate fra DD_TRACE_SAMPLE_RATE
 * - Runtime metrics (CPU, minne, event loop) — runtimeMetrics: true
 * - Log-korrelasjon (trace_id/span_id i logger) — logInjection (logger skriver til stdout; Heroku/Datadog-agent sender til Datadog Logs)
 * - AppSec (WAF, attack detection) — ved DD_APPSEC_ENABLED=true i prod
 * - Continuous profiling — ved DD_PROFILING_ENABLED=true i prod
 */

import tracer from "dd-trace";
import { isProd } from "./utils/env.js";

const ddApiKey = process.env.DD_API_KEY;

function parseBool(val: string | undefined, fallback: boolean): boolean {
    if (val === undefined || val === "") return fallback;
    return val.toLowerCase() === "true" || val === "1";
}

function parseSampleRate(val: string | undefined): number {
    if (val === undefined || val === "") return 1;
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
}

if (ddApiKey) {
    const service = process.env.DD_SERVICE ?? "studywise-backend";
    const env = process.env.DD_ENV ?? process.env.NODE_ENV ?? "development";
    const version = process.env.DD_VERSION ?? "0.0.0";
    const logInjection = parseBool(process.env.DD_LOGS_INJECTION, true);
    const profiling = parseBool(process.env.DD_PROFILING_ENABLED, isProd);
    const appsec = parseBool(process.env.DD_APPSEC_ENABLED, isProd);
    const sampleRate = parseSampleRate(process.env.DD_TRACE_SAMPLE_RATE);
    const gitRepoUrl = process.env.DD_GIT_REPOSITORY_URL?.trim();

    try {
      tracer.init({
        service,
        env,
        version,
        logInjection,
        runtimeMetrics: true,
        profiling,
        appsec,
        sampleRate,
      });
    } catch (err) {
      setImmediate(() => {
        import("./utils/logger.js").then(({ logger }) => {
          logger.error(
            { err },
            "Datadog tracer.init() feilet — APM kan være deaktivert",
          );
        });
      });
    }

    setImmediate(() => {
        import("./utils/logger.js").then(({ logger }) => {
            logger.info(
                {
                    site: process.env.DD_SITE ?? "us5.datadoghq.com",
                    service,
                    env,
                    logInjection,
                    profiling,
                    appsec,
                    sampleRate,
                    hasGitTag: !!gitRepoUrl,
                },
                "Datadog APM initialisert",
            );
        });
    });
} else if (isProd) {
    setImmediate(() => {
        import("./utils/logger.js").then(({ logger }) => {
            logger.warn("DD_API_KEY ikke satt — Datadog APM er deaktivert i produksjon");
        });
    });
}
