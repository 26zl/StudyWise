/*
* Backend entry point for Express serveren.
* Fungerer på samme måte som app.js i backend i tidligere prosjekter.
* Setter opp middleware, andre ulike funksjoner, ruter og starter serveren.
*
* NB! Serveren kobler til MongoDB ved oppstart (se nederst i filen).
* Mongoose holder denne tilkoblingen åpen globalt, så du trenger IKKE koble til
* databasen på nytt i rute-filene dine. Bare importer modellene og bruk dem direkte.
*/

import "dotenv/config";
import crypto from "crypto";
import { validateEnv } from "./utils/validateEnv.js";
validateEnv();

// Datadog APM — MÅ importeres før Express/Mongoose/Redis for korrekt instrumentering
import "./datadog.js";

import express from "express";
import cors from "cors";
import { RateLimiterMemory } from "rate-limiter-flexible";
import compression from "compression";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { pinoHttp } from "pino-http";
import mongoose from "mongoose";
import { swaggerSpec } from "./swagger.js";
import { connectToDatabase } from "./database/database.js";
import { logger } from "./utils/logger.js";
import redisClient, { stopRedisReconnect, isRedisReady } from "./cache/redis.js";
import { isClientAvailable } from "./rutere/ki/aiClient.js";
import { isClerkHealthy } from "./rutere/auth/clerkAuth.js";
import { ensurePineconeIndex } from "./services/pinecone.service.js";
import arbeidsplanRuter from "./rutere/arbeidsplan/arbeidsplan.js";    
import canvasRuter from "./rutere/canvas/canvas.js";  
import kiRuter from "./rutere/ki/ki.js";
import brukerAuthRuter from "./rutere/auth/brukerAuth.js";
import taskBreakdownRouter from "./rutere/ki/taskBreakdown.js";
import weeklyPlanRouter from "./rutere/ki/weeklyPlan.js";
import { kiOppsummeringRouter } from "./rutere/ki/kiOppsummering.js";
import debugRouter from "./rutere/debug/canvasDiagnostic.js";
import {
  cleanupExpiredSharedChats,
  SHARE_CLEANUP_INTERVAL_MS,
  sharedChatRouter,
} from "./rutere/ki/kiShare.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { requireAuth, knyttCanvasToken } from "./middleware/auth.js";
import { requireRole } from "./middleware/require-role.js";
import adminAuditRouter from "./rutere/roller/admin/adminAudit.js";
import { beskytteMotCsrf } from "./middleware/csrf.js";
import { noCache } from "./middleware/no-cache.js";
import { apiError, sendError } from "./utils/apiError.js";
import { requestTimeout } from "./middleware/request-timeout.js";
import { getConfiguredWebOriginSet, normalizeWebOrigin } from "./utils/webOrigins.js";

// Initialiserer Express app
const app = express();
import { isProd } from "./utils/env.js";

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

// Trust proxy for korrekt IP-håndtering bak proxyer (f.eks. ved bruk av Heroku, Vercel, eller Nginx)
app.set("trust proxy", 1);

// Host header validering i produksjon - blokkerer direkte tilgang via herokuapp subdomain
if (isProd) {
  const tillattHost = process.env.API_HOST?.trim().toLowerCase(); // f.eks. "api.studwize.page"
  if (tillattHost) {
    app.use((req, res, next) => {
      const host = req.get("host");
      const requestHost = host?.split(":")[0]?.trim().toLowerCase();
      // Tillat health checks fra Heroku (ingen host header eller intern IP)
      if (req.path === "/health") return next();
      if (requestHost && requestHost !== tillattHost) {
        logger.warn(
          { host, requestHost, path: req.path },
          "Blokkert forespørsel fra ugyldig host",
        );
        return sendError(res, "forbidden", { feil: "Forbidden" });
      }
      next();
    });
  }
}

