/**
 * Datadog APM + Logging-integrasjon
 * dd-trace instrumenterer automatisk Express, Mongoose, Redis, og HTTP-kall.
 * MÅ lastes før Express/Mongoose/Redis (index.ts importerer denne først).
 *
 * Samme funksjonalitet som før: APM, log-injection, runtime metrics, og i prod
 * profiling + appsec. DD_* (DD_SITE, DD_TRACE_SAMPLE_RATE, DD_PROFILING_ENABLED,
 * DD_APPSEC_ENABLED, DD_TAGS for git repo) leses av dd-trace automatisk.
 */

import tracer from "dd-trace";
import { isProd } from "./utils/env.js";

const ddApiKey = process.env.DD_API_KEY;

if (ddApiKey) {
    try {
        tracer.init({
          service: process.env.DD_SERVICE ?? "studywise-backend",
          env: process.env.DD_ENV ?? process.env.NODE_ENV ?? "development",
          version: process.env.DD_VERSION ?? "0.0.0",
          logInjection: true,
          // runtimeMetrics aktivert — samler V8 heap/GC-metrics, hvis deaktivering sparer ~20-30 MB på Heroku Standard-1x (512 MB).
          runtimeMetrics: true,
          // profiling og appsec styres via DD_PROFILING_ENABLED / DD_APPSEC_ENABLED env-variabler
          // (validateEnv.ts krever disse i produksjon) — ikke hardkodet her for å unngå konflikt
        });
        setImmediate(() => {
            import("./utils/logger.js").then(({ logger }) => {
                logger.info(
                    { site: process.env.DD_SITE ?? "us5.datadoghq.com" },
                    "Datadog APM initialisert",
                );
            });
        });
    } catch (err) {
        setImmediate(() => {
            import("./utils/logger.js").then(({ logger }) => {
                logger.error({ err }, "Datadog tracer.init() feilet — APM deaktivert, server kjører uten");
            });
        });
    }
} else if (isProd) {
    setImmediate(() => {
        import("./utils/logger.js").then(({ logger }) => {
            logger.warn("DD_API_KEY ikke satt — Datadog APM er deaktivert (dette skal normalt stoppes av validateEnv i produksjon)");
        });
    });
}
