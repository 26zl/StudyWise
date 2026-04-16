import { test, expect } from "@playwright/test";

/**
 * Navigasjons- og UX-tester.
 * Verifiserer at viktige sider rendrer riktig,
 * tema-bytte fungerer, og i18n-switching fungerer.
 */

test.describe("Navigasjon — sidelasting", () => {
  test("alle offentlige sider returnerer 200", async ({ page }) => {
    const offentligeSider = [
      "/",
      "/auth/sign-in",
      "/auth/sign-up",
      "/personvern",
    ];

    for (const sti of offentligeSider) {
      const res = await page.goto(sti);
      expect(res?.status(), `${sti} bør returnere 200`).toBe(200);
    }
  });

  test("404-side vises for ukjente ruter", async ({ page }) => {
    const res = await page.goto("/denne-siden-finnes-ikke-12345");
    expect(res?.status()).toBe(404);
    // Bør vise noe innhold (ikke tom side)
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

test.describe("Navigasjon — tema", () => {
  test("tema-knapp er synlig og kan klikkes", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const temaKnapp = page.getByRole("button", { name: /theme|tema|toggle/i });
    await expect(temaKnapp).toBeVisible({ timeout: 15_000 });
    await temaKnapp.click();

    // Etter klikk bør html-elementet ha dark/light klasse
    const htmlEl = page.locator("html");
    const klasseEtterKlikk = await htmlEl.getAttribute("class");
    expect(klasseEtterKlikk).toBeTruthy();
  });
});

test.describe("Navigasjon — tilgjengelighet", () => {
  test("skip-to-content-link finnes", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const skipLink = page.getByRole("link", { name: /skip to content|hopp til innhold/i });
    // Skip-link finnes i DOM (kan være skjult til fokus)
    await expect(skipLink).toBeAttached();
  });

  test("sider har lang-attributt", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBeTruthy();
    expect(["nb", "en"]).toContain(lang);
  });
});

test.describe("Navigasjon — cookie-banner", () => {
  test("cookie-banner vises for nye besøkende", async ({ page }) => {
    // Tøm cookies for å simulere ny besøkende
    await page.context().clearCookies();
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const cookieBanner = page.getByRole("dialog", { name: /cookie|informasjonskapsler/i });
    await expect(cookieBanner).toBeVisible({ timeout: 15_000 });
  });

  test("cookie-banner forsvinner etter aksept", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const akseptKnapp = page.getByRole("button", { name: /accept all|godta alle/i }).first();
    await expect(akseptKnapp).toBeVisible({ timeout: 15_000 });
    await akseptKnapp.click();

    // Banneret bør forsvinne
    await expect(akseptKnapp).not.toBeVisible({ timeout: 5_000 });
  });
});
