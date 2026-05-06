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

// Undici global dispatcher — connection pooling for alle fetch()-kall
import "./utils/httpAgent.js";

import express, { Router } from "express";
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
import authDiagnosticRouter, { testAuthFlowRouter } from "./rutere/debug/authDiagnostic.js";
import quizRouter from "./rutere/quiz/quiz.js";
import quizLagretRouter from "./rutere/quiz/quizLagret.js";
import flashcardsRouter from "./rutere/flashcards/flashcards.js";
import flashcardsLagretRouter from "./rutere/flashcards/flashcardsLagret.js";
import knowledgeBaseRouter from "./rutere/kunnskapsbase/kunnskapsbase.js";
import { kiExportRouter } from "./rutere/ki/kiExport.js";
import {
  cleanupExpiredSharedChats,
  SHARE_CLEANUP_INTERVAL_MS,
  sharedChatRouter,
} from "./rutere/ki/kiShare.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requireAuth, knyttCanvasToken } from "./middleware/auth.js";
import { requireAcceptedTerms } from "./middleware/requireAcceptedTerms.js";
import { requireRole } from "./middleware/require-role.js";
import adminAuditRouter from "./rutere/admin/adminAudit.js";
import adminBrukereRouter from "./rutere/admin/adminBrukere.js";
import adminStatsRouter from "./rutere/admin/adminStats.js";
import adminQueuesRouter from "./rutere/admin/adminQueues.js";
import adminRedisRouter from "./rutere/admin/adminRedis.js";
import adminExtractionRouter from "./rutere/admin/adminExtraction.js";
import adminLangsmithRouter from "./rutere/admin/adminLangsmith.js";
import adminContactRouter from "./rutere/admin/adminContact.js";
import adminLogsRouter from "./rutere/admin/adminLogs.js";
import adminMaintenanceRouter from "./rutere/admin/adminMaintenance.js";
import adminCrawlerRouter from "./rutere/admin/adminCrawler.js";
import adminAiDebugRouter from "./rutere/admin/adminAiDebug.js";
import { adminAnnouncementRouter } from "./rutere/admin/adminAnnouncement.js";
import { announcementRouter } from "./rutere/announcement.js";
import { publicStatusRouter } from "./rutere/publicStatus.js";
import { beskytteMotCsrf } from "./middleware/csrf.js";
import { noCache } from "./middleware/no-cache.js";
import { rateLimitMe } from "./middleware/rate-limit.js";
import { requireCloudflare } from "./middleware/cloudflare-only.js";
import { apiError, sendError } from "./utils/apiError.js";
import { requestTimeout } from "./middleware/request-timeout.js";
import { getConfiguredWebOriginSet, normalizeWebOrigin } from "./utils/webOrigins.js";
import { isPublicApiPath } from "./utils/publicApiPaths.js";
import { authTurnstileRouter } from "./rutere/auth/authTurnstile.js";
import {
  getDependenciesHealth,
  getLivenessHealth,
  getReadinessHealth,
  refreshExternalDependencyHealth,
  startExternalDependencyHealthPolling,
} from "./utils/health.js";
import {
  startChatHistoryCleanupPolling,
  sweepCorruptedChatHistory,
} from "./services/chatHistoryCleanup.service.js";
import { startQueueWorkers, stopQueueWorkers } from "./queues/index.js";
import { startWebPushPolling, processWebPushNotifications } from "./services/webPush.service.js";

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

function shouldExitOnUnhandledRejection(): boolean {
  const raw = process.env.EXIT_ON_UNHANDLED_REJECTION?.trim().toLowerCase();
  if (!raw) {
    // I produksjon holder vi fail-fast som default; lokalt prioriteres robust dev-loop.
    return isProd;
  }

  return raw === "1" || raw === "true" || raw === "yes";
}

