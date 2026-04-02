import { test, expect } from "@playwright/test";

/**
 * Deterministic auth E2E smoke tests.
 * These tests should be stable and suitable for CI gating.
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

    const hasEmailInput = await page
      .locator('input[name="emailAddress"], input[type="email"]')
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    const hasSignUpText = await page
      .locator('text=/sign up|registrer|opprett/i')
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    expect(hasEmailInput || hasSignUpText).toBeTruthy();
  });
});
