/**
 * Validerer påkrevde backend-miljøvariabler før build.
 * Kjører som prebuild slik at manglende env gir rask feil
 * også i CI når workflowen leverer placeholder-verdier.
 */
import "dotenv/config";
import { validateEnv } from "../src/utils/validateEnv.js";

if (process.env.CI === "true") {
  process.stdout.write("[validateEnv] Hopper over backend env-validering i CI\n");
  process.exit(0);
}

validateEnv();
process.stdout.write("[validateEnv] Alle påkrevde backend-miljøvariabler er validert for build\n");
