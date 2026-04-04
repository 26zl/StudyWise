import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, expect, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Group B: Login vs Signup Confusion Tests
 *
 * Tests scenarios where users might confuse login and signup flows,
 * and verifies that the system handles these cases correctly.
 *
 * Scenarios:
 * B01: Login after signup - verify same user returned
 * B02: Signup again with same identity - verify blocked
 * B03: Signup redirected to login - verify UX is clear
 * B04: Silent reuse check - verify no frontend illusion
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");
const TEST_PASSWORD = "TestPassword123!";

interface TestEvidence {
  scenarioId: string;
  timestamp: string;
  testEmail: string;
  testUsername: string;
  steps: StepEvidence[];
  classification: string;
}

interface StepEvidence {
  step: string;
  url: string;
  clerkUserId: string | null;
  localUserId: string | null;
  meStatus: number | null;
  errorMessages: string[];
  uiState: string;
}

function generateTestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveEvidence(evidence: TestEvidence): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const fileName = `${evidence.scenarioId}-${Date.now()}.json`;
  fs.writeFileSync(path.join(RESULTS_DIR, fileName), JSON.stringify(evidence, null, 2));
}

async function getClerkUserId(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerk = (window as any).Clerk;
      if (!clerk) return null;
      for (let i = 0; i < 30; i++) {
        if (clerk.user) return clerk.user.id as string;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    });
  } catch {
    return null;
  }
}

async function callMeEndpoint(page: Page): Promise<{ status: number; body: unknown }> {
  try {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerkSession = (window as any).Clerk?.session;
      if (!clerkSession) return { status: 0, body: { error: "no_clerk_session" } };
      const token = await clerkSession.getToken();
      if (!token) return { status: 0, body: { error: "no_token" } };
      const res = await fetch("/api/user/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-studywise-csrf": "1",
        },
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    });
    return result;
  } catch {
    return { status: 0, body: { error: "fetch_failed" } };
  }
}

async function signOut(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerk = (window as any).Clerk;
      if (clerk?.signOut) await clerk.signOut();
    });
    await page.waitForTimeout(2000);
  } catch {
    // Ignorer utloggingsfeil
  }
}

async function fillSignupForm(page: Page, email: string, username: string, password: string): Promise<void> {
  // Fyll ut fornavn og etternavn (påkrevde felt i egendefinert skjema)
  const firstNameInput = page.locator("#signup-firstname");
  await firstNameInput.waitFor({ state: "visible", timeout: 30_000 });
  await firstNameInput.fill("Test");

  const lastNameInput = page.locator("#signup-lastname");
  await lastNameInput.fill("User");

  const usernameInput = page.locator("#signup-username");
  await usernameInput.fill(username);

  const emailInput = page.locator("#signup-email");
  await emailInput.fill(email);

  const passwordInput = page.locator("#signup-password");
  await passwordInput.fill(password);

  const submitButton = page.locator('form button[type="submit"]').first();
  await submitButton.waitFor({ state: "visible", timeout: 10_000 });
  await submitButton.click();
}

async function fillSigninForm(page: Page, email: string, password: string): Promise<void> {
  // Egendefinert sign-in-skjema: identifikator og passord på samme side (ikke flerstegs)
  const identifierInput = page.locator("#signin-identifier");
  await identifierInput.waitFor({ state: "visible", timeout: 30_000 });
  await identifierInput.fill(email);

  const passwordInput = page.locator("#signin-password");
  await passwordInput.fill(password);

  const submitButton = page.locator('form button[type="submit"]').first();
  await submitButton.waitFor({ state: "visible", timeout: 10_000 });
  await submitButton.click();
}

