import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Auth duplikat-registrering reproduksjonstest
 *
 * Automatiserer duplikat-registrering-scenariet for å fange kjøretidsbevis.
 *
 * Hva den gjør:
 * 1. Registrer med e-post/passord (Konto A)
 * 2. Fang /me-respons + dashboard-tilstand
 * 3. Logg ut
 * 4. Forsøk andre registrering med samme e-post og/eller brukernavn
 * 5. Fang hva som skjer: omdirigering, /me-status, feil, konflikt-modaler
 * 6. Kall diagnostikk-endepunkt før/etter
 * 7. Lagre bevisoppsummering
 *
 * MERK: Denne testen bruker Clerks e-post/passord-flyt (ikke OAuth) fordi
 * OAuth (Google/Microsoft) ikke kan automatiseres uten ekte legitimasjon.
 * Testen er designet for å utvides med OAuth senere.
 *
 * Forutsetninger:
 * - Backend kjører med ENABLE_DIAGNOSTICS=true
 * - Frontend kjører på localhost:3000
 * - Clerk dev-instans (pk_test_) tillater e-post/passord-registrering
 */

const FLOW_ID_A = `repro-A-${Date.now()}`;
const FLOW_ID_B = `repro-B-${Date.now()}`;
const TEST_EMAIL = `testuser-${Date.now()}@example.com`;
const TEST_USERNAME = `testuser${Date.now()}`;
const TEST_PASSWORD = "TestPassword123!";
const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "results");

interface Evidence {
  flowId: string;
  timestamp: string;
  testEmail: string;
  testUsername: string;
  firstSignup: SignupEvidence | null;
  secondSignup: SignupEvidence | null;
  diagnosticBefore: unknown;
  diagnosticAfter: unknown;
  classification: string;
}

interface SignupEvidence {
  flowId: string;
  signupCompleted: boolean;
  redirectedTo: string;
  meStatus: number | null;
  meBody: unknown;
  clerkUserId: string | null;
  localUserId: string | null;
  localEmail: string | null;
  localUsername: string | null;
  usernameConflictModalShown: boolean;
  accountConflictSignout: boolean;
  consoleLogs: string[];
  errors: string[];
}

function createEmptySignupEvidence(flowId: string): SignupEvidence {
  return {
    flowId,
    signupCompleted: false,
    redirectedTo: "",
    meStatus: null,
    meBody: null,
    clerkUserId: null,
    localUserId: null,
    localEmail: null,
    localUsername: null,
    usernameConflictModalShown: false,
    accountConflictSignout: false,
    consoleLogs: [],
    errors: [],
  };
}

/**
 * Fanger opp konsoll-logger og feil fra siden.
 */
function attachConsoleCapture(page: Page, evidence: SignupEvidence) {
  page.on("console", (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    evidence.consoleLogs.push(text);
  });
  page.on("pageerror", (err) => {
    evidence.errors.push(err.message);
  });
}

/**
 * Forsøker å kalle diagnostikk-endepunktet.
 * Returnerer parset JSON eller null hvis ikke tilgjengelig.
 */
async function callDiagnostic(page: Page): Promise<unknown> {
  try {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerkSession = (window as any).Clerk?.session;
      if (!clerkSession) return { error: "no_clerk_session" };
      const token = await clerkSession.getToken();
      if (!token) return { error: "no_token" };
      const res = await fetch("/api/debug/auth-diagnostic", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { error: `http_${res.status}`, status: res.status };
      return res.json();
    });
    return result;
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Vent på at Clerk lastes og hent ut gjeldende Clerk bruker-ID.
 */
async function getClerkUserId(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerk = (window as any).Clerk;
      if (!clerk) return null;
      // Vent på at Clerk lastes
      for (let i = 0; i < 50; i++) {
        if (clerk.user) return clerk.user.id as string;
        await new Promise((r) => setTimeout(r, 200));
      }
      return null;
    });
  } catch {
    return null;
  }
}

/**
 * Kall /me med debug flow-id-headeren.
 */
async function callMeWithFlowId(page: Page, flowId: string): Promise<{ status: number; body: unknown }> {
  try {
    const result = await page.evaluate(async (fid: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerkSession = (window as any).Clerk?.session;
      if (!clerkSession) return { status: 0, body: { error: "no_clerk_session" } };
      const token = await clerkSession.getToken();
      if (!token) return { status: 0, body: { error: "no_token" } };
      const res = await fetch("/api/user/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-debug-flow-id": fid,
          "x-studywise-csrf": "1",
        },
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, body };
    }, flowId);
    return result;
  } catch (e) {
    return { status: 0, body: { error: String(e) } };
  }
}