// Global error handlers - fanger uventede feil
process.on("unhandledRejection", (reason, promise) => {
  const exitOnUnhandledRejection = shouldExitOnUnhandledRejection();
  logger.fatal({ reason, promise, exitOnUnhandledRejection }, "Unhandled Promise Rejection");

  if (exitOnUnhandledRejection) {
    logger.fatal("Avslutter prosess pga unhandled rejection");
    process.exit(1);
  }

  logger.error("Fortsetter prosess etter unhandled rejection (dev-mode)");
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
  // Kun ren liveness/readiness — /health/dependencies er admin-only og må gå via normal host
  const publicHealthPaths = new Set(["/health", "/ready"]);
  app.use((req, res, next) => {
    const host = req.get("host");
    const requestHost = host?.split(":")[0]?.trim().toLowerCase();
    // Tillat health checks fra Heroku (ingen host header eller intern IP)
    if (publicHealthPaths.has(req.path)) return next();
    if (requestHost && requestHost !== tillattHost && !internalHosts.has(requestHost)) {
      logger.warn({ host, requestHost, path: req.path }, "Blokkert forespørsel fra ugyldig host");
      return sendError(res, "forbidden", { feil: "Forbidden" });
    }
    next();
  });

  // Cloudflare-only enforcement: peer-IP fra siste X-Forwarded-For-hop må være i Cloudflare-range og
  // CF-Connecting-IP-header må være satt. Forhindrer Heroku-direct WAF bypass
  // (ref. pentest F-14). Aktiveres når ENFORCE_CLOUDFLARE_ONLY=true.
  if (process.env.ENFORCE_CLOUDFLARE_ONLY === "true") {
    app.use(requireCloudflare);
    logger.info("Cloudflare-only enforcement aktivert");
  }
}

// Sikkerhets-headere via Helmet
// I produksjon: Streng CSP for API-responses(Swagger deaktivert)
// I development: Mer liberal, men fortsatt aktiv, CSP for å støtte Swagger UI
app.use(
  helmet({
    hsts: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
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
    genReqId: (req) => (req as express.Request & { id?: string }).id ?? crypto.randomUUID(),
  }),
);

// Gzip-komprimering — hopp over SSE-responser (text/event-stream) for å unngå buffering.
// Content-Type kan inneholde charset-suffix ("text/event-stream; charset=utf-8"),
// så vi matcher på prefiks i stedet for streng likhet. Ellers ble brotli-buffer
// holdt tilbake på keepalives og klienten timeouter (Heroku H15).
app.use(
  compression({
    filter: (req, res) => {
      const contentType = res.getHeader("Content-Type");
      if (typeof contentType === "string" && contentType.startsWith("text/event-stream")) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

// Clerk Webhook — monteres FØR JSON body parser fordi signaturverifisering krever rå body.
// Også før CSRF og auth da Clerk ikke sender disse headerne.
import { clerkWebhookRouter } from "./rutere/auth/clerkWebhook.js";
app.use("/api/clerk-webhook", express.raw({ type: "application/json" }), clerkWebhookRouter);

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
  const backendOrigin = host ? normalizeWebOrigin(`${req.protocol}://${host}`) : null;

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
      return cb(null, normalizedOrigin !== null && allowedOrigins.has(normalizedOrigin));
    },
    credentials: true,
  }),
);

// CSRF: krev x-studywise-csrf + gyldig origin/referer for POST/PUT/PATCH/DELETE (se middleware/csrf.ts).
app.use(beskytteMotCsrf);

// Kun Clerk-auth: beskyttede ruter krever Authorization: Bearer <clerk_session_token>
const offentligSti = new Set(["/health", "/ready"]);

// Offentlige API-ruter (monteres FØR auth-middleware)
import { contactRouter } from "./rutere/contact/contact.js";
app.use("/api/kontakt", noCache, contactRouter);
app.use("/api/auth-turnstile", noCache, authTurnstileRouter);

app.use("/api", noCache, sharedChatRouter);

// Public status-endepunkt: brukes av /status-siden i footer, tilgjengelig uten
// innlogging slik at brukere kan sjekke om tjenesten er nede før de prøver å
// logge inn. Cachet i Redis (30s TTL), rate-limited per IP.
app.use("/api", noCache, publicStatusRouter);

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

// Håndhev aksept av gjeldende vilkår/personvern. Kjøres etter requireAuth slik
// at vi har tilgang til req.authenticatedUser. Allowlister /me, /accept-terms,
// /logout, DELETE /account og /announcement; alt annet returnerer 403
// `terms_outdated` for brukere med utdatert versjon. Forsøk audit-logges.
app.use(requireAcceptedTerms);

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
// Krever admin-rolle for å unngå å lekke intern driftsinformasjon.
app.get("/health/dependencies", requireRole("admin"), (_req, res) => {
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
app.use("/api/user", noCache, brukerAuthRuter);
app.use("/api/user", noCache, notionSettingsRouter);
app.use("/api", noCache, announcementRouter);
app.use("/api/arbeidsplan", noCache, arbeidsplanRuter);
app.use("/api/quiz/lagrede", noCache, quizLagretRouter);
app.use("/api/quiz", noCache, quizRouter);
app.use("/api/flashcards/lagrede", noCache, flashcardsLagretRouter);
app.use("/api/flashcards", noCache, flashcardsRouter);
app.use("/api/kb", noCache, knowledgeBaseRouter);

// Admin: krever requireAuth (allerede kjørt) + requireRole("admin") + noCache
// fordi svarene inneholder sensitiv drifts-, bruker- og revisjonsdata.
// Alle admin-routere monteres under én felles app.use() slik at middleware
// (spesielt rateLimitMe) kun kjøres én gang per request.
{
  const adminRouter = Router();
  adminRouter.use(adminAuditRouter);
  adminRouter.use(adminBrukereRouter);
  adminRouter.use(adminStatsRouter);
  adminRouter.use(adminQueuesRouter);
  adminRouter.use(adminRedisRouter);
  adminRouter.use(adminExtractionRouter);
  adminRouter.use(adminLangsmithRouter);
  adminRouter.use(adminContactRouter);
  adminRouter.use(adminLogsRouter);
  adminRouter.use(adminMaintenanceRouter);
  adminRouter.use(adminCrawlerRouter);
  adminRouter.use(adminAiDebugRouter);
  adminRouter.use(adminAnnouncementRouter);
  app.use("/api/admin", noCache, rateLimitMe, requireRole("admin"), adminRouter);
}

// Debug-ruter (kun development, krever auth)
if (!isProd) {
  app.use("/api/debug", noCache, knyttCanvasToken, debugRouter);
  app.use("/api/debug", noCache, authDiagnosticRouter);
}

// 404-handler: ukjente ruter returnerer konsistent JSON i stedet for Express sin default HTML.
// Må stå etter alle ruter, men før den globale error handleren.
app.use((req, res) => {
  logger.warn({ method: req.method, url: req.originalUrl }, "Ukjent rute (404)");
  apiError.notFound(res, "Endepunkt");
});

// Feil håndtering globalt
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Internal Server Error");
  apiError.serverError(res);
});

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
    if (dependencyHealth.anthropic) {
      logger.info("Anthropic (Claude) tilgjengelig");
    } else {
      logger.warn("Anthropic ikke tilgjengelig ved oppstart");
    }
    if (dependencyHealth.cohere) {
      logger.info("Cohere tilgjengelig");
    } else {
      logger.warn("Cohere ikke tilgjengelig ved oppstart");
    }
    const dependencyHealthInterval = startExternalDependencyHealthPolling();
    const chatHistoryCleanupInterval = startChatHistoryCleanupPolling();
    void sweepCorruptedChatHistory().catch((err) => {
      logger.warn({ err }, "Initial ChatHistory-cleanup feilet");
    });
    // BullMQ workers (Clerk-sletting + Pinecone-cleanup + web-push) erstatter de tidligere
    // MongoDB-baserte polling-løkkene. Migrerer ev. eksisterende pending-rader på oppstart.
    //
    // Gjenopprettingsløkke: hvis Redis/BullMQ er nede ved oppstart, prøver vi på nytt
    // med backoff slik at køer + web-push polling kommer i gang når Redis er tilbake
    // — uten å kreve restart av hele API-et.
    const queueState: {
      started: boolean;
      webPushInterval: ReturnType<typeof setInterval> | null;
      retryTimeout: ReturnType<typeof setTimeout> | null;
    } = {
      started: false,
      webPushInterval: null,
      retryTimeout: null,
    };

    const startQueuesWithRetry = async (attempt: number): Promise<void> => {
      try {
        await startQueueWorkers();
        queueState.started = true;
        logger.info(
          { attempt },
          attempt === 1 ? "BullMQ-workers startet" : "BullMQ-workers startet etter retry",
        );
        queueState.webPushInterval = startWebPushPolling();
        void processWebPushNotifications().catch((error) => {
          logger.warn({ err: error }, "Initial web-push-sjekk feilet");
        });
      } catch (error) {
        // 30s for første 5 forsøk, deretter 5 min. Fortsetter i det uendelige
        // (unref'et timer) slik at køene kommer opp når Redis er tilbake.
        const delayMs = attempt < 5 ? 30_000 : 5 * 60_000;
        logger.error(
          { err: error, attempt, nextRetryMs: delayMs },
          "BullMQ-workers kunne ikke starte; prøver igjen automatisk",
        );
        queueState.retryTimeout = setTimeout(() => {
          queueState.retryTimeout = null;
          void startQueuesWithRetry(attempt + 1);
        }, delayMs);
        queueState.retryTimeout.unref?.();
      }
    };

    await startQueuesWithRetry(1);
    if (!queueState.started) {
      logger.warn("Web-push polling utsatt til BullMQ er tilgjengelig");
    }

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
      logger.info({ signal }, "Mottok shutdown-signal, avslutter gracefully...");
      // Stopp å ta imot nye requests
      server.close(async () => {
        logger.info("HTTP-server lukket");
        try {
          clearInterval(dependencyHealthInterval);
          clearInterval(shareCleanupInterval);
          clearInterval(chatHistoryCleanupInterval);
          if (queueState.retryTimeout) clearTimeout(queueState.retryTimeout);
          if (queueState.webPushInterval) clearInterval(queueState.webPushInterval);
          // Steng BullMQ workers + Redis-tilkobling
          await stopQueueWorkers();
          logger.info("BullMQ-workers stoppet");
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