test.describe("Group B: Login vs Signup Confusion", () => {
  test("B01: Login after signup returns same user", async ({ page }) => {
    const testId = generateTestId();
    const testEmail = `b01-${testId}@example.com`;
    const testUsername = `b01user${testId.replace(/-/g, "")}`.slice(0, 30);
    const evidence: TestEvidence = {
      scenarioId: "B01",
      timestamp: new Date().toISOString(),
      testEmail,
      testUsername,
      steps: [],
      classification: "pending",
    };

    await setupClerkTestingToken({ page });

    // Steg 1: Registrering
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, testUsername, TEST_PASSWORD);

    // Vent på omdirigering eller forbli på siden
    await page.waitForTimeout(5000);
    const afterSignupUrl = page.url();

    const clerkUserIdAfterSignup = await getClerkUserId(page);
    const meAfterSignup = await callMeEndpoint(page);
    const localUserIdAfterSignup = meAfterSignup.status === 200 && typeof meAfterSignup.body === "object" && meAfterSignup.body !== null
      ? ((meAfterSignup.body as { user?: { id?: string } }).user?.id ?? null)
      : null;

    evidence.steps.push({
      step: "signup",
      url: afterSignupUrl,
      clerkUserId: clerkUserIdAfterSignup,
      localUserId: localUserIdAfterSignup,
      meStatus: meAfterSignup.status,
      errorMessages: [],
      uiState: afterSignupUrl.includes("dashboard") ? "dashboard" : "other",
    });

    // Steg 2: Logg ut
    await signOut(page);
    evidence.steps.push({
      step: "signout",
      url: page.url(),
      clerkUserId: null,
      localUserId: null,
      meStatus: null,
      errorMessages: [],
      uiState: "signed_out",
    });

    // Steg 3: Logg inn med samme legitimasjon
    await page.goto("/auth/sign-in");
    await fillSigninForm(page, testEmail, TEST_PASSWORD);
    await page.waitForTimeout(5000);

    const afterSigninUrl = page.url();
    const clerkUserIdAfterSignin = await getClerkUserId(page);
    const meAfterSignin = await callMeEndpoint(page);
    const localUserIdAfterSignin = meAfterSignin.status === 200 && typeof meAfterSignin.body === "object" && meAfterSignin.body !== null
      ? ((meAfterSignin.body as { user?: { id?: string } }).user?.id ?? null)
      : null;

    evidence.steps.push({
      step: "signin",
      url: afterSigninUrl,
      clerkUserId: clerkUserIdAfterSignin,
      localUserId: localUserIdAfterSignin,
      meStatus: meAfterSignin.status,
      errorMessages: [],
      uiState: afterSigninUrl.includes("dashboard") ? "dashboard" : "other",
    });

    // Klassifisering
    const sameClerkUser = clerkUserIdAfterSignup && clerkUserIdAfterSignin && clerkUserIdAfterSignup === clerkUserIdAfterSignin;
    const sameLocalUser = localUserIdAfterSignup && localUserIdAfterSignin && localUserIdAfterSignup === localUserIdAfterSignin;

    if (sameClerkUser && sameLocalUser) {
      evidence.classification = "LOGIN_SUCCESS_SAME_USER";
    } else if (sameClerkUser && !sameLocalUser) {
      evidence.classification = "CLERK_SAME_BUT_LOCAL_DIFFERENT";
    } else if (!clerkUserIdAfterSignin) {
      evidence.classification = "LOGIN_FAILED";
    } else {
      evidence.classification = "UNEXPECTED_DIFFERENT_USERS";
    }

    saveEvidence(evidence);

    // Hopp over hvis signup ikke fullførte (Clerk testing token-begrensning)
    test.skip(!clerkUserIdAfterSignup, "Signup fullførte ikke — Clerk testing token-begrensning");

    // Assertions når registreringen fullførte
    expect(sameClerkUser).toBeTruthy();
    expect(sameLocalUser).toBeTruthy();
    expect(afterSigninUrl).toContain("dashboard");
  });

  test("B02: Signup again with same email is blocked", async ({ page }) => {
    const testId = generateTestId();
    const testEmail = `b02-${testId}@example.com`;
    const testUsername = `b02user${testId.replace(/-/g, "")}`.slice(0, 30);
    const evidence: TestEvidence = {
      scenarioId: "B02",
      timestamp: new Date().toISOString(),
      testEmail,
      testUsername,
      steps: [],
      classification: "pending",
    };

    await setupClerkTestingToken({ page });

    // Steg 1: Registrer for første gang
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, testUsername, TEST_PASSWORD);
    await page.waitForTimeout(5000);

    const firstClerkId = await getClerkUserId(page);
    evidence.steps.push({
      step: "first_signup",
      url: page.url(),
      clerkUserId: firstClerkId,
      localUserId: null,
      meStatus: null,
      errorMessages: [],
      uiState: page.url().includes("dashboard") ? "dashboard" : "signup",
    });

    // Steg 2: Logg ut
    await signOut(page);

    // Steg 3: Forsøk å registrere igjen med samme e-post
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, `${testUsername}2`, TEST_PASSWORD);
    await page.waitForTimeout(3000);

    // Sjekk for feilmeldinger
    const errorTexts = await page.locator('[data-clerk-field-error], .cl-formFieldErrorText, [role="alert"]')
      .allTextContents()
      .catch(() => []);

    const currentUrl = page.url();
    const blocked = errorTexts.length > 0 || currentUrl.includes("sign-up");

    evidence.steps.push({
      step: "second_signup_attempt",
      url: currentUrl,
      clerkUserId: await getClerkUserId(page),
      localUserId: null,
      meStatus: null,
      errorMessages: errorTexts,
      uiState: blocked ? "blocked" : "allowed",
    });

    if (blocked) {
      evidence.classification = "CLERK_BLOCKED_AT_SIGNUP_FORM";
    } else {
      evidence.classification = "SIGNUP_NOT_BLOCKED_INVESTIGATE";
    }

    saveEvidence(evidence);

    // Assertions — vi forventer at registreringen blokkeres
    expect(blocked).toBeTruthy();
  });

  test("B03: Signup with existing email shows clear error", async ({ page }) => {
    const testId = generateTestId();
    const testEmail = `b03-${testId}@example.com`;
    const testUsername = `b03user${testId.replace(/-/g, "")}`.slice(0, 30);

    await setupClerkTestingToken({ page });

    // Opprett første konto
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, testUsername, TEST_PASSWORD);
    await page.waitForTimeout(5000);
    await signOut(page);

    // Forsøk registrering med samme e-post
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, `${testUsername}new`, TEST_PASSWORD);
    await page.waitForTimeout(3000);

    // Sjekk for tydelig feilmelding eller omdirigering
    const errorVisible = await page.locator('[data-clerk-field-error], .cl-formFieldErrorText, [role="alert"]')
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    const redirectedToSignin = page.url().includes("sign-in");

    // Enten vises feilmelding ELLER bruker omdirigeres til innlogging
    expect(errorVisible || redirectedToSignin).toBeTruthy();
  });

  test("B04: No silent account reuse on signup attempt", async ({ page }) => {
    const testId = generateTestId();
    const testEmail = `b04-${testId}@example.com`;
    const testUsername = `b04user${testId.replace(/-/g, "")}`.slice(0, 30);

    await setupClerkTestingToken({ page });

    // Opprett konto
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, testUsername, TEST_PASSWORD);
    await page.waitForTimeout(5000);

    const firstClerkId = await getClerkUserId(page);
    const firstMe = await callMeEndpoint(page);
    const firstLocalId = firstMe.status === 200 && typeof firstMe.body === "object" && firstMe.body !== null
      ? ((firstMe.body as { user?: { id?: string } }).user?.id ?? null)
      : null;

    await signOut(page);

    // Forsøk registrering med samme e-post
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, `${testUsername}diff`, TEST_PASSWORD);
    await page.waitForTimeout(5000);

    const secondClerkId = await getClerkUserId(page);

    // Hvis vi ble stille logget inn som samme bruker uten tydelig indikasjon, er det et problem
    const silentReuse = secondClerkId && secondClerkId === firstClerkId && page.url().includes("dashboard");

    // Sjekk om det finnes noen indikasjon til bruker om eksisterende konto
    const hasAccountExistsWarning = await page.locator('text=/already|existing|exist|bruk|allerede/i')
      .first()
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);

    // Stille gjenbruk uten advarsel er et UX-problem
    if (silentReuse) {
      expect(hasAccountExistsWarning).toBeTruthy();
    }
    // Blokkert eller har advarsel — begge er OK
  });
});
