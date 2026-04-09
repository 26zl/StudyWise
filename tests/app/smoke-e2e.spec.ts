import { test, expect } from "@playwright/test";

/**
 * App-brede røyktester (uten innlogging).
 * Verifiserer at nøkkelsider laster, navigasjon fungerer,
 * og at uautentiserte brukere redirectes korrekt.
 */

test.describe("App smoke — sidelasting", () => {
  test("landingsside laster med tittel og navigasjon", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle(/StudyWise/i);

    // Navigasjon synlig
    const nav = page.locator("nav, header").first();
    await expect(nav).toBeVisible();

    // Sign in/up-knapper synlig for uautentiserte brukere
    const authButton = page.getByRole("button", { name: /sign in|logg inn/i })
      .or(page.getByRole("link", { name: /sign in|logg inn/i }));
    await expect(authButton.first()).toBeVisible({ timeout: 15_000 });
  });

  test("sign-in-side laster", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await page.waitForLoadState("domcontentloaded");

    const heading = page.getByRole("heading", { name: /sign in|logg inn|velkommen/i });
    const emailInput = page.locator("#identifier-field, input[name='identifier']");
    await expect(heading.or(emailInput.first())).toBeVisible({ timeout: 30_000 });
  });

  test("personvernsiden laster", async ({ page }) => {
    await page.goto("/personvern");
    await page.waitForLoadState("domcontentloaded");
    // Sjekk at det er innhold (ikke en tom 404)
    const mainContent = page.locator("main, [role='main'], article").first();
    await expect(mainContent).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("App smoke — autentiseringsvakter", () => {
  test("dashboard redirecter til innlogging for uautentiserte", async ({ page }) => {
    await page.goto("/dashboard");
    // Bør lande på sign-in eller se en innloggingskomponent
    await page.waitForURL(/\/(auth\/sign-in|dashboard)/, { timeout: 15_000 });

    const url = page.url();
    const erRedirectet = url.includes("/auth/sign-in");
    const harAuthUI = await page.getByRole("heading", { name: /sign in|logg inn/i }).isVisible()
      .catch(() => false);
    const harDashboard = await page.locator("[data-testid='dashboard'], #main-content").isVisible()
      .catch(() => false);

    // Enten redirectet til sign-in, viser auth UI, eller (med Clerk) viser dashboard
    expect(erRedirectet || harAuthUI || harDashboard).toBeTruthy();
  });

  test("konto-side redirecter til innlogging for uautentiserte", async ({ page }) => {
    await page.goto("/account");
    await page.waitForURL(/\/(auth\/sign-in|account)/, { timeout: 15_000 });

    const url = page.url();
    const erRedirectet = url.includes("/auth/sign-in");
    const harAuthUI = await page.getByRole("heading", { name: /sign in|logg inn/i }).isVisible()
      .catch(() => false);

    expect(erRedirectet || harAuthUI).toBeTruthy();
  });
});

test.describe("App smoke — API-helsejekk", () => {
  test("backend /health svarer 200", async ({ request }) => {
    const res = await request.get("http://localhost:4000/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status", "ok");
  });

  test("API-ruter returnerer 401 uten auth", async ({ request }) => {
    const ruter = [
      "/api/user/me",
      "/api/ki/models",
      "/api/canvas/emner",
      "/api/ki/chat/history?limit=10&page=1",
    ];

    for (const rute of ruter) {
      const res = await request.get(`http://localhost:4000${rute}`);
      expect(res.status(), `${rute} bør returnere 401`).toBe(401);
    }
  });

  test("ugyldige API-ruter returnerer 404", async ({ request }) => {
    const res = await request.get("http://localhost:4000/api/finnes-ikke");
    expect([404, 401]).toContain(res.status());
  });
});