/**
 * Fyll ut Clerk-registreringsskjemaet med e-post/passord.
 * Håndterer standard Clerk dev-modus registreringswidget.
 */
async function fillClerkSignupForm(page: Page, email: string, username: string, password: string) {
  const emailInput = page.locator('input[name="emailAddress"], input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 30_000 });
  await emailInput.fill(email);

  const usernameInput = page.locator('input[name="username"]').first();
  await usernameInput.waitFor({ state: "visible", timeout: 10_000 });
  await usernameInput.fill(username);

  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  await passwordInput.waitFor({ state: "visible", timeout: 10_000 });
  await passwordInput.fill(password);

  const submitButton = page.locator('button[data-clerk-form-action="submit"], button:has-text("Continue"), button:has-text("Sign up"), button:has-text("Registrer")').first();
  await submitButton.waitFor({ state: "visible", timeout: 10_000 });
  await submitButton.click();
}

/**
 * Sjekk for Clerk-verifiseringskode-steg (e-post OTP i dev-modus).
 * I Clerk dev-modus kan OTP-en bli automatisk utfylt eller en spesifikk kode kan fungere.
 */
async function handleVerificationStep(page: Page) {
  // I Clerk dev-modus, se etter OTP/verifiseringskode-inputen
  const otpInput = page.locator('input[name="code"], input[data-clerk-element="otpInput"]').first();
  const isOtpStep = await otpInput.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);

  if (isOtpStep) {
    // I dev-modus viser Clerk ofte et banner med verifiseringskoden
    // eller bruker koden "424242" — prøv sideteksten for en kode
    const pageText = await page.textContent("body") ?? "";
    const codeMatch = pageText.match(/(?:verification|code)[^\d]*(\d{6})/i);
    if (codeMatch) {
      await otpInput.fill(codeMatch[1]);
    } else {
      // Clerk dev-instanser fullfører ofte automatisk; vent og se
      await page.waitForTimeout(3000);
    }
  }
}

