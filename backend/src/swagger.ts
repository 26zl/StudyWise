/*
* Swagger/OpenAPI dokumentasjon for API
*/
import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "StudyWise API",
      version: "1.0.0",
      description: "STUDYWISE. En KI-basert studieassistent for høyere utdanning med integrasjon mot Canvas Instructure. Bachelor i IT 2026.",
      contact: {
        name: "StudyWise 2026 Gruppe 3",
        url: "https://github.com/26zl/BachelorOppgave",
      },
    },
    servers: [
      {
        url: "http://localhost:4000",
        description: "Lokal utviklingsserver",
      },
    ],
    components: {
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
            uptime: {
              type: "number",
              description: "Server uptime i sekunder",
              example: 3600,
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

export const swaggerSpec = swaggerJsdoc(options);
