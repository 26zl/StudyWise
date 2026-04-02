import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load env from both frontend and backend .env files so Clerk keys are available
dotenv.config({ path: path.resolve(__dirname, "../frontend/.env") });
dotenv.config({ path: path.resolve(__dirname, "../backend/.env") });

// Map Next.js-prefixed key to what @clerk/testing expects
if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

/**
 * Playwright E2E config for StudyWise integration tests.
 *
 * Usage:
 *   pnpm test:auth:e2e                    # Auth E2E tests
 *   npx playwright test --config tests/playwright.config.ts  # All specs
 *
 * Prerequisites:
 *   - Backend running on http://localhost:4000
 *   - Frontend running on http://localhost:3000
 *   - CLERK_SECRET_KEY in backend/.env
 *   - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in frontend/.env
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
      command: "pnpm dev:backend",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: path.resolve(__dirname, ".."),
    },
    {
      command: "pnpm dev:frontend",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
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
