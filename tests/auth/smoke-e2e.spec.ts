import { test, expect } from "@playwright/test";

/**
 * Deterministiske auth E2E røyktester.
 * Disse testene bør være stabile og egnet for CI-portvakt.
 */

test.describe("Auth E2E smoke", () => {
  test("home page loads", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle(/StudyWise/i);
  });

  test("sign-up page renders auth UI", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await page.waitForLoadState("domcontentloaded");

    // Egendefinert registreringsskjema — vent på at e-postfeltet vises
    // Turnstile-gaten hoppes over i CI (NEXT_PUBLIC_AUTH_TURNSTILE_SITE_KEY ikke satt)
    await expect(page.locator("#signup-email")).toBeVisible({ timeout: 30_000 });
  });
});
