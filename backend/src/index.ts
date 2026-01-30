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
import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { pinoHttp } from "pino-http";
import { swaggerSpec } from "./swagger.js";
import { connectToDatabase } from "./database/database.js";
import { logger } from "./utils/logger.js";
import "./cache/redis.js";
import canvasRuter from "./rutere/canvas/canvas.js";
import kiRuter from "./rutere/ki/ki.js";
import brukerAuthRuter from "./rutere/auth/brukerAuth.js";
import { autentiserJwt, knyttCanvasToken } from "./middleware/auth.js";
import { noCache } from "./middleware/no-cache.js";

// Initialiserer Express app
const app = express();
const startTime = Date.now();

// Trust proxy for korrekt IP-håndtering bak proxyer (f.eks. ved bruk av Heroku, Vercel, eller Nginx)
app.set("trust proxy", 1);

// Sikkerhets-headere via Helmet (lett konfigurert for å ikke blokkere Canvas/KI/Swagger UI)
app.use(
  helmet({
    contentSecurityPolicy: false,
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

// CORS kun mot frontend
const webOrigin = process.env.WEB_ORIGIN;
if (!webOrigin) {
  logger.error("Mangler WEB_ORIGIN i .env");
  process.exit(1);
}

// CORS konfigurasjon
app.use(
  cors({
    origin: webOrigin,
    credentials: true,
  })
);

// Krev JWT for alle endepunkter, bortsett fra innlogging/registrering/health
const offentligSti = new Set(["/api/user/login", "/api/user/register", "/api/user/refresh", "/health"]);
app.use((req, res, next) => {
  if (offentligSti.has(req.path)) return next();
  return autentiserJwt(req, res, next);
});

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returnerer server helse-status, uptime og timestamp
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Server er oppe og kjører
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthCheck'
 */
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

// API dokumentasjon (Swagger UI)
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Ulike API ruter defineres her
// noCache hindrer at sensitive data caches i nettleseren etter utlogging
app.use("/api/canvas", noCache, knyttCanvasToken, canvasRuter);
app.use("/api/ki", noCache, kiRuter);
app.use("/api/user", brukerAuthRuter);

// Feil håndtering globalt
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, "Internal Server Error");
  res.status(500).json({ error: "Internal Server Error" });
});

// Start server og kobler til database med Mongoose
const port = process.env.PORT;
if (!port) {
  logger.error("Mangler PORT i .env");
  process.exit(1);
}
connectToDatabase().then(() => {
  app.listen(Number(port), () => {
    logger.info(`Express API kjører på http://localhost:${port}`);
  });
});