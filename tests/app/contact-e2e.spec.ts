import { test, expect } from "@playwright/test";

/**
 * Kontaktskjema E2E-tester.
 * Verifiserer at backend-ruten håndterer forespørsler korrekt.
 */

test.describe("Kontaktskjema", () => {
  test("feil-ID i URL vises i UI men fjernes fra adresselinjen", async ({ page }) => {
    await page.goto("/kontakt?errorId=req.abc-123:v2");
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText("req.abc-123:v2")).toBeVisible();
    await expect(page).toHaveURL(/\/kontakt$/);
  });

  test("kontaktskjema-ruten håndterer innsending uten Turnstile-token", async ({ request }) => {
    const res = await request.post("http://localhost:4000/api/kontakt", {
      headers: {
        "Content-Type": "application/json",
        "x-studywise-csrf": "1",
        Origin: "http://localhost:3000",
      },
      data: {
        navn: "Test Testesen",
        epost: "test@example.com",
        emne: "Test-emne",
        melding: "Dette er en testmelding som er lang nok til å passere validering.",
        turnstileToken: "",
      },
    });
    // I dev uten Turnstile-konfigurasjon: 200 (hopper over verifisering)
    // I prod uten Turnstile-konfigurasjon: 503 (service unavailable)
    // Med Turnstile konfigurert men tom token: 400 (verifisering kreves)
    expect([200, 400, 503]).toContain(res.status());
  });

  test("kontaktskjema-ruten avviser ugyldig input", async ({ request }) => {
    const res = await request.post("http://localhost:4000/api/kontakt", {
      headers: {
        "Content-Type": "application/json",
        "x-studywise-csrf": "1",
        Origin: "http://localhost:3000",
      },
      data: {
        navn: "",
        epost: "ugyldig",
        emne: "",
        melding: "kort",
      },
    });
    // Zod-validering feiler
    expect(res.status()).toBe(400);
  });
});
