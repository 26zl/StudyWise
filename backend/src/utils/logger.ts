/*
* Logger middleware med Pino
*/

import pino from "pino";
import { logBuffer, pinoLevelToString } from "./logBuffer.js";

const isDev = process.env.NODE_ENV !== "production";
const isCI = !!process.env.CI;
const ddEnabled = !!process.env.DD_API_KEY;

// Sensitive nøkler som strippes fra context før logBuffer-lagring.
// (Pino sin redact.paths kjører senere i pipelinen, så her gjør vi en
// lett pre-strip slik at admin-bufferet ikke får rå PII selv om noen
// glemte å passere data via riktig serializer.)
const SENSITIVE_KEYS = new Set([
  "password",
  "passord",
  "token",
  "canvasToken",
  "canvasApiToken",
  "secret",
  "authorization",
  "cookie",
  "email",
  "epost",
  "url",
  "sourceUrl",
  "filnavn",
  "filename",
  // Brukertekst fra chat/RAG-søk — må aldri ende i admin-buffer eller Datadog.
  "queryPreview",
]);

function shallowSanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      // Kun ett nivå dypt — vi vil ikke bruke tid på rekursiv sanitization her
      out[k] = "[object]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

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
    // Tap inn i logBuffer ved hver logg-call så admin-fanen "Logger" kan vise live-tail.
    // Vi sanitiserer lett her — den ekte redaction skjer i pino sin redact-pipeline
    // før output går til stdout/Datadog.
    hooks: {
      logMethod(inputArgs, method, level) {
        try {
          let msg = "";
          let context: Record<string, unknown> | undefined;
          if (typeof inputArgs[0] === "string") {
            msg = inputArgs[0];
          } else if (inputArgs[0] && typeof inputArgs[0] === "object") {
            context = shallowSanitize(inputArgs[0] as Record<string, unknown>);
            if (typeof inputArgs[1] === "string") {
              msg = inputArgs[1];
            }
          }
          logBuffer.push({
            source: "backend",
            level: pinoLevelToString(level),
            msg: msg || "(no message)",
            context: context && Object.keys(context).length > 0 ? context : undefined,
          });
        } catch {
          // Buffer-feil må aldri stoppe logging
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return method.apply(this, inputArgs as any);
      },
    },
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
            "req.body.username",
            "req.query.token",
            "req.query.access_token",
            "req.canvasToken",
            "req.user",
            "res.headers['set-cookie']",
            "userId",
            "email",
            "username",
            "clerkUsername",
            "err.email",
            "err.userId",
            "err.username",
            // Nested token-redaction: fanger tokens i vilkårlig nestet error/context-objekter.
            // Pinos wildcard går kun ett nivå (*) og to (*.*); vi dekker flere nivåer
            // eksplisitt, inkludert Canvas-token som er vanligst i nested error-context.
            "*.token",
            "*.canvasToken",
            "*.canvasApiToken",
            "*.authorization",
            "*.cookie",
            "*.secret",
            "*.*.token",
            "*.*.canvasToken",
            "*.*.canvasApiToken",
            "*.*.authorization",
            // URL-/filnavn-redaction: signerte lenker, query-tokens og PII-aktige
            // filnavn skal aldri ende opp i logger eller Datadog. Vi maskerer hele
            // verdien — bruker logger.info({ urlSafe: stripQuery(url) }, ...) når
            // domenet er trygt å logge.
            "url",
            "urlCandidate",
            "sourceUrl",
            "docUrl",
            "pageUrl",
            "filnavn",
            "filename",
            "fileName",
            "entryName",
            "navn",
            "name",
            "fullName",
            "phone",
            // Brukertekst fra chat/RAG-søk — backstop for alle logger.info/debug-kall.
            "queryPreview",
            "*.queryPreview",
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
