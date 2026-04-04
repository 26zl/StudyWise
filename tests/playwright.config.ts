import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Last env fra både frontend og backend .env-filer slik at Clerk-nøkler er tilgjengelige
dotenv.config({ path: path.resolve(__dirname, "../frontend/.env") });
dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });

// Map Next.js-prefisert nøkkel til det @clerk/testing forventer
if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

/**
 * Playwright E2E-konfigurasjon for StudyWise integrasjonstester.
 *
 * Bruk:
 *   pnpm test:auth:e2e                    # Auth E2E-tester
 *   npx playwright test --config tests/playwright.config.ts  # Alle spesifikasjoner
 *
 * Forutsetninger:
 *   - Backend kjører på http://localhost:4000
 *   - Frontend kjører på http://localhost:3000
 *   - CLERK_SECRET_KEY i backend/.env
 *   - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY i frontend/.env
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  outputDir: "./results",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { outputFolder: "./report", open: "never" }]],
  globalSetup: "./auth/global.setup.ts",
  webServer: [
    {
      command: process.env.CI
        ? "pnpm --filter backend exec tsx src/index.ts"
        : "pnpm dev:backend",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      cwd: path.resolve(__dirname, ".."),
    },
    {
      command: "pnpm dev:frontend",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      cwd: path.resolve(__dirname, ".."),
    },
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
