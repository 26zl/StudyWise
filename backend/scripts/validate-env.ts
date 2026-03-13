/**
 * Validerer påkrevde backend-miljøvariabler før build.
 * Kjører som prebuild slik at manglende env gir rask feil; hopper over i CI.
 */
import "dotenv/config";
import { validateEnv } from "../src/utils/validateEnv.js";

if (process.env.CI === "true") {
  process.stdout.write("[validateEnv] CI-miljø oppdaget, hopper over miljøvalidering\n");
  process.exit(0);
}

validateEnv();
process.stdout.write("[validateEnv] Alle påkrevde backend-miljøvariabler er validert for build\n");
