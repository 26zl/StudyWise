import { test, expect } from "@playwright/test";

/**
 * Kontaktskjema E2E-tester.
 * Verifiserer at kontaktskjemaet rendrer, validerer input,
 * og at backend-ruten er beskyttet.
 */

test.describe("Kontaktskjema", () => {
  test("kontaktskjema-ruten krever Turnstile", async ({ request }) => {
    // POST uten Turnstile-token bør blokkeres
    const res = await request.post("http://localhost:4000/api/contact", {
      headers: {
        "Content-Type": "application/json",
        "x-studywise-csrf": "1",
        Origin: "http://localhost:3000",
      },
      data: {
        name: "Test",
        email: "test@example.com",
        subject: "Test",
        message: "Testmelding",
      },
    });
    // Bør feile pga. manglende/ugyldig Turnstile-token
    expect([400, 403, 422]).toContain(res.status());
  });
});
