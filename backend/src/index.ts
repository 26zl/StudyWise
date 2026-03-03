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
import { validateEnv } from "./utils/validateEnv.js";
validateEnv();

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
import redisClient, { isRedisReady } from "./cache/redis.js";
import canvasRuter from "./rutere/canvas/canvas.js";
import kiRuter from "./rutere/ki/ki.js";
import brukerAuthRuter from "./rutere/auth/brukerAuth.js";
import taskBreakdownRouter from "./rutere/ki/taskBreakdown.js";
import { kiOppsummeringRouter } from "./rutere/ki/kiOppsummering.js";
import { autentiserJwt, knyttCanvasToken } from "./middleware/auth.js";
import { noCache } from "./middleware/no-cache.js";

// Initialiserer Express app
const app = express();
const startTime = Date.now();
const isProd = process.env.NODE_ENV === "production";

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

// Host header validering i produksjon - blokkerer direkte tilgang via render subdomain
if (isProd) {
  const tillattHost = process.env.API_HOST; // f.eks. "api.studwize.page"
  if (tillattHost) {
    app.use((req, res, next) => {
      const host = req.get("host");
      // Tillat health checks fra Render (ingen host header eller intern IP)
      if (req.path === "/health") return next();
      if (host && !host.includes(tillattHost)) {
        logger.warn({ host, path: req.path }, "Blokkert forespørsel fra ugyldig host");
        return res.status(403).json({ feil: "Forbidden" });
      }
      next();
    });
  }
}

// Sikkerhets-headere via Helmet
// I produksjon: Full CSP aktivert (Swagger er deaktivert)
// I development: CSP deaktivert for Swagger UI
app.use(
  helmet({
    contentSecurityPolicy: isProd ? undefined : false, // Default CSP i prod, deaktivert i dev
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Body parsers
app.use(express.urlencoded({ extended: true }));

// Deaktiverer "X-Powered-By" header for sikkerhet
app.disable("x-powered-by");

// Logger middleware
app.use(pinoHttp({ logger }));

// Gzip komprimering
app.use(compression()); 


// JSON body parser med økt størrelse på 10mb
app.use(express.json({ limit: "10mb" })); 

// Rate Limiting med 100 requests per minutt per IP
const rateLimiter = new RateLimiterMemory({
  points: 100, // 100 forespørsler
  duration: 60, // per 60 sekunder
});
// Middleware for rate limiting
const rateLimiterMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  rateLimiter.consume(req.ip as string)
    .then(() => {
      next();
    })
    .catch(() => {
      res.status(429).json({ error: "For mange forespørsler. Vennligst prøv igjen senere." });
    });
};
// Setter i gang rate limiter middleware
app.use(rateLimiterMiddleware);

// CORS mot frontend - støtter flere origins via WEB_ORIGINS (kommaseparert)
// Faller tilbake til WEB_ORIGIN for bakoverkompatibilitet
const allowedOrigins = new Set(
  (process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

// I produksjon: advar hvis noen origins ikke bruker HTTPS
if (isProd) {
  for (const o of allowedOrigins) {
    if (!o.startsWith("https://")) {
      logger.warn(`ADVARSEL: Origin uten HTTPS i produksjon: ${o}. ` +
        "Dette er usikkert for credentials/cookies.");
    }
  }
}

app.use(
  cors({
    origin: (origin, cb) => {
      // Forespørsler uten origin (curl, same-origin, health checks) tillates
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      return cb(new Error(`CORS blokkert for origin: ${origin}`));
    },
    credentials: true,
  })
);

// Krev JWT for alle endepunkter, bortsett fra innlogging/registrering/health/swagger
// VIKTIG: Dette dekker ALLE ruter montert nedenfor — inkludert /api/ki, /api/canvas og /api/ki/task-breakdown.
// req.user-sjekker inne i rute-filer (f.eks. kiHistory.ts, taskBreakdown.ts) er defensive
// fallbacks, ikke sikkerhetshull. Globalt middleware her er den faktiske porten.
const offentligSti = new Set(["/api/user/login", "/api/user/register", "/api/user/refresh", "/health"]);
app.use((req, res, next) => {
  if (offentligSti.has(req.path)) return next();
  // Tillat Swagger UI (kun i development)
  if (!isProd && req.path.startsWith("/api-docs")) return next();
  return autentiserJwt(req, res, next);
});

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returnerer server helse-status, uptime, avhengigheter og timestamp
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
app.get("/health", (_req, res) => {
  // Sjekk MongoDB-tilkobling
  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  const mongoStatus = mongoose.connection.readyState;
  const mongoOk = mongoStatus === 1;

  // Sjekk Redis-tilkobling
  const redisOk = isRedisReady();

  // Alle kritiske tjenester må være oppe
  const allOk = mongoOk; // Redis er valgfritt, men MongoDB er påkrevd

  const healthResponse = {
    ok: allOk,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    dependencies: {
      mongodb: mongoOk ? "connected" : "disconnected",
      redis: redisOk ? "connected" : "disconnected",
    },
  };

  // Returner 503 hvis kritiske avhengigheter er nede
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
app.use("/api/ki", noCache, knyttCanvasToken, kiRuter);
app.use("/api/ki", noCache, knyttCanvasToken, kiOppsummeringRouter);
app.use("/api/ki/task-breakdown", noCache, taskBreakdownRouter);
app.use("/api/user", brukerAuthRuter);

// Feil håndtering globalt
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Internal Server Error");
  res.status(500).json({ error: "Internal Server Error" });
});

// Start server og kobler til database med Mongoose
const port = process.env.PORT!; // Allerede validert i validateEnv

connectToDatabase()
  .then(() => {
    const server = app.listen(Number(port), () => {
      logger.info(`Express API kjører på http://localhost:${port}`);
    });
  // Graceful shutdown - håndterer SIGTERM/SIGINT for ryddig avslutning
  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, "Mottok shutdown-signal, avslutter gracefully...");
    // Stopp å ta imot nye requests
    server.close(async () => {
      logger.info("HTTP-server lukket");
      try {
        // Lukk database-tilkobling
        await mongoose.connection.close();
        logger.info("MongoDB-tilkobling lukket");
        // Lukk Redis-tilkobling
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

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}).catch((err) => {
  logger.fatal({ err }, "Database connection failed");
  process.exit(1);
});