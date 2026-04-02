import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const pathsToClean = [
  "backend/dist",
  "backend/node_modules",
  "frontend/.next",
  "frontend/.turbo",
  "frontend/node_modules",
  "common/dist",
  "common/node_modules",
  "docs/docs/.vitepress/dist",
  "docs/docs/.vitepress/cache",
  "docs/node_modules",
  "tests/node_modules",
  "tests/results",
  "tests/report",
  "tests/auth/results",
  "node_modules",
  ".pnpm-store",
  ".turbo",
  "pnpm-lock.yaml",
];

console.log("Cleaning all (including node_modules)...");

for (const p of pathsToClean) {
  const fullPath = path.join(rootDir, p);
  try {
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`  Removed: ${p}`);
    }
  } catch (err) {
    console.warn(`  Warning: Could not remove ${p}: ${err.message}`);
  }
}

console.log("Pruning pnpm store...");
try {
  execSync("pnpm store prune", { stdio: "inherit" });
} catch (err) {
  console.warn(`  Warning: Could not prune pnpm store: ${err.message}`);
}

console.log("Done!");
