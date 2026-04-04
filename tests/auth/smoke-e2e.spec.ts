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

    // Clerk-komponenten lastes fra CDN og kan ta tid i CI — vent opptil 30s
    const emailInput = page.locator('input[name="emailAddress"], input[type="email"]').first();
    const signUpText = page.locator('text=/sign up|registrer|opprett/i').first();

    await expect(emailInput.or(signUpText)).toBeVisible({ timeout: 30_000 });
  });
});
