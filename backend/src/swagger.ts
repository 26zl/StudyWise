/*
* Swagger/OpenAPI dokumentasjon for API
*/


import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Bachelor IT - USN 2026 API",
      version: "1.0.0",
      description: "API dokumentasjon for Bachelor IT prosjektet. Integrasjon med Canvas LMS og KI-funksjoner.",
      contact: {
        name: "Bachelor IT 2026 Gruppe 3",
        url: "https://github.com/26zl/BachelorOppgave",
      },
    },
    servers: [
      {
        url: "http://localhost:4000",
        description: "Backend (via localhost) - Bruk denne når du tester fra nettleseren",
      },
      {
        url: "http://backend:4000",
        description: "Backend (intern Docker) - Kun for container-til-container kommunikasjon",
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