// Sikkerhets-headere via Helmet
// I produksjon: Streng CSP for API-responses(Swagger deaktivert)
// I development: CSP deaktivert for Swagger UI
app.use(
  helmet({
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
      : false,
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

// Logger middleware (uses req.id from requestIdMiddleware for correlation)
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => (req as express.Request & { id?: string }).id ?? crypto.randomUUID(),
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

// JSON body parser med økt størrelse på 10mb
app.use(express.json({ limit: "10mb" }));

// Rate limiting: 300 req/min per IP – tåler hyppige SSR-/klientkall til /me uten å åpne for misbruk
const rateLimiter = new RateLimiterMemory({
  points: 300,
  duration: 60,
});
// Middleware for rate limiting
const rateLimiterMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction, 
) => {
  rateLimiter
    .consume(req.ip ?? req.socket?.remoteAddress ?? "unknown")
    .then(() => {
      next();
    })
    .catch(() => {
      return apiError.rateLimited(res, "Vennligst prøv igjen senere.");
    });
};
// Setter i gang rate limiter middleware
app.use(rateLimiterMiddleware);

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
      return cb(null, normalizedOrigin !== null && allowedOrigins.has(normalizedOrigin));
    },
    credentials: true,
  }),
);

// CSRF: krev x-studywise-csrf + gyldig origin/referer for POST/PUT/PATCH/DELETE (se middleware/csrf.ts).
app.use(beskytteMotCsrf);

// Clerk-only auth: protected routes require Authorization: Bearer <clerk_session_token>
const offentligSti = new Set(["/health"]);

app.use("/api", noCache, sharedChatRouter);
app.use((req, res, next) => {
  if (offentligSti.has(req.path)) return next();
  if (req.path.startsWith("/api/shared/") && req.method === "GET") return next();
  if (!isProd && req.path.startsWith("/api-docs")) return next();
  return requireAuth(req, res, next);
});

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returnerer minimal server helse-status og timestamp
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Server er oppe og kjører
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheck'
 *       503:
 *         description: Server er oppe, men kritiske avhengigheter er nede
 */
// Health check med status for alle avhengigheter.
// Kun MongoDB er kritisk (gir 503). Øvrige (Redis, Anthropic, Clerk, Pinecone) er degradert ved feil (gir 200 med degraded).
// Canvas er per-bruker og inkluderes ikke i server-health.
app.get("/health", async (_req, res) => {
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const mongoOk = mongoose.connection.readyState === 1;
  const redisOk = isRedisReady();
  const anthropicOk = isClientAvailable("");

  const [clerkOk, pineconeOk] = await Promise.all([
    isClerkHealthy(),
    ensurePineconeIndex(),
  ]);

  // MongoDB er kritisk — uten den fungerer ingenting
  const allOk = mongoOk;

  const healthResponse: Record<string, unknown> = {
    ok: allOk,
    timestamp: new Date().toISOString(),
  };

  const degraded: string[] = [];
  if (!redisOk) degraded.push("redis");
  if (!anthropicOk) degraded.push("anthropic");
  if (!clerkOk) degraded.push("clerk");
  if (!pineconeOk) degraded.push("pinecone");
  if (degraded.length > 0) {
    healthResponse.degraded = degraded;
  }

  if (!allOk) {
    return res.status(503).json(healthResponse);
  }

  return res.json(healthResponse);
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
app.use("/api/user", brukerAuthRuter);
app.use("/api/arbeidsplan", noCache, arbeidsplanRuter);

// Admin: krever requireAuth (allerede kjørt) + requireRole("admin")
app.use("/api/admin", requireRole("admin"), adminAuditRouter);

// Debug-ruter (kun development, krever auth)
if (!isProd) {
  app.use("/api/debug", noCache, knyttCanvasToken, debugRouter);
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
    try {
      if (await isClerkHealthy()) {
        logger.info("Clerk tilgjengelig");
      } else {
        logger.warn("Clerk ikke tilgjengelig ved oppstart");
      }
    } catch (err) {
      logger.warn({ err }, "Clerk-sjekk feilet ved oppstart");
    }
    try {
      await ensurePineconeIndex();
      logger.info("Pinecone tilgjengelig");
    } catch (err) {
      logger.warn({ err }, "Pinecone ikke tilgjengelig ved oppstart");
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
      logger.info(
        { signal },
        "Mottok shutdown-signal, avslutter gracefully...",
      );
      // Stopp å ta imot nye requests
      server.close(async () => {
        logger.info("HTTP-server lukket");
        try {
          clearInterval(shareCleanupInterval);
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
      setTimeout(() => {
        logger.warn("Graceful shutdown tok for lang tid, tvinger avslutning");
        process.exit(1);
      }, 10000);
    };
    // Håndterer SIGTERM og SIGINT for graceful shutdown
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  })
  .catch((err) => {
    logger.fatal({ err }, "Database connection failed");
    process.exit(1);
  });
