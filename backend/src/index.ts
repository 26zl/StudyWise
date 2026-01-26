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
import swaggerUi from "swagger-ui-express";
import { pinoHttp } from "pino-http";
import { swaggerSpec } from "./swagger.js";
import { connectToDatabase } from "./database/database.js";
import { logger } from "./middleware/logger.js";
import "./cache/redis.js";
import canvasRuter from "./rutere/canvas/canvas.js";
import authRuter from "./rutere/auth/auth.js";
import kiRuter from "./rutere/ki/ki.js";

const app = express();
const startTime = Date.now();

app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));

app.disable("x-powered-by");

app.use(pinoHttp({ logger }));

app.use(compression());

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

// Health check
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
app.use("/api/auth", authRuter);
app.use("/api/canvas", canvasRuter);
app.use("/api/ki", kiRuter);

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