/*
 * Backend entry point – Express-server.
 * Setter opp middleware, ruter og starter serveren.
 *
 * NB! Serveren kobler til MongoDB ved oppstart (se nederst i filen).
 * Mongoose holder tilkoblingen åpen globalt; importer modellene og bruk dem direkte i ruter.
 */

import "dotenv/config";
import crypto from "crypto";
import { validateEnv } from "./utils/validateEnv.js";
validateEnv();

// Datadog APM — MÅ importeres før Express/Mongoose/Redis for korrekt instrumentering
import "./datadog.js";

import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { pinoHttp } from "pino-http";
import mongoose from "mongoose";
import { swaggerSpec } from "./swagger.js";
import { connectToDatabase } from "./database/database.js";
import { logger } from "./utils/logger.js";
import redisClient, { stopRedisReconnect, isRedisReady } from "./cache/redis.js";
import arbeidsplanRuter from "./rutere/arbeidsplan/arbeidsplan.js";    
import canvasRuter from "./rutere/canvas/canvas.js";  
import kiRuter from "./rutere/ki/ki.js";
import brukerAuthRuter from "./rutere/auth/brukerAuth.js";
import { notionSettingsRouter } from "./rutere/auth/notionSettings.js";
import taskBreakdownRouter from "./rutere/ki/taskBreakdown.js";
import weeklyPlanRouter from "./rutere/ki/weeklyPlan.js";
import { kiOppsummeringRouter } from "./rutere/ki/kiOppsummering.js";
import debugRouter from "./rutere/debug/canvasDiagnostic.js";
import authDiagnosticRouter, {
  testAuthFlowRouter,
} from "./rutere/debug/authDiagnostic.js";
import quizRouter from "./rutere/quiz/quiz.js";
import flashcardsRouter from "./rutere/flashcards/flashcards.js";
import { kiExportRouter } from "./rutere/ki/kiExport.js";
import {
  cleanupExpiredSharedChats,
  SHARE_CLEANUP_INTERVAL_MS,
  sharedChatRouter,
} from "./rutere/ki/kiShare.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requireAuth, knyttCanvasToken } from "./middleware/auth.js";
import { requireRole } from "./middleware/require-role.js";
import adminAuditRouter from "./rutere/admin/adminAudit.js";
import adminBrukereRouter from "./rutere/admin/adminBrukere.js";
import adminStatsRouter from "./rutere/admin/adminStats.js";
import { beskytteMotCsrf } from "./middleware/csrf.js";
import { noCache } from "./middleware/no-cache.js";
import { rateLimitMe } from "./middleware/rate-limit.js";
import { apiError, sendError } from "./utils/apiError.js";
import { requestTimeout } from "./middleware/request-timeout.js";
import {
  getConfiguredWebOriginSet,
  normalizeWebOrigin,
} from "./utils/webOrigins.js";
import { isPublicApiPath } from "./utils/publicApiPaths.js";
import { authTurnstileRouter } from "./rutere/auth/authTurnstile.js";
import {
  getDependenciesHealth,
  getLivenessHealth,
  getReadinessHealth,
  refreshExternalDependencyHealth,
  startExternalDependencyHealthPolling,
} from "./utils/health.js";
import { isClientAvailable } from "./rutere/ki/aiClient.js";
import { isCohereConfigured } from "./services/cohere-rerank.service.js";
import {
  startPendingClerkDeletionPolling,
  processPendingClerkDeletions,
} from "./services/clerkDeletionRetry.service.js";
import {
  startPendingVectorDeletionPolling,
  processPendingVectorDeletions,
} from "./services/vectorDeletionRetry.service.js";
import {
  startWebPushPolling,
  processWebPushNotifications,
} from "./services/webPush.service.js";

// Initialiserer Express app
const app = express();
import { isProd } from "./utils/env.js";

function resolveTrustProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS?.trim();
  if (!raw) {
    return isProd ? 2 : 0;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`TRUST_PROXY_HOPS må være et heltall >= 1, fikk: ${raw}`);
  }

  return parsed;
}

// Global error handlers - fanger uventede feil
process.on("unhandledRejection", (reason, promise) => {
  logger.fatal({ reason, promise }, "Unhandled Promise Rejection - avslutter");
  process.exit(1);
});
// Fanger opp uventede feil som ikke blir fanget andre steder
process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught Exception - avslutter");
  process.exit(1);
});

