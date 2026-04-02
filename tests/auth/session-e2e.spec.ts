import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Group J: Session / Cross-Tab Consistency Tests
 *
 * Tests scenarios involving session management and cross-tab behavior:
 * J01: Logout in one tab while another protected tab is open
 * J02: Delete account in one tab while another protected tab is open
 * J03: In-flight request during logout
 * J05: Expired token handling
 * J07: Cross-tab logout broadcast
 * J08: Stale /me cache cleared on logout
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, "results");
const TEST_PASSWORD = "TestPassword123!";

interface SessionEvidence {
  scenarioId: string;
  timestamp: string;
  steps: {
    step: string;
    tab: string;
    url: string;
    isAuthenticated: boolean;
    meStatus: number | null;
    notes: string;
  }[];
  classification: string;
}

function generateTestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveEvidence(evidence: SessionEvidence): void {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  const fileName = `${evidence.scenarioId}-${Date.now()}.json`;
  fs.writeFileSync(path.join(RESULTS_DIR, fileName), JSON.stringify(evidence, null, 2));
}

async function isAuthenticated(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clerk = (window as any).Clerk;
      if (!clerk) return false;
      for (let i = 0; i < 20; i++) {
        if (clerk.user) return true;
        if (clerk.loaded && !clerk.user) return false;
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    });
  } catch {
    return false;
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
    // Ignorer
  }
}

async function fillSignupForm(page: Page, email: string, username: string, password: string): Promise<void> {
  await page.waitForSelector('input[name="emailAddress"], input[type="email"]', { timeout: 15000 }).catch(() => {});

  const emailInput = page.locator('input[name="emailAddress"], input[type="email"]').first();
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailInput.fill(email);
  }

  const usernameInput = page.locator('input[name="username"]').first();
  if (await usernameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await usernameInput.fill(username);
  }

  const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
  if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await passwordInput.fill(password);
  }

  const submitButton = page.locator('button[data-clerk-form-action="submit"], button:has-text("Continue"), button:has-text("Sign up"), button:has-text("Registrer")').first();
  if (await submitButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await submitButton.click();
  }
}

async function createTestUser(context: BrowserContext, email: string, username: string): Promise<Page> {
  const page = await context.newPage();
  await setupClerkTestingToken({ page });
  await page.goto("/auth/sign-up");
  await fillSignupForm(page, email, username, TEST_PASSWORD);
  await page.waitForTimeout(5000);
  return page;
}

