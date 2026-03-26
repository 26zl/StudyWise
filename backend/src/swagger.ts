/*
* Swagger/OpenAPI dokumentasjon for API
*/
import swaggerJsdoc from "swagger-jsdoc";
import { discoverSwaggerPaths } from "./swaggerRouteDiscovery.js";
import { isProd } from "./utils/env.js";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "StudyWise API",
      version: "1.0.0",
      description:
        "STUDYWISE. En KI-basert studieassistent for høyere utdanning med integrasjon mot Canvas Instructure. Bachelor i IT 2026.",
      contact: {
        name: "StudyWise 2026 Gruppe 3",
        email: "gruppe3@studywise.invalid",
      },
    },
    servers: [],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Bruk Clerk Bearer-token for beskyttede API-ruter.",
        },
      },
      schemas: {
        HealthCheck: {
          type: "object",
          properties: {
            ok: {
              type: "boolean",
              example: true,
            },
            timestamp: {
              type: "string",
              format: "date-time",
              example: "2026-01-24T12:00:00.000Z",
            },
          },
        },
        Error: {
          type: "object",
          properties: {
            feil: {
              type: "string",
              example: "Noe gikk galt",
            },
            melding: {
              type: "string",
              example: "Detaljert feilmelding",
            },
          },
        },
      },
    },
  },
  apis: ["./src/rutere/**/*.ts", "./src/index.ts"],
};

const generatedSpec = swaggerJsdoc(options) as { paths?: Record<string, unknown> } & Record<
  string,
  unknown
>;
const generatedPaths = isProd ? {} : discoverSwaggerPaths();

export const swaggerSpec = {
  ...generatedSpec,
  paths: {
    ...(generatedSpec.paths ?? {}),
    ...generatedPaths,
  },
};