// Trust proxy må matche faktisk proxy-kjede, ellers blir klient-IP og req.protocol feil.
const trustProxyHops = resolveTrustProxyHops();
app.set("trust proxy", trustProxyHops);
logger.info({ trustProxyHops }, "Express trust proxy konfigurert");

// Host header validering i produksjon - blokkerer direkte tilgang via herokuapp subdomain
// Tillater intern trafikk fra Vercel via INTERNAL_HOSTS (f.eks. Heroku-domenet direkte)
if (isProd) {
  const tillattHost = process.env.API_HOST?.trim().toLowerCase(); // f.eks. "api.studwize.page"
  const internalHosts = new Set(
    (process.env.INTERNAL_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const publicHealthPaths = new Set([
    "/health",
    "/ready",
    "/health/dependencies",
  ]);
  app.use((req, res, next) => {
    const host = req.get("host");
    const requestHost = host?.split(":")[0]?.trim().toLowerCase();
    // Tillat health checks fra Heroku (ingen host header eller intern IP)
    if (publicHealthPaths.has(req.path)) return next();
    if (
      requestHost &&
      requestHost !== tillattHost &&
      !internalHosts.has(requestHost)
    ) {
      logger.warn(
        { host, requestHost, path: req.path },
        "Blokkert forespørsel fra ugyldig host",
      );
      return sendError(res, "forbidden", { feil: "Forbidden" });
    }
    next();
  });
}

// Sikkerhets-headere via Helmet
// I produksjon: Streng CSP for API-responses(Swagger deaktivert)
// I development: Mer liberal, men fortsatt aktiv, CSP for å støtte Swagger UI
app.use(
  helmet({
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'none'"],
            formAction: ["'none'"],
            upgradeInsecureRequests: [],
          },
        }
      : {
          // Liberal CSP for utvikling, slik at Swagger UI og andre verktøy fungerer
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'self'"],
          },
        },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Body parsers
app.use(express.urlencoded({ extended: true }));

// Deaktiverer "X-Powered-By" header for sikkerhet
app.disable("x-powered-by");

// Request ID for correlation (logs + audit)
app.use(requestIdMiddleware);

// Logger-middleware (bruker req.id fra requestIdMiddleware for korrelasjon)
app.use(
  pinoHttp({
    logger,
    genReqId: (req) =>
      (req as express.Request & { id?: string }).id ?? crypto.randomUUID(),
  }),
);

// Gzip komprimering — skip SSE responses (text/event-stream) to prevent buffering
app.use(
  compression({
    filter: (req, res) => {
      if (res.getHeader("Content-Type") === "text/event-stream") {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

// Clerk Webhook — monteres FØR JSON body parser fordi signaturverifisering krever rå body.
// Også før CSRF og auth da Clerk ikke sender disse headerne.
import { clerkWebhookRouter } from "./rutere/auth/clerkWebhook.js";
app.use(
  "/api/clerk-webhook",
  express.raw({ type: "application/json" }),
  clerkWebhookRouter,
);

// JSON body parser med økt størrelse på 10mb
app.use(express.json({ limit: "10mb" }));

// Request timeout — forhindrer at trege eksterne API-kall tømmer server-ressurser
app.use(requestTimeout);

// CORS mot frontend - WEB_ORIGINS er én sannhetskilde for tillatte origins.
const allowedOrigins = getConfiguredWebOriginSet();

// I produksjon: advar hvis noen origins ikke bruker HTTPS
if (isProd) {
  for (const o of allowedOrigins) {
    if (!o.startsWith("https://")) {
      logger.warn(
        `ADVARSEL: Origin uten HTTPS i produksjon: ${o}. ` +
          "Dette er usikkert for credentials/cookies.",
      );
    }
  }
}

// Avvis ugyldige cross-origin requests eksplisitt før cors()-middleware.
// Ellers kaster cors() en feil som ender som generisk 500 i global error-handler.
app.use((req, res, next) => {
  const origin = req.get("origin");
  const normalizedOrigin = normalizeWebOrigin(origin);
  const host = req.get("host");
  const backendOrigin = host
    ? normalizeWebOrigin(`${req.protocol}://${host}`)
    : null;

  if (
    !origin ||
    (normalizedOrigin !== null && allowedOrigins.has(normalizedOrigin)) ||
    (backendOrigin !== null && normalizedOrigin === backendOrigin)
  ) {
    return next();
  }

  logger.warn(
    { origin, path: req.path, method: req.method },
    "Blokkert forespørsel fra ugyldig CORS-origin",
  );
  return sendError(res, "validation_error", {
    status: 403,
    feil: "Forbidden",
    melding: "Ugyldig origin for foresporselen.",
  });
});

app.use(
  cors({
    origin: (origin, cb) => {
      // Forespørsler uten origin (curl, same-origin, health checks) tillates
      if (!origin) return cb(null, true);
      const normalizedOrigin = normalizeWebOrigin(origin);
      return cb(
        null,
        normalizedOrigin !== null && allowedOrigins.has(normalizedOrigin),
      );
    },
    credentials: true,
  }),
);

// CSRF: krev x-studywise-csrf + gyldig origin/referer for POST/PUT/PATCH/DELETE (se middleware/csrf.ts).
app.use(beskytteMotCsrf);

// Clerk-only auth: protected routes require Authorization: Bearer <clerk_session_token>
const offentligSti = new Set(["/health", "/ready", "/health/dependencies"]);

// Offentlige API-ruter (monteres FØR auth-middleware)
import { contactRouter } from "./rutere/contact/contact.js";
app.use("/api/kontakt", noCache, contactRouter);
app.use("/api/auth-turnstile", noCache, authTurnstileRouter);

app.use("/api", noCache, sharedChatRouter);

// Debug test-auth-flow: montert før global auth (endepunktet sjekker selv isDiagnosticsEnabled)
if (!isProd) {
  app.use("/api/debug", noCache, testAuthFlowRouter);
}

app.use((req, res, next) => {
  if (offentligSti.has(req.path)) return next();
  if (isPublicApiPath(req.path, req.method)) return next();
  if (!isProd && req.path.startsWith("/api-docs")) return next();
  return requireAuth(req, res, next);
});

// /health = liveness. Skal være lett, rask og ikke slå eksternt opp.
app.get("/health", (_req, res) => {
  return res.json(getLivenessHealth());
});

// /ready = readiness. Mongo er kritisk for å kunne ta trafikk.
app.get("/ready", (_req, res) => {
  const readiness = getReadinessHealth();
  if (!readiness.ok) {
    return res.status(503).json(readiness);
  }

  return res.json(readiness);
});

// /health/dependencies = status for eksterne og ikke-kritiske avhengigheter.
app.get("/health/dependencies", (_req, res) => {
  return res.json(getDependenciesHealth());
});

// API dokumentasjon (Swagger UI) - kun i development
if (!isProd) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  logger.info("Swagger UI tilgjengelig på /api-docs (kun development)");
}

// Ulike API ruter defineres her
// noCache hindrer at sensitive data caches i nettleseren etter utlogging
app.use("/api/canvas", noCache, knyttCanvasToken, canvasRuter);
app.use("/api/ki", noCache, kiRuter);
app.use("/api/ki", noCache, kiOppsummeringRouter);
app.use("/api/ki/task-breakdown", noCache, taskBreakdownRouter);
app.use("/api/ki/weekly-plan", noCache, weeklyPlanRouter);
app.use("/api/ki", noCache, kiExportRouter);
app.use("/api/user", brukerAuthRuter);
app.use("/api/user", notionSettingsRouter);
app.use("/api/arbeidsplan", noCache, arbeidsplanRuter);
app.use("/api/quiz", noCache, quizRouter);
app.use("/api/flashcards", noCache, flashcardsRouter);

// Admin: krever requireAuth (allerede kjørt) + requireRole("admin")
app.use("/api/admin", rateLimitMe, requireRole("admin"), adminAuditRouter);
app.use("/api/admin", rateLimitMe, requireRole("admin"), adminBrukereRouter);
app.use("/api/admin", rateLimitMe, requireRole("admin"), adminStatsRouter);

// Debug-ruter (kun development, krever auth)
if (!isProd) {
  app.use("/api/debug", noCache, knyttCanvasToken, debugRouter);
  app.use("/api/debug", noCache, authDiagnosticRouter);
}

// Feil håndtering globalt
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    logger.error({ err }, "Internal Server Error");
    apiError.serverError(res);
  },
);

// Start server og kobler til database med Mongoose
const port = process.env.PORT!; // Allerede validert i validateEnv

connectToDatabase()
  .then(async () => {
    // Oppstart-status for tjenester (MongoDB allerede logget i connectToDatabase)
    if (isRedisReady()) {
      logger.info("Redis tilgjengelig");
    } else {
      logger.warn("Redis ikke tilkoblet ved oppstart (reconnect pågår)");
    }
    const dependencyHealth = await refreshExternalDependencyHealth();
    if (dependencyHealth.clerk) {
      logger.info("Clerk tilgjengelig");
    } else {
      logger.warn("Clerk ikke tilgjengelig ved oppstart");
    }
    if (dependencyHealth.pinecone) {
      logger.info("Pinecone tilgjengelig");
    } else {
      logger.warn("Pinecone ikke tilgjengelig ved oppstart");
    }
    if (isClientAvailable("")) {
      logger.info("Anthropic (Claude) tilgjengelig");
    } else {
      logger.warn("Anthropic ikke tilgjengelig ved oppstart");
    }
    if (isCohereConfigured()) {
      logger.info("Cohere tilgjengelig");
    } else {
      logger.warn("Cohere ikke tilgjengelig ved oppstart");
    }
    const dependencyHealthInterval = startExternalDependencyHealthPolling();
    const clerkDeletionRetryInterval = startPendingClerkDeletionPolling();
    const vectorDeletionRetryInterval = startPendingVectorDeletionPolling();
    const webPushInterval = startWebPushPolling();

    void processPendingClerkDeletions().catch((error) => {
      logger.warn({ err: error }, "Initial retry av ventende Clerk-slettinger feilet");
    });
    void processPendingVectorDeletions().catch((error) => {
      logger.warn({ err: error }, "Initial retry av ventende vektor-slettinger feilet");
    });
    void processWebPushNotifications().catch((error) => {
      logger.warn({ err: error }, "Initial web-push-sjekk feilet");
    });

    void cleanupExpiredSharedChats({ reason: "scheduled_cleanup" }).catch((error) => {
      logger.warn({ err: error }, "Initial cleanup av utløpte delinger feilet");
    });

    const shareCleanupInterval = setInterval(() => {
      void cleanupExpiredSharedChats({ reason: "scheduled_cleanup" }).catch((error) => {
        logger.warn({ err: error }, "Periodisk cleanup av utløpte delinger feilet");
      });
    }, SHARE_CLEANUP_INTERVAL_MS);
    shareCleanupInterval.unref?.();

    const server = app.listen(Number(port), () => {
      logger.info({ port: Number(port) }, "Express API startet");
    });
    // Graceful shutdown - håndterer SIGTERM/SIGINT for ryddig avslutning
    const gracefulShutdown = async (signal: string) => {
      logger.info(
        { signal },
        "Mottok shutdown-signal, avslutter gracefully...",
      );
      // Stopp å ta imot nye requests
      server.close(async () => {
        logger.info("HTTP-server lukket");
        try {
          clearInterval(dependencyHealthInterval);
          clearInterval(shareCleanupInterval);
          if (clerkDeletionRetryInterval) clearInterval(clerkDeletionRetryInterval);
          if (vectorDeletionRetryInterval) clearInterval(vectorDeletionRetryInterval);
          if (webPushInterval) clearInterval(webPushInterval);
          // Lukk database-tilkobling
          await mongoose.connection.close();
          logger.info("MongoDB-tilkobling lukket");
          // Stopp Redis reconnect-forsøk og lukk tilkobling
          stopRedisReconnect();
          if (redisClient.isOpen) {
            await redisClient.quit();
            logger.info("Redis-tilkobling lukket");
          }
          logger.info("Graceful shutdown fullført");
          process.exit(0);
        } catch (error) {
          logger.error({ err: error }, "Feil under shutdown");
          process.exit(1);
        }
      });
      // Force exit etter 10 sekunder hvis graceful shutdown tar for lang tid
      const shutdownTimeout = setTimeout(() => {
        logger.warn("Graceful shutdown tok for lang tid, tvinger avslutning");
        process.exit(1);
      }, 10000);
      shutdownTimeout.unref();
    };
    // Håndterer SIGTERM og SIGINT for graceful shutdown
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  })
  .catch((err) => {
    logger.fatal({ err }, "Database connection failed");
    process.exit(1);
  });