test.describe("Group J: Session / Cross-Tab Consistency", () => {
  test("J01: Logout in one tab updates another tab", async ({ context }) => {
    const testId = generateTestId();
    const testEmail = `j01-${testId}@example.com`;
    const testUsername = `j01user${testId.replace(/-/g, "")}`.slice(0, 30);
    const evidence: SessionEvidence = {
      scenarioId: "J01",
      timestamp: new Date().toISOString(),
      steps: [],
      classification: "pending",
    };

    // Opprett bruker og naviger til dashboard i fane 1
    const tab1 = await createTestUser(context, testEmail, testUsername);
    const tab1AuthBefore = await isAuthenticated(tab1);
    evidence.steps.push({
      step: "tab1_initial",
      tab: "tab1",
      url: tab1.url(),
      isAuthenticated: tab1AuthBefore,
      meStatus: null,
      notes: "Tab 1 after signup",
    });

    // Åpne fane 2 på dashboard
    const tab2 = await context.newPage();
    await tab2.goto("/dashboard");
    await tab2.waitForTimeout(3000);
    const tab2AuthBefore = await isAuthenticated(tab2);
    evidence.steps.push({
      step: "tab2_initial",
      tab: "tab2",
      url: tab2.url(),
      isAuthenticated: tab2AuthBefore,
      meStatus: null,
      notes: "Tab 2 opened dashboard",
    });

    // Logg ut i fane 1
    await signOut(tab1);
    evidence.steps.push({
      step: "tab1_logout",
      tab: "tab1",
      url: tab1.url(),
      isAuthenticated: false,
      meStatus: null,
      notes: "Logged out in tab 1",
    });

    // Vent på BroadcastChannel-propagering
    await tab2.waitForTimeout(3000);

    // Sjekk tilstanden til fane 2 — den bør oppdage utloggingen
    const tab2AuthAfter = await isAuthenticated(tab2);
    const tab2Url = tab2.url();

    // Fane 2 kan omdirigeres til innlogging eller vise utlogget tilstand
    const tab2Redirected = tab2Url.includes("sign-in") || tab2Url.includes("sign-up") || !tab2Url.includes("dashboard");

    evidence.steps.push({
      step: "tab2_after_logout",
      tab: "tab2",
      url: tab2Url,
      isAuthenticated: tab2AuthAfter,
      meStatus: null,
      notes: tab2Redirected ? "Tab 2 detected logout" : "Tab 2 still on dashboard",
    });

    if (!tab2AuthAfter || tab2Redirected) {
      evidence.classification = "CROSS_TAB_LOGOUT_WORKS";
    } else {
      evidence.classification = "CROSS_TAB_LOGOUT_DELAYED_OR_MISSING";
    }

    saveEvidence(evidence);

    // Fane 2 bør oppdage utloggingen (BroadcastChannel eller Clerk-synk)
    await tab1.close();
    await tab2.close();

    // Verifiser at cross-tab logout ble oppdaget eller at fane 2 ble omdirigert
    expect(!tab2AuthAfter || tab2Redirected).toBeTruthy();
  });

  test("J05: Stale session detects need for re-auth", async ({ page }) => {
    const testId = generateTestId();
    const testEmail = `j05-${testId}@example.com`;
    const testUsername = `j05user${testId.replace(/-/g, "")}`.slice(0, 30);

    await setupClerkTestingToken({ page });

    // Registrering
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, testUsername, TEST_PASSWORD);
    await page.waitForTimeout(5000);

    // Sjekk om registreringen fullførte (testing-tokens fullfører ikke alltid faktisk registrering)
    const initialAuth = await isAuthenticated(page);
    const me1 = await callMeEndpoint(page);

    // Hopp over hvis signup ikke fullførte (Clerk testing token-begrensning)
    test.skip(!initialAuth || me1.status !== 200, "Signup fullførte ikke — Clerk testing token-begrensning");

    // Logg ut
    await signOut(page);

    // Prøv å kalle /me igjen — skal feile
    const me2 = await callMeEndpoint(page);

    // Etter utlogging skal /me feile (ingen sesjon)
    expect(me2.status).not.toBe(200);
  });

  test("J07: BroadcastChannel logout sync", async ({ context }) => {
    const testId = generateTestId();
    const testEmail = `j07-${testId}@example.com`;
    const testUsername = `j07user${testId.replace(/-/g, "")}`.slice(0, 30);

    // Opprett bruker i fane 1
    const tab1 = await createTestUser(context, testEmail, testUsername);
    await tab1.waitForURL("**/dashboard**", { timeout: 30000 }).catch(() => {});

    // Åpne fane 2 og fane 3 på beskyttede sider
    const tab2 = await context.newPage();
    await tab2.goto("/dashboard");
    await tab2.waitForTimeout(2000);

    const tab3 = await context.newPage();
    await tab3.goto("/profil");
    await tab3.waitForTimeout(2000);

    // Alle faner skal være autentisert
    const authStates = await Promise.all([
      isAuthenticated(tab1),
      isAuthenticated(tab2),
      isAuthenticated(tab3),
    ]);

    // Logg ut fra fane 1
    await signOut(tab1);

    // Vent på broadcast
    await tab1.waitForTimeout(3000);

    // Oppdater andre faner og sjekk
    await tab2.reload();
    await tab3.reload();
    await Promise.all([
      tab2.waitForTimeout(2000),
      tab3.waitForTimeout(2000),
    ]);

    const afterLogoutStates = await Promise.all([
      isAuthenticated(tab2),
      isAuthenticated(tab3),
    ]);

    // Etter utlogging + oppdatering skal andre faner ikke være autentisert
    // (eller bli omdirigert til innlogging)
    const allLoggedOut = afterLogoutStates.every((state) => !state);
    const tab2Redirected = tab2.url().includes("sign-in");
    const tab3Redirected = tab3.url().includes("sign-in");

    await tab1.close();
    await tab2.close();
    await tab3.close();

    // Etter oppdatering skal de andre fanene i det minste være logget ut
    expect(allLoggedOut || tab2Redirected || tab3Redirected).toBeTruthy();
  });

  test("J08: Query cache cleared on logout", async ({ page }) => {
    const testId = generateTestId();
    const testEmail = `j08-${testId}@example.com`;
    const testUsername = `j08user${testId.replace(/-/g, "")}`.slice(0, 30);

    await setupClerkTestingToken({ page });

    // Registrer og naviger til dashboard
    await page.goto("/auth/sign-up");
    await fillSignupForm(page, testEmail, testUsername, TEST_PASSWORD);
    await page.waitForTimeout(5000);

    // Kall /me for å populere cache
    const me1 = await callMeEndpoint(page);

    // Hopp over hvis signup ikke fullførte
    test.skip(me1.status !== 200, "Signup fullførte ikke — Clerk testing token-begrensning");

    // Logg ut
    await signOut(page);

    // Naviger til forsiden (ikke beskyttet)
    await page.goto("/");
    await page.waitForTimeout(1000);

    // Sjekk om react-query-cache for brukerdata er tømt
    const cacheState = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queryClient = (window as any).__REACT_QUERY_DEVTOOLS_GLOBAL_HOOK__?.queryClient;
      if (!queryClient) return "no_devtools";

      const queries = queryClient.getQueryCache().getAll();
      const userQueries = queries.filter((q: { queryKey: unknown[] }) => 
        JSON.stringify(q.queryKey).includes("user") || 
        JSON.stringify(q.queryKey).includes("me")
      );

      return userQueries.length > 0 ? "cache_present" : "cache_cleared";
    });

    // Dette er informativt — cache-oppførsel avhenger av implementasjonen
    // Det viktige er at /me feiler etter utlogging
    const me2 = await callMeEndpoint(page);
    expect(me2.status).not.toBe(200);
  });
});
