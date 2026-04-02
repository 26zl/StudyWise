/**
 * Shared env loader for test scripts.
 * Loads backend/.env (for MONGO_URI, CLERK_SECRET_KEY, etc.)
 * and frontend/.env (for NEXT_PUBLIC_* keys).
 */
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

config({ path: resolve(ROOT, "backend/.env") });
config({ path: resolve(ROOT, "frontend/.env") });

export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
