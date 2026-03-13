/**
 * Validerer påkrevde frontend-miljøvariabler før build.
 * Kjører som prebuild (før next build) slik at manglende env gir rask feil.
 */
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { validateFrontendEnv } from "../app/lib/validateEnv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, ".env.local") });

if (process.env.CI === "true") {
  process.stdout.write("[validateEnv] CI-miljø oppdaget, hopper over frontend miljøvalidering\n");
  process.exit(0);
}

validateFrontendEnv({ requireInternalApiUrl: true });
process.stdout.write("[validateEnv] Alle påkrevde frontend-miljøvariabler er validert for build\n");
