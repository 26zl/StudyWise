import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, type Page } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Auth Duplicate Signup Reproduction Test
 *
 * Automates the duplicate-signup scenario to capture runtime evidence.
 *
 * What it does:
 * 1. Sign up with email/password (Account A)
 * 2. Capture /me response + dashboard state
 * 3. Sign out
 * 4. Attempt second signup with same email and/or username
 * 5. Capture what happens: redirect, /me status, errors, conflict modals
 * 6. Call diagnostic endpoint before/after
 * 7. Save evidence summary
 *
 * NOTE: This test uses Clerk's email/password flow (not OAuth) because
 * OAuth (Google/Microsoft) cannot be automated without real credentials.
 * The test is designed to be extended for OAuth later.
 *
 * Prerequisites:
 * - Backend running with ENABLE_AUTH_DIAGNOSTICS=true
 * - Frontend running on localhost:3000
 * - Clerk dev instance (pk_test_) allows email/password signup
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
 * Capture console logs and errors from the page.
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
 * Attempt to call the diagnostic endpoint.
 * Returns parsed JSON or null if not available.
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
 * Wait for Clerk to be loaded and extract the current Clerk user ID.
 */
async function getClerkUserId(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerk = (window as any).Clerk;
      if (!clerk) return null;
      // Wait for Clerk to load
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
 * Call /me with the debug flow-id header.
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
 * Fill the Clerk signup form with email/password.
 * This handles the standard Clerk dev-mode signup widget.
 */
async function fillClerkSignupForm(page: Page, email: string, username: string, password: string) {
  // Wait for Clerk signup form to appear
  await page.waitForSelector('[data-clerk-element="signUp"]', { timeout: 15000 }).catch(() => {
    // Clerk may use different selectors in different versions
  });

  // Try to find and fill the email field
  const emailInput = page.locator('input[name="emailAddress"], input[type="email"]').first();
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailInput.fill(email);
  }

  // Try to find and fill username field
  const usernameInput = page.locator('input[name="username"]').first();
  if (await usernameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await usernameInput.fill(username);
  }

  // Fill password
  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await passwordInput.fill(password);
  }

  // Click the submit / continue button
  const submitButton = page.locator('button[data-clerk-form-action="submit"], button:has-text("Continue"), button:has-text("Sign up"), button:has-text("Registrer")').first();
  if (await submitButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await submitButton.click();
  }
}

/**
 * Check for Clerk verification code step (email OTP in dev mode).
 * In Clerk dev mode, the OTP may be auto-filled or a specific code may work.
 */
async function handleVerificationStep(page: Page) {
  // In Clerk dev mode, look for the OTP/verification code input
  const otpInput = page.locator('input[name="code"], input[data-clerk-element="otpInput"]').first();
  const isOtpStep = await otpInput.isVisible({ timeout: 5000 }).catch(() => false);

  if (isOtpStep) {
    // In dev mode, Clerk often shows a banner with the verification code
    // or uses the code "424242" — try the page text for a code
    const pageText = await page.textContent("body") ?? "";
    const codeMatch = pageText.match(/(?:verification|code)[^\d]*(\d{6})/i);
    if (codeMatch) {
      await otpInput.fill(codeMatch[1]);
    } else {
      // Clerk dev instances often auto-complete; wait and see
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

  // Check if same Clerk user
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
// TEST
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

    // Inject Clerk testing token to bypass Turnstile bot protection
    await setupClerkTestingToken({ page });

    await page.goto("/auth/sign-up");
    await page.waitForLoadState("domcontentloaded");

    // Fill the Clerk signup form
    await fillClerkSignupForm(page, TEST_EMAIL, TEST_USERNAME, TEST_PASSWORD);

    // Handle potential verification step
    await handleVerificationStep(page);

    // Wait for redirect to dashboard (up to 30s)
    try {
      await page.waitForURL("**/dashboard**", { timeout: 30000 });
      ev.signupCompleted = true;
      ev.redirectedTo = page.url();
    } catch {
      ev.redirectedTo = page.url();
      ev.errors.push(`Signup did not redirect to dashboard, stuck at: ${page.url()}`);
    }

    // If we made it to dashboard, capture evidence
    if (ev.signupCompleted) {
      // Wait for Clerk to fully initialize
      await page.waitForTimeout(3000);

      ev.clerkUserId = await getClerkUserId(page);

      // Call /me with flow id
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

    // Sign out
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

    // Inject Clerk testing token to bypass Turnstile bot protection
    await setupClerkTestingToken({ page });

    await page.goto("/auth/sign-up");
    await page.waitForLoadState("domcontentloaded");

    // Fill the same email and username
    await fillClerkSignupForm(page, TEST_EMAIL, TEST_USERNAME, TEST_PASSWORD);

    // Wait to see what happens — could be:
    // 1. Clerk blocks it (error in signup form)
    // 2. Clerk creates new user and redirects
    // 3. Clerk merges and redirects

    // Check for Clerk-level errors first
    await page.waitForTimeout(3000);
    const currentUrl = page.url();

    // Check if Clerk showed an error (email already taken, etc.)
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

    // Handle verification step if present
    await handleVerificationStep(page);

    // Wait for redirect or error
    try {
      await page.waitForURL("**/dashboard**", { timeout: 30000 });
      ev.signupCompleted = true;
      ev.redirectedTo = page.url();
    } catch {
      ev.redirectedTo = page.url();
    }

    // Wait for page to settle
    await page.waitForTimeout(3000);

    // Check for username conflict modal
    const usernameModal = await page.locator('[role="dialog"]:has-text("brukernavn"), [role="dialog"]:has-text("username")')
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    ev.usernameConflictModalShown = usernameModal;

    // Check if we got signed out (account conflict)
    const signInPageVisible = page.url().includes("/auth/sign-in") || page.url().includes("/auth/sign-up");
    if (signInPageVisible && !page.url().includes("/auth/sign-up")) {
      ev.accountConflictSignout = true;
    }

    // Capture Clerk user ID
    ev.clerkUserId = await getClerkUserId(page);

    // Try to call /me
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

    // Call diagnostic endpoint
    evidence.diagnosticAfter = await callDiagnostic(page);

    evidence.secondSignup = ev;
    console.log(`\nSecond signup: clerkId=${ev.clerkUserId}, localId=${ev.localUserId}, meStatus=${ev.meStatus}`);
    console.log(`Username conflict modal: ${ev.usernameConflictModalShown}`);
    console.log(`Account conflict signout: ${ev.accountConflictSignout}`);
  });
});