function saveEvidence(evidence: Evidence) {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const filePath = path.join(RESULTS_DIR, `evidence-${Date.now()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(evidence, null, 2));
  console.log(`\nEvidence saved to: ${filePath}`);
}

function classify(evidence: Evidence): string {
  const a = evidence.firstSignup;
  const b = evidence.secondSignup;

  if (!a || !b) return "incomplete — one or both signups did not complete";

  // Sjekk om samme Clerk-bruker
  const sameClerkUser = a.clerkUserId && b.clerkUserId && a.clerkUserId === b.clerkUserId;
  const sameLocalUser = a.localUserId && b.localUserId && a.localUserId === b.localUserId;

  if (sameClerkUser && sameLocalUser) {
    return "FRONTEND ILLUSION — Clerk reused the same account. Same clerkId, same local user. No real duplicate.";
  }

  if (sameClerkUser && !sameLocalUser) {
    return "UNEXPECTED — Same Clerk user but different local users. Investigate findOrCreateUserByClerkId.";
  }

  if (!sameClerkUser && b.meStatus === 409) {
    if (b.usernameConflictModalShown) {
      return "BACKEND CORRECTLY BLOCKED (username conflict) — Different Clerk user, /me returned 409, username modal shown.";
    }
    if (b.accountConflictSignout) {
      return "BACKEND CORRECTLY BLOCKED (account conflict) — Different Clerk user, /me returned 409, signout triggered.";
    }
    return "BACKEND CORRECTLY BLOCKED — Different Clerk user, /me returned 409.";
  }

  if (!sameClerkUser && sameLocalUser) {
    return "SUSPICIOUS — Different Clerk users mapped to same local user. Possible auto-relink.";
  }

  if (!sameClerkUser && !sameLocalUser && b.meStatus === 200) {
    return "REAL DUPLICATE IN LOCAL DB — Different Clerk users, both got 200 from /me, different local user IDs.";
  }

  if (b.meStatus === 401 || b.meStatus === 403) {
    return `SECOND SIGNUP REJECTED (HTTP ${b.meStatus}) — Clerk created new user but backend blocked it.`;
  }

  return `UNRESOLVED — first.meStatus=${a.meStatus}, second.meStatus=${b.meStatus}, sameClerkUser=${sameClerkUser}, sameLocalUser=${sameLocalUser}`;
}

function printSummary(evidence: Evidence) {
  console.log("\n" + "=".repeat(70));
  console.log("  AUTH DUPLICATE SIGNUP REPRODUCTION SUMMARY");
  console.log("=".repeat(70));
  console.log(`  Test email:     ${evidence.testEmail}`);
  console.log(`  Test username:  ${evidence.testUsername}`);
  console.log(`  Timestamp:      ${evidence.timestamp}`);
  console.log("");
  console.log("  --- First Signup ---");
  if (evidence.firstSignup) {
    const a = evidence.firstSignup;
    console.log(`  Clerk user ID:  ${a.clerkUserId ?? "N/A"}`);
    console.log(`  Local user ID:  ${a.localUserId ?? "N/A"}`);
    console.log(`  /me status:     ${a.meStatus}`);
    console.log(`  Redirected to:  ${a.redirectedTo}`);
    console.log(`  Local email:    ${a.localEmail ?? "N/A"}`);
    console.log(`  Local username: ${a.localUsername ?? "N/A"}`);
  } else {
    console.log("  (did not complete)");
  }
  console.log("");
  console.log("  --- Second Signup ---");
  if (evidence.secondSignup) {
    const b = evidence.secondSignup;
    console.log(`  Clerk user ID:  ${b.clerkUserId ?? "N/A"}`);
    console.log(`  Local user ID:  ${b.localUserId ?? "N/A"}`);
    console.log(`  /me status:     ${b.meStatus}`);
    console.log(`  Redirected to:  ${b.redirectedTo}`);
    console.log(`  Local email:    ${b.localEmail ?? "N/A"}`);
    console.log(`  Local username: ${b.localUsername ?? "N/A"}`);
    console.log(`  Username conflict modal: ${b.usernameConflictModalShown}`);
    console.log(`  Account conflict signout: ${b.accountConflictSignout}`);
    if (b.errors.length > 0) {
      console.log(`  Errors: ${b.errors.join("; ")}`);
    }
  } else {
    console.log("  (did not complete)");
  }
  console.log("");
  console.log(`  CLASSIFICATION: ${evidence.classification}`);
  console.log("=".repeat(70));
}

// ============================================================
// TEST-SUITE
// ============================================================

test.describe("Duplicate Signup Reproduction", () => {
  let evidence: Evidence;

  test.beforeAll(() => {
    evidence = {
      flowId: FLOW_ID_A,
      timestamp: new Date().toISOString(),
      testEmail: TEST_EMAIL,
      testUsername: TEST_USERNAME,
      firstSignup: null,
      secondSignup: null,
      diagnosticBefore: null,
      diagnosticAfter: null,
      classification: "pending",
    };
  });

  test.afterAll(() => {
    evidence.classification = classify(evidence);
    printSummary(evidence);
    saveEvidence(evidence);
  });

  test("Step 1: First signup with email/password", async ({ page }) => {
    const ev = createEmptySignupEvidence(FLOW_ID_A);
    attachConsoleCapture(page, ev);

    // Injiser Clerk testing token for å omgå Turnstile bot-beskyttelse
    await setupClerkTestingToken({ page });

    await page.goto("/auth/sign-up");
    await page.waitForLoadState("domcontentloaded");

    // Fyll ut Clerk-registreringsskjemaet
    await fillClerkSignupForm(page, TEST_EMAIL, TEST_USERNAME, TEST_PASSWORD);

    // Håndter potensielt verifiseringssteg
    await handleVerificationStep(page);

    // Vent på omdirigering til dashboard (opptil 30s)
    try {
      await page.waitForURL("**/dashboard**", { timeout: 30000 });
      ev.signupCompleted = true;
      ev.redirectedTo = page.url();
    } catch {
      ev.redirectedTo = page.url();
      ev.errors.push(`Signup did not redirect to dashboard, stuck at: ${page.url()}`);
    }

    // Hvis vi kom til dashboard, samle inn bevis
    if (ev.signupCompleted) {
      // Vent på at Clerk fullstendig initialiseres
      await page.waitForTimeout(3000);

      ev.clerkUserId = await getClerkUserId(page);

      // Kall /me med flow-id
      const meResult = await callMeWithFlowId(page, FLOW_ID_A);
      ev.meStatus = meResult.status;
      ev.meBody = meResult.body;

      if (meResult.status === 200 && meResult.body && typeof meResult.body === "object") {
        const user = (meResult.body as { user?: { id?: string; email?: string; username?: string } }).user;
        ev.localUserId = user?.id ?? null;
        ev.localEmail = user?.email ?? null;
        ev.localUsername = user?.username ?? null;
      }
    }

    evidence.firstSignup = ev;
    console.log(`\nFirst signup: clerkId=${ev.clerkUserId}, localId=${ev.localUserId}, meStatus=${ev.meStatus}`);

    // Logg ut
    try {
      await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clerk = (window as any).Clerk;
        if (clerk?.signOut) await clerk.signOut();
      });
      await page.waitForTimeout(2000);
    } catch (e) {
      ev.errors.push(`Signout failed: ${String(e)}`);
    }
  });

  test("Step 2: Second signup with same email/username", async ({ page }) => {
    const ev = createEmptySignupEvidence(FLOW_ID_B);
    attachConsoleCapture(page, ev);

    // Injiser Clerk testing token for å omgå Turnstile bot-beskyttelse
    await setupClerkTestingToken({ page });

    await page.goto("/auth/sign-up");
    await page.waitForLoadState("domcontentloaded");

    // Fyll ut samme e-post og brukernavn
    await fillClerkSignupForm(page, TEST_EMAIL, TEST_USERNAME, TEST_PASSWORD);

    // Vent for å se hva som skjer — kan være:
    // 1. Clerk blokkerer det (feil i registreringsskjemaet)
    // 2. Clerk oppretter ny bruker og omdirigerer
    // 3. Clerk slår sammen og omdirigerer

    // Sjekk for Clerk-nivå-feil først
    await page.waitForTimeout(3000);
    const currentUrl = page.url();

    // Sjekk om Clerk viste en feil (e-post allerede tatt, osv.)
    const clerkError = await page.locator('[data-clerk-field-error], .cl-formFieldErrorText, [role="alert"]')
      .allTextContents()
      .catch(() => []);

    if (clerkError.length > 0) {
      ev.errors.push(`Clerk blocked signup: ${clerkError.join("; ")}`);
      ev.redirectedTo = currentUrl;
      evidence.secondSignup = ev;
      console.log(`\nSecond signup blocked by Clerk: ${clerkError.join("; ")}`);
      return;
    }

    // Håndter verifiseringssteg hvis det finnes
    await handleVerificationStep(page);

    // Vent på omdirigering eller feil
    try {
      await page.waitForURL("**/dashboard**", { timeout: 30000 });
      ev.signupCompleted = true;
      ev.redirectedTo = page.url();
    } catch {
      ev.redirectedTo = page.url();
    }

    // Vent på at siden stabiliseres
    await page.waitForTimeout(3000);

    // Sjekk for brukernavn-konflikt-modal
    const usernameModal = await page.locator('[role="dialog"]:has-text("brukernavn"), [role="dialog"]:has-text("username")')
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    ev.usernameConflictModalShown = usernameModal;

    // Sjekk om vi ble logget ut (konto-konflikt)
    const signInPageVisible = page.url().includes("/auth/sign-in") || page.url().includes("/auth/sign-up");
    if (signInPageVisible && !page.url().includes("/auth/sign-up")) {
      ev.accountConflictSignout = true;
    }

    // Hent Clerk bruker-ID
    ev.clerkUserId = await getClerkUserId(page);

    // Prøv å kalle /me
    if (ev.clerkUserId) {
      const meResult = await callMeWithFlowId(page, FLOW_ID_B);
      ev.meStatus = meResult.status;
      ev.meBody = meResult.body;

      if (meResult.status === 200 && meResult.body && typeof meResult.body === "object") {
        const user = (meResult.body as { user?: { id?: string; email?: string; username?: string } }).user;
        ev.localUserId = user?.id ?? null;
        ev.localEmail = user?.email ?? null;
        ev.localUsername = user?.username ?? null;
      }
    }

    // Kall diagnostikk-endepunktet
    evidence.diagnosticAfter = await callDiagnostic(page);

    evidence.secondSignup = ev;
    console.log(`\nSecond signup: clerkId=${ev.clerkUserId}, localId=${ev.localUserId}, meStatus=${ev.meStatus}`);
    console.log(`Username conflict modal: ${ev.usernameConflictModalShown}`);
    console.log(`Account conflict signout: ${ev.accountConflictSignout}`);
  });
});
