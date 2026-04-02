/**
 * Auth Matrix Scenario Definitions
 *
 * Comprehensive scenario coverage for auth identity testing:
 * - Group A: Basic signup uniqueness (12 scenarios)
 * - Group B: Login vs signup confusion (4 scenarios)
 * - Group C: Google/OAuth vs email (7 scenarios)
 * - Group D: Email vs Google/OAuth (6 scenarios)
 * - Group E: Microsoft/OAuth (7 scenarios)
 * - Group F: SSO linking / provider reuse (7 scenarios)
 * - Group G: Username update scenarios (6 scenarios)
 * - Group H: Email update scenarios (5 scenarios)
 * - Group I: Duplicate detection after deletion (8 scenarios)
 * - Group J: Logout / session / cross-tab (8 scenarios)
 * - Group K: Late-conflict / frontend-illusion (8 scenarios)
 * - Group L: Race / concurrency (7 scenarios)
 * - Group M: Normalization and data-integrity (9 scenarios)
 * - Group N: Clerk/local consistency (9 scenarios)
 * - Group O: Recovery / failed-state (10 scenarios)
 * - Group P: Security and abuse-adjacent (7 scenarios)
 *
 * Total: 120 scenarios
 */

// ============================================================================
// Types
// ============================================================================

export type Provider = "email" | "google" | "microsoft";

export type ScenarioKind =
  | "executable"      // Can be fully automated via Clerk Backend API
  | "api_manual"      // API automation possible but requires manual identity setup
  | "e2e_browser"     // Requires browser automation (Playwright)
  | "e2e_oauth"       // Requires real OAuth provider interaction
  | "manual"          // Fully manual
  | "race_condition"  // Requires concurrent execution
  | "admin_only";     // Requires Clerk dashboard admin action

export type ScenarioStatus =
  | "executed"
  | "manual_required"
  | "setup_failed"
  | "skipped"
  | "partial";

export type ScenarioGroup =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"
  | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P";

export interface IdentitySpec {
  provider: Provider;
  email: string;
  username: string;
  emailCasing?: "lowercase" | "uppercase" | "mixed";
  usernameCasing?: "lowercase" | "uppercase" | "mixed";
  whitespace?: "none" | "leading" | "trailing" | "both";
  invalid?: boolean;
  invalidReason?: string;
}

export interface BaseScenario {
  id: string;
  group: ScenarioGroup;
  groupName: string;
  scenarioNumber: number;
  description: string;
  kind: ScenarioKind;
  automatable: boolean;
  requiresE2e: boolean;
  requiresOAuth: boolean;
  requiresAdmin: boolean;
  expectedOutcome: string;
  tags: string[];
}

export interface ExecutableScenario extends BaseScenario {
  kind: "executable" | "api_manual";
  first: IdentitySpec;
  second?: IdentitySpec;
  action?: "signup" | "login" | "update" | "delete" | "link";
}

export interface E2eScenario extends BaseScenario {
  kind: "e2e_browser" | "e2e_oauth";
  setupSteps: string[];
  executionSteps: string[];
  capturePoints: string[];
}

export interface ManualScenario extends BaseScenario {
  kind: "manual" | "admin_only";
  blocker: string;
  manualSteps: string[];
}

export interface RaceScenario extends BaseScenario {
  kind: "race_condition";
  concurrentActions: string[];
  expectedRace: string;
}

export type ScenarioDefinition = ExecutableScenario | E2eScenario | ManualScenario | RaceScenario;

// ============================================================================
// Scenario Builder Helpers
// ============================================================================

let runSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function setRunSeed(seed: string): void {
  runSeed = seed;
}

export function makeEmail(label: string, options?: { casing?: "uppercase" | "mixed"; whitespace?: "leading" | "trailing" | "both" }): string {
  let email = `auth-matrix-${label}-${runSeed}@example.com`;
  if (options?.casing === "uppercase") {
    email = email.toUpperCase();
  } else if (options?.casing === "mixed") {
    email = email.split("").map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join("");
  }
  if (options?.whitespace === "leading") {
    email = "  " + email;
  } else if (options?.whitespace === "trailing") {
    email = email + "  ";
  } else if (options?.whitespace === "both") {
    email = "  " + email + "  ";
  }
  return email;
}

export function makeUsername(label: string, options?: {
  casing?: "uppercase" | "mixed";
  whitespace?: "leading" | "trailing" | "both";
  invalid?: "special_chars" | "too_short" | "too_long";
}): string {
  let username = `mx_${label}_${runSeed.replace(/-/g, "")}`.slice(0, 30);
  if (options?.casing === "uppercase") {
    username = username.toUpperCase();
  } else if (options?.casing === "mixed") {
    username = username.split("").map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join("");
  }
  if (options?.whitespace === "leading") {
    username = "  " + username;
  } else if (options?.whitespace === "trailing") {
    username = username + "  ";
  } else if (options?.whitespace === "both") {
    username = "  " + username + "  ";
  }
  if (options?.invalid === "special_chars") {
    username = username + "@#$%";
  } else if (options?.invalid === "too_short") {
    username = "ab";
  } else if (options?.invalid === "too_long") {
    username = "a".repeat(100);
  }
  return username;
}

// ============================================================================
// Group A: Basic Signup Uniqueness (12 scenarios)
// ============================================================================

export function buildGroupA(): ScenarioDefinition[] {
  return [
    {
      id: "A01-signup-control-different-all",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 1,
      description: "Control: Signup A with email E1, username U1; Signup B with email E2, username U2",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "TWO_DISTINCT_LOCAL_USERS",
      tags: ["signup", "control", "baseline"],
      first: { provider: "email", email: makeEmail("a01-first"), username: makeUsername("a01first") },
      second: { provider: "email", email: makeEmail("a01-second"), username: makeUsername("a01second") },
    },
    {
      id: "A02-signup-same-email-same-username",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 2,
      description: "Signup B with same email E1, same username U1",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL",
      tags: ["signup", "duplicate-email", "duplicate-username"],
      first: { provider: "email", email: makeEmail("a02-shared"), username: makeUsername("a02shared") },
      second: { provider: "email", email: makeEmail("a02-shared"), username: makeUsername("a02shared") },
    },
    {
      id: "A03-signup-same-email-diff-username",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 3,
      description: "Signup B with same email E1, different username U2",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL",
      tags: ["signup", "duplicate-email"],
      first: { provider: "email", email: makeEmail("a03-shared"), username: makeUsername("a03first") },
      second: { provider: "email", email: makeEmail("a03-shared"), username: makeUsername("a03second") },
    },
    {
      id: "A04-signup-diff-email-same-username",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 4,
      description: "Signup B with different email E2, same username U1",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_USERNAME",
      tags: ["signup", "duplicate-username"],
      first: { provider: "email", email: makeEmail("a04-first"), username: makeUsername("a04shared") },
      second: { provider: "email", email: makeEmail("a04-second"), username: makeUsername("a04shared") },
    },
    {
      id: "A05-signup-same-email-diff-casing",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 5,
      description: "Signup B with same email but UPPERCASE casing",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL",
      tags: ["signup", "normalization", "email-casing"],
      first: { provider: "email", email: makeEmail("a05-shared").toLowerCase(), username: makeUsername("a05first") },
      second: { provider: "email", email: makeEmail("a05-shared").toUpperCase(), username: makeUsername("a05second"), emailCasing: "uppercase" },
    },
    {
      id: "A06-signup-same-username-diff-casing",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 6,
      description: "Signup B with same username but different casing",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_USERNAME",
      tags: ["signup", "normalization", "username-casing"],
      first: { provider: "email", email: makeEmail("a06-first"), username: makeUsername("a06shared").toLowerCase() },
      second: { provider: "email", email: makeEmail("a06-second"), username: makeUsername("a06shared").toUpperCase(), usernameCasing: "uppercase" },
    },
    {
      id: "A07-signup-email-leading-whitespace",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 7,
      description: "Signup B with leading/trailing whitespace in email",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_OR_NORMALIZED",
      tags: ["signup", "normalization", "whitespace"],
      first: { provider: "email", email: makeEmail("a07-shared"), username: makeUsername("a07first") },
      second: { provider: "email", email: makeEmail("a07-shared", { whitespace: "both" }), username: makeUsername("a07second"), whitespace: "both" },
    },
    {
      id: "A08-signup-username-leading-whitespace",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 8,
      description: "Signup B with leading/trailing whitespace in username",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_VALIDATION_ERROR_OR_NORMALIZED",
      tags: ["signup", "normalization", "whitespace"],
      first: { provider: "email", email: makeEmail("a08-first"), username: makeUsername("a08shared") },
      second: { provider: "email", email: makeEmail("a08-second"), username: makeUsername("a08shared", { whitespace: "both" }), whitespace: "both" },
    },
    {
      id: "A09-signup-invalid-username-special-chars",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 9,
      description: "Signup B with invalid username characters (@#$%)",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_VALIDATION_ERROR",
      tags: ["signup", "validation", "invalid-input"],
      first: { provider: "email", email: makeEmail("a09-first"), username: makeUsername("a09first") },
      second: { provider: "email", email: makeEmail("a09-second"), username: makeUsername("a09second", { invalid: "special_chars" }), invalid: true, invalidReason: "special_characters" },
    },
    {
      id: "A10-signup-invalid-username-too-short",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 10,
      description: "Signup B with too-short username (2 chars)",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_VALIDATION_ERROR",
      tags: ["signup", "validation", "invalid-input"],
      first: { provider: "email", email: makeEmail("a10-first"), username: makeUsername("a10first") },
      second: { provider: "email", email: makeEmail("a10-second"), username: makeUsername("a10second", { invalid: "too_short" }), invalid: true, invalidReason: "too_short" },
    },
    {
      id: "A11-signup-invalid-username-too-long",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 11,
      description: "Signup B with too-long username (100 chars)",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_VALIDATION_ERROR",
      tags: ["signup", "validation", "invalid-input"],
      first: { provider: "email", email: makeEmail("a11-first"), username: makeUsername("a11first") },
      second: { provider: "email", email: makeEmail("a11-second"), username: makeUsername("a11second", { invalid: "too_long" }), invalid: true, invalidReason: "too_long" },
    },
    {
      id: "A12-signup-mixed-casing-email-username",
      group: "A",
      groupName: "Basic Signup Uniqueness",
      scenarioNumber: 12,
      description: "Signup B with mixed casing in both email and username",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL_OR_USERNAME",
      tags: ["signup", "normalization", "edge-case"],
      first: { provider: "email", email: makeEmail("a12-shared").toLowerCase(), username: makeUsername("a12shared").toLowerCase() },
      second: { provider: "email", email: makeEmail("a12-shared", { casing: "mixed" }), username: makeUsername("a12shared", { casing: "mixed" }), emailCasing: "mixed", usernameCasing: "mixed" },
    },
  ];
}

// ============================================================================
// Group B: Login vs Signup Confusion (4 scenarios)
// ============================================================================

export function buildGroupB(): ScenarioDefinition[] {
  return [
    {
      id: "B01-login-after-signup",
      group: "B",
      groupName: "Login vs Signup Confusion",
      scenarioNumber: 1,
      description: "Signup A with email/password, logout, then sign-in with same account",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "LOGIN_SUCCESS_SAME_USER",
      tags: ["login", "session"],
      setupSteps: [
        "Create Clerk user via API",
        "Call test-auth-flow to create local user",
      ],
      executionSteps: [
        "Navigate to /sign-in",
        "Enter credentials",
        "Submit form",
        "Verify redirect to dashboard",
      ],
      capturePoints: [
        "/api/user/me response",
        "Local user ID matches",
        "Session token present",
      ],
    },
    {
      id: "B02-signup-again-same-identity",
      group: "B",
      groupName: "Login vs Signup Confusion",
      scenarioNumber: 2,
      description: "After signup A, logout, try sign-up again with same email/username",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_AT_SIGNUP_FORM",
      tags: ["signup", "duplicate"],
      setupSteps: [
        "Create Clerk user A via API",
        "Establish local user via test-auth-flow",
      ],
      executionSteps: [
        "Navigate to /sign-up",
        "Enter same email and username",
        "Submit form",
        "Capture error state",
      ],
      capturePoints: [
        "Clerk error message in UI",
        "No redirect to dashboard",
        "No second local user created",
      ],
    },
    {
      id: "B03-signup-redirected-to-login",
      group: "B",
      groupName: "Login vs Signup Confusion",
      scenarioNumber: 3,
      description: "Verify whether existing user signup redirects to login or shows error",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "REDIRECT_OR_CLEAR_ERROR",
      tags: ["signup", "ux"],
      setupSteps: [
        "Create Clerk user A",
        "Establish local user",
      ],
      executionSteps: [
        "Navigate to /sign-up",
        "Enter existing email",
        "Observe whether redirected or shown error",
      ],
      capturePoints: [
        "Current URL after submit",
        "Error message if any",
        "Whether user perceives success vs failure",
      ],
    },
    {
      id: "B04-signup-silent-reuse-check",
      group: "B",
      groupName: "Login vs Signup Confusion",
      scenarioNumber: 4,
      description: "Verify signup doesn't silently reuse existing account creating frontend illusion",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "NO_SILENT_REUSE",
      tags: ["signup", "security"],
      setupSteps: [
        "Create Clerk user A with email/username",
        "Establish local user",
      ],
      executionSteps: [
        "Navigate to /sign-up",
        "Fill form with existing email",
        "Check whether user is logged in as A without clear indication",
      ],
      capturePoints: [
        "/api/user/me user ID",
        "Whether user was informed about existing account",
        "Whether dashboard access happened",
      ],
    },
  ];
}

// ============================================================================
// Group C: Google/OAuth vs Email/Password (7 scenarios)
// ============================================================================

export function buildGroupC(): ScenarioDefinition[] {
  return [
    {
      id: "C01-google-then-email-same-email-same-username",
      group: "C",
      groupName: "Google/OAuth vs Email",
      scenarioNumber: 1,
      description: "Signup A with Google (E1, U1), then signup B with email/password (E1, U1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_OR_MERGED",
      tags: ["oauth", "google", "duplicate-email"],
      setupSteps: [
        "Sign up with real Google account",
        "Capture Clerk user state",
        "Capture local user state",
      ],
      executionSteps: [
        "Sign out",
        "Navigate to /sign-up",
        "Try email/password signup with same email",
      ],
      capturePoints: [
        "Clerk user IDs (same or different?)",
        "Local user IDs (same or different?)",
        "Error message or merge behavior",
      ],
    },
    {
      id: "C02-google-then-email-same-email-diff-username",
      group: "C",
      groupName: "Google/OAuth vs Email",
      scenarioNumber: 2,
      description: "Signup A with Google (E1, U1), then signup B with email/password (E1, U2)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL",
      tags: ["oauth", "google", "duplicate-email"],
      setupSteps: [
        "Sign up with real Google account",
        "Complete username selection",
      ],
      executionSteps: [
        "Sign out",
        "Try email/password signup with same email, different username",
      ],
      capturePoints: [
        "Whether Clerk blocks at email",
        "Whether different username is attempted",
      ],
    },
    {
      id: "C03-google-then-email-diff-email-same-username",
      group: "C",
      groupName: "Google/OAuth vs Email",
      scenarioNumber: 3,
      description: "Signup A with Google (E1, U1), then signup B with email/password (E2, U1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_USERNAME",
      tags: ["oauth", "google", "duplicate-username"],
      setupSteps: [
        "Sign up with Google, set username U1",
      ],
      executionSteps: [
        "Sign out",
        "Try email/password signup with different email, same username",
      ],
      capturePoints: [
        "Whether username collision is caught",
        "At what stage (Clerk or backend)",
      ],
    },
    {
      id: "C04-google-clerk-user-state",
      group: "C",
      groupName: "Google/OAuth vs Email",
      scenarioNumber: 4,
      description: "Capture whether Clerk reuses same user or creates new for Google+email collision",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_CLERK_BEHAVIOR",
      tags: ["oauth", "google", "clerk-investigation"],
      blocker: "Requires real Google OAuth flow",
      manualSteps: [
        "Sign up with Google",
        "Record Clerk user ID",
        "Sign out",
        "Sign up with email/password using same email",
        "Record whether new Clerk user or same",
      ],
    },
    {
      id: "C05-google-local-db-state",
      group: "C",
      groupName: "Google/OAuth vs Email",
      scenarioNumber: 5,
      description: "Capture whether local backend reuses same user or creates duplicate for Google+email",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_LOCAL_BEHAVIOR",
      tags: ["oauth", "google", "db-investigation"],
      blocker: "Requires real Google OAuth flow",
      manualSteps: [
        "Sign up with Google",
        "Query Users collection for this email",
        "Sign out",
        "Attempt email/password signup",
        "Query Users collection again",
        "Compare user document count and IDs",
      ],
    },
    {
      id: "C06-google-external-account-link",
      group: "C",
      groupName: "Google/OAuth vs Email",
      scenarioNumber: 6,
      description: "Test linking Google to existing email/password account",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "LINK_SUCCESS_OR_BLOCKED",
      tags: ["oauth", "google", "linking"],
      setupSteps: [
        "Create email/password account",
      ],
      executionSteps: [
        "Navigate to profile/connected accounts",
        "Attempt to link Google with same email",
      ],
      capturePoints: [
        "Whether link succeeds",
        "Whether oauthAccounts array updated",
      ],
    },
    {
      id: "C07-google-multiple-accounts-same-email",
      group: "C",
      groupName: "Google/OAuth vs Email",
      scenarioNumber: 7,
      description: "Test edge case: multiple Google accounts with same email domain patterns",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_EDGE_CASE",
      tags: ["oauth", "google", "edge-case"],
      blocker: "Requires multiple Google accounts",
      manualSteps: [
        "Sign up with Google account A (e.g., user@gmail.com)",
        "Sign out",
        "Sign up with Google account B (e.g., user+alias@gmail.com)",
        "Observe whether treated as same or different",
      ],
    },
  ];
}

// ============================================================================
// Group D: Email/Password vs Google/OAuth (6 scenarios)
// ============================================================================

export function buildGroupD(): ScenarioDefinition[] {
  return [
    {
      id: "D01-email-then-google-same-email",
      group: "D",
      groupName: "Email vs Google/OAuth",
      scenarioNumber: 1,
      description: "Signup A with email/password (E1, U1), then signup B with Google (same email)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_MERGE_OR_BLOCK",
      tags: ["oauth", "google", "cross-provider"],
      setupSteps: [
        "Create Clerk user via API with email/password",
        "Establish local user",
      ],
      executionSteps: [
        "Sign out",
        "Click 'Sign up with Google' using same email",
        "Complete OAuth flow",
      ],
      capturePoints: [
        "Whether Clerk merges accounts",
        "Whether local user is reused",
        "externalAccounts array state",
      ],
    },
    {
      id: "D02-email-then-google-same-username",
      group: "D",
      groupName: "Email vs Google/OAuth",
      scenarioNumber: 2,
      description: "Signup A with email/password (E1, U1), then signup B with Google (E2, U1 if possible)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "USERNAME_CONFLICT_IF_REACHABLE",
      tags: ["oauth", "google", "duplicate-username"],
      setupSteps: [
        "Create email/password user with username U1",
      ],
      executionSteps: [
        "Sign out",
        "Sign up with Google (different email)",
        "Attempt to set username to U1",
      ],
      capturePoints: [
        "Whether username conflict caught",
        "At what stage",
      ],
    },
    {
      id: "D03-email-then-google-clerk-reuse",
      group: "D",
      groupName: "Email vs Google/OAuth",
      scenarioNumber: 3,
      description: "Capture Clerk reuse vs new user when adding Google to email account",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_CLERK_BEHAVIOR",
      tags: ["oauth", "google", "clerk-investigation"],
      blocker: "Requires real Google OAuth",
      manualSteps: [
        "Create email/password user, record Clerk ID",
        "Sign out",
        "Sign up/in with Google using same email",
        "Record whether new Clerk ID or same",
      ],
    },
    {
      id: "D04-email-then-google-local-db-reuse",
      group: "D",
      groupName: "Email vs Google/OAuth",
      scenarioNumber: 4,
      description: "Capture local DB reuse vs duplicate when adding Google to email account",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_LOCAL_BEHAVIOR",
      tags: ["oauth", "google", "db-investigation"],
      blocker: "Requires real Google OAuth",
      manualSteps: [
        "Create email/password user, record local _id",
        "Sign out",
        "Sign up/in with Google using same email",
        "Query DB for this email",
        "Compare user count and IDs",
      ],
    },
    {
      id: "D05-email-password-google-link-existing",
      group: "D",
      groupName: "Email vs Google/OAuth",
      scenarioNumber: 5,
      description: "Link Google to existing email/password from profile page",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "LINK_SUCCESS_OAUTH_ARRAY_UPDATED",
      tags: ["oauth", "google", "linking"],
      setupSteps: [
        "Create email/password account, log in",
      ],
      executionSteps: [
        "Navigate to profile",
        "Click 'Connect Google'",
        "Complete OAuth",
      ],
      capturePoints: [
        "User.oauthAccounts after link",
        "Whether provider synced",
      ],
    },
    {
      id: "D06-email-password-google-link-conflict",
      group: "D",
      groupName: "Email vs Google/OAuth",
      scenarioNumber: 6,
      description: "Link Google that is already linked to another local account",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "OAUTH_CONFLICT_BLOCKED",
      tags: ["oauth", "google", "linking", "conflict"],
      setupSteps: [
        "Create account A, link Google",
        "Create account B",
      ],
      executionSteps: [
        "Log in as B",
        "Try to link same Google account",
      ],
      capturePoints: [
        "Error message",
        "Whether oauthAccountConflict returned",
      ],
    },
  ];
}

// ============================================================================
// Group E: Microsoft/OAuth (7 scenarios)
// ============================================================================

export function buildGroupE(): ScenarioDefinition[] {
  return [
    {
      id: "E01-microsoft-then-email-same-email",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 1,
      description: "Microsoft signup A (E1, U1), then email/password signup B (E1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_OR_MERGED",
      tags: ["oauth", "microsoft", "duplicate-email"],
      setupSteps: ["Sign up with Microsoft"],
      executionSteps: ["Sign out", "Try email/password signup with same email"],
      capturePoints: ["Clerk behavior", "Local DB state"],
    },
    {
      id: "E02-microsoft-then-email-same-username",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 2,
      description: "Microsoft signup A (E1, U1), then email/password signup B (E2, U1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_USERNAME",
      tags: ["oauth", "microsoft", "duplicate-username"],
      setupSteps: ["Sign up with Microsoft, set username U1"],
      executionSteps: ["Sign out", "Try email/password signup with U1"],
      capturePoints: ["Username conflict detection"],
    },
    {
      id: "E03-email-then-microsoft-same-email",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 3,
      description: "Email/password signup A (E1, U1), then Microsoft signup B (E1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_MERGE_OR_BLOCK",
      tags: ["oauth", "microsoft", "cross-provider"],
      setupSteps: ["Create email/password user"],
      executionSteps: ["Sign out", "Sign up with Microsoft using same email"],
      capturePoints: ["Whether accounts merge", "Local DB state"],
    },
    {
      id: "E04-google-then-microsoft-same-email",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 4,
      description: "Google signup A (E1), then Microsoft signup B (E1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "MULTI_PROVIDER_HANDLING",
      tags: ["oauth", "google", "microsoft", "multi-provider"],
      setupSteps: ["Sign up with Google"],
      executionSteps: ["Sign out", "Sign up with Microsoft using same email"],
      capturePoints: ["Whether providers coexist", "externalAccounts array"],
    },
    {
      id: "E05-microsoft-then-google-same-email",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 5,
      description: "Microsoft signup A (E1), then Google signup B (E1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "MULTI_PROVIDER_HANDLING",
      tags: ["oauth", "google", "microsoft", "multi-provider"],
      setupSteps: ["Sign up with Microsoft"],
      executionSteps: ["Sign out", "Sign up with Google using same email"],
      capturePoints: ["Whether providers coexist", "Local user state"],
    },
    {
      id: "E06-microsoft-link-to-existing",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 6,
      description: "Link Microsoft to existing email/password account",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "LINK_SUCCESS_OR_BLOCKED",
      tags: ["oauth", "microsoft", "linking"],
      setupSteps: ["Create email/password account"],
      executionSteps: ["Navigate to profile", "Link Microsoft"],
      capturePoints: ["oauthAccounts after link"],
    },
    {
      id: "E07-microsoft-link-conflict",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 7,
      description: "Link Microsoft already linked to another account",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "OAUTH_CONFLICT_BLOCKED",
      tags: ["oauth", "microsoft", "linking", "conflict"],
      setupSteps: ["Account A links Microsoft", "Create account B"],
      executionSteps: ["Log in as B", "Try linking same Microsoft"],
      capturePoints: ["Error response", "oauthAccountConflict"],
    },
  ];
}

// ============================================================================
// Group F: SSO Linking / Provider Reuse (7 scenarios)
// ============================================================================

export function buildGroupF(): ScenarioDefinition[] {
  return [
    {
      id: "F01-link-google-already-linked-to-other",
      group: "F",
      groupName: "SSO Linking / Provider Reuse",
      scenarioNumber: 1,
      description: "Account A tries to link Google already belonging to account B",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "OAUTH_ACCOUNT_CONFLICT",
      tags: ["sso", "linking", "conflict"],
      setupSteps: ["Create A, link Google", "Create B"],
      executionSteps: ["Log in as B", "Try linking same Google"],
      capturePoints: ["oauthAccountConflict response"],
    },
    {
      id: "F02-link-microsoft-already-linked-to-other",
      group: "F",
      groupName: "SSO Linking / Provider Reuse",
      scenarioNumber: 2,
      description: "Account A tries to link Microsoft already belonging to account B",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "OAUTH_ACCOUNT_CONFLICT",
      tags: ["sso", "linking", "conflict"],
      setupSteps: ["Create A, link Microsoft", "Create B"],
      executionSteps: ["Log in as B", "Try linking same Microsoft"],
      capturePoints: ["oauthAccountConflict response"],
    },
    {
      id: "F03-provider-reuse-after-deletion",
      group: "F",
      groupName: "SSO Linking / Provider Reuse",
      scenarioNumber: 3,
      description: "Try provider reuse after account deletion",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "PROVIDER_REUSABLE_AFTER_DELETE",
      tags: ["sso", "deletion", "reuse"],
      setupSteps: ["Create A, link Google", "Delete A"],
      executionSteps: ["Create B", "Try linking same Google"],
      capturePoints: ["Whether link succeeds", "tombstone state"],
    },
    {
      id: "F04-provider-reuse-after-soft-delete",
      group: "F",
      groupName: "SSO Linking / Provider Reuse",
      scenarioNumber: 4,
      description: "Try provider reuse after soft-delete/tombstone state",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_TOMBSTONE_BEHAVIOR",
      tags: ["sso", "deletion", "tombstone"],
      blocker: "Requires DB manipulation to create tombstone",
      manualSteps: [
        "Create account with Google",
        "Soft-delete (set deletedAt but keep identity fields)",
        "Create new account",
        "Try linking same Google",
      ],
    },
    {
      id: "F05-provider-reuse-after-failed-cleanup",
      group: "F",
      groupName: "SSO Linking / Provider Reuse",
      scenarioNumber: 5,
      description: "Try provider reuse after failed cleanup",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_CLEANUP_FAILURE_BEHAVIOR",
      tags: ["sso", "cleanup", "failure"],
      blocker: "Requires simulating cleanup failure",
      manualSteps: [
        "Create account with Google",
        "Delete account but interrupt cleanup",
        "Verify lingering oauthAccounts entry",
        "Try reusing same Google",
      ],
    },
    {
      id: "F06-clerk-ui-provider-linking",
      group: "F",
      groupName: "SSO Linking / Provider Reuse",
      scenarioNumber: 6,
      description: "Try provider linking from Clerk UI path if reachable",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_UI_PATH",
      tags: ["sso", "linking", "ui"],
      setupSteps: ["Create email/password account"],
      executionSteps: [
        "Navigate to user profile",
        "Find connected accounts section",
        "Document available link options",
      ],
      capturePoints: ["Available UI paths", "Link flow behavior"],
    },
    {
      id: "F07-app-controlled-provider-linking",
      group: "F",
      groupName: "SSO Linking / Provider Reuse",
      scenarioNumber: 7,
      description: "Try provider linking from app-controlled path",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_APP_PATH",
      tags: ["sso", "linking", "app-controlled"],
      setupSteps: ["Log in"],
      executionSteps: [
        "Navigate to /profil",
        "Find any provider link buttons",
        "Document the flow",
      ],
      capturePoints: ["App-controlled linking paths", "Success/failure"],
    },
  ];
}

// ============================================================================
// Group G: Username Update Scenarios (6 scenarios)
// ============================================================================

export function buildGroupG(): ScenarioDefinition[] {
  return [
    {
      id: "G01-update-username-to-existing",
      group: "G",
      groupName: "Username Update",
      scenarioNumber: 1,
      description: "Logged-in user changes username to an existing username",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "USERNAME_UPDATE_BLOCKED",
      tags: ["update", "username", "conflict"],
      first: { provider: "email", email: makeEmail("g01-first"), username: makeUsername("g01first") },
      second: { provider: "email", email: makeEmail("g01-second"), username: makeUsername("g01second") },
      action: "update",
    },
    {
      id: "G02-update-username-same-casing",
      group: "G",
      groupName: "Username Update",
      scenarioNumber: 2,
      description: "Logged-in user changes username to same value with different casing",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ALLOWED_OR_NORMALIZED",
      tags: ["update", "username", "casing"],
      first: { provider: "email", email: makeEmail("g02-user"), username: makeUsername("g02user").toLowerCase() },
      action: "update",
    },
    {
      id: "G03-update-username-whitespace",
      group: "G",
      groupName: "Username Update",
      scenarioNumber: 3,
      description: "Logged-in user changes username with leading/trailing whitespace",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "VALIDATION_ERROR_OR_TRIMMED",
      tags: ["update", "username", "whitespace"],
      first: { provider: "email", email: makeEmail("g03-user"), username: makeUsername("g03user") },
      action: "update",
    },
    {
      id: "G04-update-username-invalid-format",
      group: "G",
      groupName: "Username Update",
      scenarioNumber: 4,
      description: "Logged-in user changes username to invalid format",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "VALIDATION_ERROR",
      tags: ["update", "username", "validation"],
      first: { provider: "email", email: makeEmail("g04-user"), username: makeUsername("g04user") },
      action: "update",
    },
    {
      id: "G05-update-username-concurrent-conflict",
      group: "G",
      groupName: "Username Update",
      scenarioNumber: 5,
      description: "Username change while another conflicting account being created concurrently",
      kind: "race_condition",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ONE_SUCCEEDS_ONE_FAILS",
      tags: ["update", "username", "race", "concurrency"],
      concurrentActions: [
        "User A updates username to U",
        "User B signs up with username U",
      ],
      expectedRace: "DB unique index blocks one",
    },
    {
      id: "G06-update-username-conflict-timing",
      group: "G",
      groupName: "Username Update",
      scenarioNumber: 6,
      description: "Verify whether conflict is blocked early or only by DB write failure",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "EARLY_BLOCK_OR_DB_FALLBACK",
      tags: ["update", "username", "timing"],
      first: { provider: "email", email: makeEmail("g06-first"), username: makeUsername("g06first") },
      second: { provider: "email", email: makeEmail("g06-second"), username: makeUsername("g06second") },
      action: "update",
    },
  ];
}

// ============================================================================
// Group H: Email Update Scenarios (5 scenarios)
// ============================================================================

export function buildGroupH(): ScenarioDefinition[] {
  return [
    {
      id: "H01-update-email-to-existing",
      group: "H",
      groupName: "Email Update",
      scenarioNumber: 1,
      description: "Logged-in user changes email to an existing email",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "EMAIL_UPDATE_BLOCKED",
      tags: ["update", "email", "conflict"],
      setupSteps: ["Create user A with E1", "Create user B with E2"],
      executionSteps: ["Log in as B", "Try changing email to E1"],
      capturePoints: ["Error message", "Whether blocked at Clerk or backend"],
    },
    {
      id: "H02-update-email-same-casing",
      group: "H",
      groupName: "Email Update",
      scenarioNumber: 2,
      description: "Logged-in user changes email to same value with different casing",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ALLOWED_OR_NORMALIZED",
      tags: ["update", "email", "casing"],
      setupSteps: ["Create user with lowercase email"],
      executionSteps: ["Try changing to uppercase version"],
      capturePoints: ["Whether allowed", "Stored form"],
    },
    {
      id: "H03-update-email-clerk-ui",
      group: "H",
      groupName: "Email Update",
      scenarioNumber: 3,
      description: "Logged-in user changes email through Clerk UI if reachable",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_CLERK_UI_PATH",
      tags: ["update", "email", "clerk-ui"],
      setupSteps: ["Log in"],
      executionSteps: ["Navigate to Clerk user profile component", "Find email change option"],
      capturePoints: ["Whether email change is exposed", "Flow behavior"],
    },
    {
      id: "H04-update-email-app-controlled",
      group: "H",
      groupName: "Email Update",
      scenarioNumber: 4,
      description: "Logged-in user changes email through app-controlled flow",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_APP_PATH",
      tags: ["update", "email", "app-controlled"],
      setupSteps: ["Log in"],
      executionSteps: ["Navigate to /profil", "Find email change option"],
      capturePoints: ["App-controlled paths", "Sync with Clerk"],
    },
    {
      id: "H05-update-email-consistency",
      group: "H",
      groupName: "Email Update",
      scenarioNumber: 5,
      description: "Verify frontend, Clerk, and local backend stay consistent after email change",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ALL_CONSISTENT",
      tags: ["update", "email", "consistency"],
      setupSteps: ["Create user"],
      executionSteps: ["Change email via available path", "Query all three sources"],
      capturePoints: ["Frontend /me email", "Clerk user email", "MongoDB email"],
    },
  ];
}

// ============================================================================
// Build All Groups
// ============================================================================

export function buildGroupI(): ScenarioDefinition[] {
  // Deletion/reuse scenarios - abbreviated for space
  return [
    { id: "I01-delete-then-reuse-username", group: "I", groupName: "Deletion/Reuse", scenarioNumber: 1, description: "Delete account A, reuse old username on new account B", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "USERNAME_REUSABLE_AFTER_DELETE", tags: ["deletion", "reuse", "username"], first: { provider: "email", email: makeEmail("i01-first"), username: makeUsername("i01shared") }, second: { provider: "email", email: makeEmail("i01-second"), username: makeUsername("i01shared") }, action: "delete" },
    { id: "I02-delete-then-reuse-email", group: "I", groupName: "Deletion/Reuse", scenarioNumber: 2, description: "Delete account A, reuse old email on new account B", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "EMAIL_REUSABLE_AFTER_DELETE", tags: ["deletion", "reuse", "email"], first: { provider: "email", email: makeEmail("i02-shared"), username: makeUsername("i02first") }, second: { provider: "email", email: makeEmail("i02-shared"), username: makeUsername("i02second") }, action: "delete" },
    { id: "I03-delete-reuse-google", group: "I", groupName: "Deletion/Reuse", scenarioNumber: 3, description: "Reuse old Google identity on new account B", kind: "e2e_oauth", automatable: false, requiresE2e: true, requiresOAuth: true, requiresAdmin: false, expectedOutcome: "GOOGLE_REUSABLE_AFTER_DELETE", tags: ["deletion", "reuse", "oauth"], setupSteps: ["Create A with Google", "Delete A"], executionSteps: ["Create B", "Link same Google"], capturePoints: ["Whether link succeeds"] },
    { id: "I04-delete-reuse-microsoft", group: "I", groupName: "Deletion/Reuse", scenarioNumber: 4, description: "Reuse old Microsoft identity on new account B", kind: "e2e_oauth", automatable: false, requiresE2e: true, requiresOAuth: true, requiresAdmin: false, expectedOutcome: "MICROSOFT_REUSABLE_AFTER_DELETE", tags: ["deletion", "reuse", "oauth"], setupSteps: ["Create A with Microsoft", "Delete A"], executionSteps: ["Create B", "Link same Microsoft"], capturePoints: ["Whether link succeeds"] },
    { id: "I05-verify-tombstone-fields", group: "I", groupName: "Deletion/Reuse", scenarioNumber: 5, description: "Verify tombstone fields are unset/anonymized correctly", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "TOMBSTONE_CORRECT", tags: ["deletion", "tombstone"], first: { provider: "email", email: makeEmail("i05-user"), username: makeUsername("i05user") }, action: "delete" },
    { id: "I06-deleted-cannot-auth", group: "I", groupName: "Deletion/Reuse", scenarioNumber: 6, description: "Verify deleted account cannot still authenticate", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "AUTH_REJECTED", tags: ["deletion", "auth"], first: { provider: "email", email: makeEmail("i06-user"), username: makeUsername("i06user") }, action: "delete" },
    { id: "I07-deleted-sessions-die", group: "I", groupName: "Deletion/Reuse", scenarioNumber: 7, description: "Verify deleted account sessions die correctly", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "SESSIONS_INVALIDATED", tags: ["deletion", "session"], setupSteps: ["Create user", "Log in"], executionSteps: ["Delete account", "Try accessing protected route"], capturePoints: ["Session rejection"] },
    { id: "I08-deleted-data-cleanup", group: "I", groupName: "Deletion/Reuse", scenarioNumber: 8, description: "Verify all user data properly cleaned up after deletion", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "DATA_CLEANED", tags: ["deletion", "cleanup"], first: { provider: "email", email: makeEmail("i08-user"), username: makeUsername("i08user") }, action: "delete" },
  ] as ScenarioDefinition[];
}

export function buildGroupJ(): ScenarioDefinition[] {
  // Session/cross-tab scenarios
  return [
    { id: "J01-logout-other-tab", group: "J", groupName: "Session/Cross-Tab", scenarioNumber: 1, description: "Logout in one tab while another protected tab is open", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "OTHER_TAB_UPDATED", tags: ["session", "cross-tab", "logout"], setupSteps: ["Log in", "Open two tabs"], executionSteps: ["Logout in tab 1", "Check tab 2"], capturePoints: ["Tab 2 auth state"] },
    { id: "J02-delete-other-tab", group: "J", groupName: "Session/Cross-Tab", scenarioNumber: 2, description: "Delete account in one tab while another protected tab is open", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "OTHER_TAB_SIGNED_OUT", tags: ["session", "cross-tab", "deletion"], setupSteps: ["Log in", "Open two tabs"], executionSteps: ["Delete in tab 1", "Check tab 2"], capturePoints: ["Tab 2 redirect"] },
    { id: "J03-inflight-during-logout", group: "J", groupName: "Session/Cross-Tab", scenarioNumber: 3, description: "In-flight request during logout", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "REQUEST_HANDLED_GRACEFULLY", tags: ["session", "race", "logout"], setupSteps: ["Log in"], executionSteps: ["Start long request", "Logout mid-request"], capturePoints: ["Request outcome"] },
    { id: "J04-inflight-during-deletion", group: "J", groupName: "Session/Cross-Tab", scenarioNumber: 4, description: "In-flight request during deletion", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "REQUEST_HANDLED_GRACEFULLY", tags: ["session", "race", "deletion"], setupSteps: ["Log in"], executionSteps: ["Start long request", "Delete mid-request"], capturePoints: ["Request outcome"] },
    { id: "J05-expired-clerk-token", group: "J", groupName: "Session/Cross-Tab", scenarioNumber: 5, description: "Expired Clerk token during active app session", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "TOKEN_REFRESH_OR_SIGNOUT", tags: ["session", "token", "expiry"], setupSteps: ["Log in"], executionSteps: ["Wait for token expiry", "Make request"], capturePoints: ["Refresh or signout behavior"] },
    { id: "J06-auth-conflict-other-tab", group: "J", groupName: "Session/Cross-Tab", scenarioNumber: 6, description: "Auth conflict in one tab while another tab is open", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "CONFLICT_PROPAGATES", tags: ["session", "cross-tab", "conflict"], setupSteps: ["Log in", "Open two tabs"], executionSteps: ["Trigger conflict in tab 1", "Check tab 2"], capturePoints: ["Tab 2 conflict state"] },
    { id: "J07-broadcast-channel-logout", group: "J", groupName: "Session/Cross-Tab", scenarioNumber: 7, description: "Verify cross-tab logout broadcast still works", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "BROADCAST_WORKS", tags: ["session", "broadcast", "logout"], setupSteps: ["Log in multiple tabs"], executionSteps: ["Logout in one", "Check others"], capturePoints: ["BroadcastChannel events"] },
    { id: "J08-stale-me-cache-cleared", group: "J", groupName: "Session/Cross-Tab", scenarioNumber: 8, description: "Verify stale cached /me data is cleared correctly", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "CACHE_CLEARED", tags: ["session", "cache", "me"], setupSteps: ["Log in"], executionSteps: ["Logout", "Check react-query cache"], capturePoints: ["Cache state after logout"] },
  ] as ScenarioDefinition[];
}

export function buildGroupK(): ScenarioDefinition[] {
  // Late-conflict / frontend-illusion scenarios
  return [
    { id: "K01-clerk-success-me-409", group: "K", groupName: "Late-Conflict", scenarioNumber: 1, description: "Clerk signup appears successful but /me returns 409", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "CONFLICT_SHOWN_TO_USER", tags: ["late-conflict", "409"], setupSteps: ["Create conflicting state"], executionSteps: ["Sign up", "Call /me"], capturePoints: ["/me response", "UI state"] },
    { id: "K02-clerk-success-me-403", group: "K", groupName: "Late-Conflict", scenarioNumber: 2, description: "Clerk signup appears successful but /me returns 403", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "AUTH_ERROR_SHOWN", tags: ["late-conflict", "403"], setupSteps: ["Create blocked state"], executionSteps: ["Sign up", "Call /me"], capturePoints: ["/me response", "UI state"] },
    { id: "K03-dashboard-but-invalid-identity", group: "K", groupName: "Late-Conflict", scenarioNumber: 3, description: "Frontend lands on dashboard but backend identity is invalid", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "REDIRECT_OR_ERROR", tags: ["late-conflict", "illusion"], setupSteps: ["Create edge state"], executionSteps: ["Navigate to dashboard"], capturePoints: ["Whether protected content shown"] },
    { id: "K04-username-conflict-resolver", group: "K", groupName: "Late-Conflict", scenarioNumber: 4, description: "Username conflict resolver appears after signup", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "RESOLVER_SHOWN", tags: ["late-conflict", "username", "resolver"], setupSteps: ["Create username conflict"], executionSteps: ["Sign up", "Check UI"], capturePoints: ["Conflict modal appearance"] },
    { id: "K05-auth-conflict-guard-signout", group: "K", groupName: "Late-Conflict", scenarioNumber: 5, description: "AuthConflictGuard signs user out after signup", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "AUTO_SIGNOUT", tags: ["late-conflict", "guard", "signout"], setupSteps: ["Create conflict state"], executionSteps: ["Sign up", "Observe guard behavior"], capturePoints: ["Signout trigger"] },
    { id: "K06-same-account-perceived-new", group: "K", groupName: "Late-Conflict", scenarioNumber: 6, description: "Same account reused but user perceives it as new registration", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "UX_CONFUSION_DETECTED", tags: ["late-conflict", "ux", "illusion"], setupSteps: ["Create reuse scenario"], executionSteps: ["Sign up", "Check messaging"], capturePoints: ["Whether user informed"] },
    { id: "K07-new-clerk-no-local", group: "K", groupName: "Late-Conflict", scenarioNumber: 7, description: "New Clerk user created but no local DB user created", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "ORPHANED_CLERK_USER", tags: ["late-conflict", "orphan"], first: { provider: "email", email: makeEmail("k07-user"), username: makeUsername("k07user") } },
    { id: "K08-new-clerk-backend-blocks-local", group: "K", groupName: "Late-Conflict", scenarioNumber: 8, description: "New Clerk user created and backend correctly blocks local creation", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "BACKEND_BLOCKED_LOCAL", tags: ["late-conflict", "block"], first: { provider: "email", email: makeEmail("k08-first"), username: makeUsername("k08shared") }, second: { provider: "email", email: makeEmail("k08-second"), username: makeUsername("k08shared") } },
  ] as ScenarioDefinition[];
}

export function buildGroupL(): ScenarioDefinition[] {
  // Race/concurrency scenarios
  return [
    { id: "L01-concurrent-signup-same-email", group: "L", groupName: "Race/Concurrency", scenarioNumber: 1, description: "Two concurrent signups with same email", kind: "race_condition", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "ONE_WINS_ONE_FAILS", tags: ["race", "signup", "email"], concurrentActions: ["Signup A with E1", "Signup B with E1"], expectedRace: "Clerk blocks one" },
    { id: "L02-concurrent-signup-same-username", group: "L", groupName: "Race/Concurrency", scenarioNumber: 2, description: "Two concurrent signups with same username", kind: "race_condition", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "ONE_WINS_ONE_FAILS", tags: ["race", "signup", "username"], concurrentActions: ["Signup A with U1", "Signup B with U1"], expectedRace: "Clerk or DB blocks one" },
    { id: "L03-concurrent-me-calls", group: "L", groupName: "Race/Concurrency", scenarioNumber: 3, description: "Two concurrent /me calls for same fresh Clerk user", kind: "race_condition", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "LOCAL_USER_CREATED_ONCE", tags: ["race", "me", "create"], concurrentActions: ["Call /me", "Call /me"], expectedRace: "findOrCreate dedupes" },
    { id: "L04-concurrent-username-update", group: "L", groupName: "Race/Concurrency", scenarioNumber: 4, description: "Concurrent username update conflicts", kind: "race_condition", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "ONE_WINS_ONE_FAILS", tags: ["race", "update", "username"], concurrentActions: ["User A updates to U", "User B updates to U"], expectedRace: "DB unique index blocks one" },
    { id: "L05-concurrent-delete-auth", group: "L", groupName: "Race/Concurrency", scenarioNumber: 5, description: "Concurrent deletion + auth request", kind: "race_condition", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "GRACEFUL_HANDLING", tags: ["race", "delete", "auth"], concurrentActions: ["Delete account", "Make auth request"], expectedRace: "Request fails gracefully" },
    { id: "L06-concurrent-provider-link", group: "L", groupName: "Race/Concurrency", scenarioNumber: 6, description: "Concurrent provider-link attempts", kind: "race_condition", automatable: false, requiresE2e: true, requiresOAuth: true, requiresAdmin: false, expectedOutcome: "ONE_WINS_ONE_FAILS", tags: ["race", "link", "oauth"], concurrentActions: ["User A links Google", "User B links same Google"], expectedRace: "First wins" },
    { id: "L07-db-unique-indexes-fallback", group: "L", groupName: "Race/Concurrency", scenarioNumber: 7, description: "Verify DB unique indexes are the final fallback", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "DB_PREVENTS_DUPLICATE", tags: ["race", "db", "index"], first: { provider: "email", email: makeEmail("l07-first"), username: makeUsername("l07shared") }, second: { provider: "email", email: makeEmail("l07-second"), username: makeUsername("l07shared") } },
  ] as ScenarioDefinition[];
}

export function buildGroupM(): ScenarioDefinition[] {
  // Normalization and data-integrity scenarios
  return [
    { id: "M01-email-normalization-variants", group: "M", groupName: "Normalization", scenarioNumber: 1, description: "Email normalization with uppercase/lowercase variants", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "NORMALIZED_CORRECTLY", tags: ["normalization", "email"], first: { provider: "email", email: makeEmail("m01-shared").toLowerCase(), username: makeUsername("m01first") }, second: { provider: "email", email: makeEmail("m01-shared").toUpperCase(), username: makeUsername("m01second") } },
    { id: "M02-username-normalization-variants", group: "M", groupName: "Normalization", scenarioNumber: 2, description: "Username normalization with casing variants", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "NORMALIZED_CORRECTLY", tags: ["normalization", "username"], first: { provider: "email", email: makeEmail("m02-first"), username: makeUsername("m02shared").toLowerCase() }, second: { provider: "email", email: makeEmail("m02-second"), username: makeUsername("m02shared").toUpperCase() } },
    { id: "M03-empty-username", group: "M", groupName: "Normalization", scenarioNumber: 3, description: "Empty username / null username paths", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "VALIDATION_ERROR", tags: ["normalization", "username", "empty"], first: { provider: "email", email: makeEmail("m03-user"), username: "" } },
    { id: "M04-missing-usernameNormalized", group: "M", groupName: "Normalization", scenarioNumber: 4, description: "Users with username present but missing usernameNormalized", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "DOCUMENT_STATE", tags: ["data-integrity", "migration"], blocker: "Requires DB query", manualSteps: ["Query DB for users where username exists but usernameNormalized is null"] },
    { id: "M05-deleted-lingering-identity", group: "M", groupName: "Normalization", scenarioNumber: 5, description: "Deleted users with lingering identity fields", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "IDENTITY_CLEARED", tags: ["data-integrity", "deletion"], first: { provider: "email", email: makeEmail("m05-user"), username: makeUsername("m05user") }, action: "delete" },
    { id: "M06-duplicate-providerAccountId", group: "M", groupName: "Normalization", scenarioNumber: 6, description: "Duplicate providerAccountId in oauthAccounts", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "DOCUMENT_STATE", tags: ["data-integrity", "oauth"], blocker: "Requires DB query", manualSteps: ["Query DB for duplicate providerAccountId entries"] },
    { id: "M07-stale-syncConflict", group: "M", groupName: "Normalization", scenarioNumber: 7, description: "Stale or malformed syncConflict entries", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "DOCUMENT_STATE", tags: ["data-integrity", "sync"], blocker: "Requires DB query", manualSteps: ["Query DB for users with non-null syncConflict"] },
    { id: "M08-inconsistent-clerk-local", group: "M", groupName: "Normalization", scenarioNumber: 8, description: "Inconsistent local row where Clerk fields and app fields disagree", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "DOCUMENT_STATE", tags: ["data-integrity", "consistency"], blocker: "Requires Clerk API + DB comparison", manualSteps: ["Compare Clerk user data with local DB for sample users"] },
    { id: "M09-unicode-edge-cases", group: "M", groupName: "Normalization", scenarioNumber: 9, description: "Unicode-like edge cases if supported by username rules", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "VALIDATION_OR_NORMALIZED", tags: ["normalization", "unicode"], first: { provider: "email", email: makeEmail("m09-user"), username: "user_émoji_🎉" } },
  ] as ScenarioDefinition[];
}

export function buildGroupN(): ScenarioDefinition[] {
  // Clerk/local consistency scenarios
  return [
    { id: "N01-clerk-admin-email-change", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 1, description: "Clerk dashboard/admin changes email directly", kind: "admin_only", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "SYNC_ON_NEXT_AUTH", tags: ["consistency", "admin", "email"], blocker: "Requires Clerk Dashboard access", manualSteps: ["Log in to Clerk Dashboard", "Change user email", "User logs in again", "Check local DB sync"] },
    { id: "N02-clerk-admin-provider-link", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 2, description: "Clerk dashboard/admin links provider directly", kind: "admin_only", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "SYNC_ON_NEXT_AUTH", tags: ["consistency", "admin", "oauth"], blocker: "Requires Clerk Dashboard access", manualSteps: ["Link provider via Clerk Dashboard", "User logs in", "Check local oauthAccounts sync"] },
    { id: "N03-clerk-admin-username-change", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 3, description: "Clerk dashboard/admin changes username directly", kind: "admin_only", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "SYNC_ON_NEXT_AUTH", tags: ["consistency", "admin", "username"], blocker: "Requires Clerk Dashboard access", manualSteps: ["Change username via Clerk Dashboard", "User logs in", "Check local DB sync"] },
    { id: "N04-background-sync-after-admin-change", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 4, description: "Background sync after admin change", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "SYNC_CONFLICT_RECORDED", tags: ["consistency", "sync"], blocker: "Requires admin change + sync trigger", manualSteps: ["Make admin change", "Trigger background sync", "Check syncConflict field"] },
    { id: "N05-sync-conflict-recorded", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 5, description: "Verify whether syncConflict is recorded on mismatch", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "DOCUMENT_BEHAVIOR", tags: ["consistency", "sync", "conflict"], blocker: "Requires creating mismatch", manualSteps: ["Create Clerk/local mismatch", "Check syncConflict"] },
    { id: "N06-sync-banner-appears", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 6, description: "Verify whether banner/warning appears on sync conflict", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "BANNER_SHOWN", tags: ["consistency", "ui", "banner"], setupSteps: ["Create sync conflict state"], executionSteps: ["Log in", "Navigate to dashboard"], capturePoints: ["Banner visibility"] },
    { id: "N07-sync-banner-dismiss", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 7, description: "Verify whether user can dismiss sync conflict banner", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "DISMISS_BEHAVIOR", tags: ["consistency", "ui", "dismiss"], setupSteps: ["Create sync conflict"], executionSteps: ["Show banner", "Click dismiss"], capturePoints: ["Whether dismissed persists"] },
    { id: "N08-dismiss-hides-or-resolves", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 8, description: "Verify whether dismiss hides only UI or actually resolves state", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "UI_HIDE_VS_RESOLUTION", tags: ["consistency", "dismiss", "state"], setupSteps: ["Create conflict", "Dismiss"], executionSteps: ["Check DB syncConflict field"], capturePoints: ["Field state after dismiss"] },
    { id: "N09-conflict-reappear-on-sync", group: "N", groupName: "Clerk/Local Consistency", scenarioNumber: 9, description: "Verify whether same conflict immediately reappears on next sync", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "REAPPEAR_OR_STAY_DISMISSED", tags: ["consistency", "sync", "reappear"], setupSteps: ["Create conflict", "Dismiss", "Trigger sync"], executionSteps: ["Check banner state"], capturePoints: ["Whether conflict returns"] },
  ] as ScenarioDefinition[];
}

export function buildGroupO(): ScenarioDefinition[] {
  // Recovery / failed-state scenarios
  return [
    { id: "O01-failed-signup-midway", group: "O", groupName: "Recovery", scenarioNumber: 1, description: "Failed signup midway", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "NO_ORPHAN_STATE", tags: ["recovery", "signup", "failure"], setupSteps: [], executionSteps: ["Start signup", "Interrupt mid-form", "Check state"], capturePoints: ["Clerk user state", "Local DB state"] },
    { id: "O02-failed-google-callback", group: "O", groupName: "Recovery", scenarioNumber: 2, description: "Failed Google callback midway", kind: "e2e_oauth", automatable: false, requiresE2e: true, requiresOAuth: true, requiresAdmin: false, expectedOutcome: "NO_ORPHAN_STATE", tags: ["recovery", "oauth", "failure"], setupSteps: ["Start Google signup"], executionSteps: ["Cancel at Google consent"], capturePoints: ["State after cancel"] },
    { id: "O03-failed-microsoft-callback", group: "O", groupName: "Recovery", scenarioNumber: 3, description: "Failed Microsoft callback midway", kind: "e2e_oauth", automatable: false, requiresE2e: true, requiresOAuth: true, requiresAdmin: false, expectedOutcome: "NO_ORPHAN_STATE", tags: ["recovery", "oauth", "failure"], setupSteps: ["Start Microsoft signup"], executionSteps: ["Cancel at Microsoft consent"], capturePoints: ["State after cancel"] },
    { id: "O04-failed-local-sync-after-clerk", group: "O", groupName: "Recovery", scenarioNumber: 4, description: "Failed local sync after Clerk success", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "CLERK_USER_ORPHANED", tags: ["recovery", "sync", "orphan"], first: { provider: "email", email: makeEmail("o04-user"), username: makeUsername("o04user") } },
    { id: "O05-failed-clerk-sync-after-local", group: "O", groupName: "Recovery", scenarioNumber: 5, description: "Failed Clerk sync after local success", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "LOCAL_USER_ORPHANED", tags: ["recovery", "sync", "orphan"], blocker: "Requires simulating Clerk API failure", manualSteps: ["Create local user", "Fail Clerk sync", "Check state"] },
    { id: "O06-failed-delete-cleanup", group: "O", groupName: "Recovery", scenarioNumber: 6, description: "Failed delete cleanup", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "PARTIAL_CLEANUP", tags: ["recovery", "delete", "cleanup"], first: { provider: "email", email: makeEmail("o06-user"), username: makeUsername("o06user") }, action: "delete" },
    { id: "O07-failed-signout-cleanup", group: "O", groupName: "Recovery", scenarioNumber: 7, description: "Failed signOut cleanup", kind: "e2e_browser", automatable: true, requiresE2e: true, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "SESSION_STATE_CLEAN", tags: ["recovery", "signout", "cleanup"], setupSteps: ["Log in"], executionSteps: ["Interrupt signout"], capturePoints: ["Session state"] },
    { id: "O08-cleanup-retry-behavior", group: "O", groupName: "Recovery", scenarioNumber: 8, description: "Cleanup retry behavior", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "RETRY_WORKS", tags: ["recovery", "cleanup", "retry"], blocker: "Requires cleanup failure simulation", manualSteps: ["Fail cleanup", "Trigger retry", "Check outcome"] },
    { id: "O09-orphaned-clerk-user", group: "O", groupName: "Recovery", scenarioNumber: 9, description: "Orphaned Clerk user (no local)", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "DOCUMENT_ORPHANS", tags: ["recovery", "orphan", "clerk"], blocker: "Requires Clerk/DB comparison", manualSteps: ["Query Clerk users", "Query local users", "Find orphans"] },
    { id: "O10-orphaned-local-user", group: "O", groupName: "Recovery", scenarioNumber: 10, description: "Orphaned local DB user (Clerk deleted)", kind: "manual", automatable: false, requiresE2e: false, requiresOAuth: false, requiresAdmin: true, expectedOutcome: "DOCUMENT_ORPHANS", tags: ["recovery", "orphan", "local"], blocker: "Requires Clerk/DB comparison", manualSteps: ["Query local users", "Check Clerk for each clerkId", "Find orphans"] },
  ] as ScenarioDefinition[];
}

export function buildGroupP(): ScenarioDefinition[] {
  // Security and abuse-adjacent scenarios
  return [
    { id: "P01-rapid-signup-collisions", group: "P", groupName: "Security", scenarioNumber: 1, description: "Attempt repeated signup collisions rapidly", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "RATE_LIMITED", tags: ["security", "rate-limit", "signup"], first: { provider: "email", email: makeEmail("p01-target"), username: makeUsername("p01target") } },
    { id: "P02-rapid-username-collisions", group: "P", groupName: "Security", scenarioNumber: 2, description: "Attempt repeated username change collisions rapidly", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "RATE_LIMITED", tags: ["security", "rate-limit", "username"], first: { provider: "email", email: makeEmail("p02-user"), username: makeUsername("p02user") }, action: "update" },
    { id: "P03-rapid-provider-link-collisions", group: "P", groupName: "Security", scenarioNumber: 3, description: "Attempt repeated provider-link collisions rapidly", kind: "e2e_oauth", automatable: false, requiresE2e: true, requiresOAuth: true, requiresAdmin: false, expectedOutcome: "RATE_LIMITED", tags: ["security", "rate-limit", "oauth"], setupSteps: [], executionSteps: ["Rapidly attempt link same provider"], capturePoints: ["Rate limit response"] },
    { id: "P04-rate-limiting-endpoints", group: "P", groupName: "Security", scenarioNumber: 4, description: "Verify rate limiting behavior on relevant endpoints", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "RATE_LIMITS_ENFORCED", tags: ["security", "rate-limit"], first: { provider: "email", email: makeEmail("p04-user"), username: makeUsername("p04user") } },
    { id: "P05-diagnostics-dev-only", group: "P", groupName: "Security", scenarioNumber: 5, description: "Verify diagnostics are truly dev-only", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "DIAGNOSTICS_BLOCKED_PROD", tags: ["security", "diagnostics"], first: { provider: "email", email: makeEmail("p05-user"), username: makeUsername("p05user") } },
    { id: "P06-debug-endpoint-info-leak", group: "P", groupName: "Security", scenarioNumber: 6, description: "Verify debug endpoints do not leak too much", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "NO_SENSITIVE_LEAK", tags: ["security", "info-leak"], first: { provider: "email", email: makeEmail("p06-user"), username: makeUsername("p06user") } },
    { id: "P07-flowid-correlation", group: "P", groupName: "Security", scenarioNumber: 7, description: "Verify flowId correlation works across the whole chain", kind: "executable", automatable: true, requiresE2e: false, requiresOAuth: false, requiresAdmin: false, expectedOutcome: "FLOWID_CORRELATES", tags: ["security", "logging", "correlation"], first: { provider: "email", email: makeEmail("p07-user"), username: makeUsername("p07user") } },
  ] as ScenarioDefinition[];
}

// ============================================================================
// Build Complete Matrix
// ============================================================================

export function buildFullMatrix(): ScenarioDefinition[] {
  return [
    ...buildGroupA(),
    ...buildGroupB(),
    ...buildGroupC(),
    ...buildGroupD(),
    ...buildGroupE(),
    ...buildGroupF(),
    ...buildGroupG(),
    ...buildGroupH(),
    ...buildGroupI(),
    ...buildGroupJ(),
    ...buildGroupK(),
    ...buildGroupL(),
    ...buildGroupM(),
    ...buildGroupN(),
    ...buildGroupO(),
    ...buildGroupP(),
  ];
}

export function buildGroupByName(group: ScenarioGroup): ScenarioDefinition[] {
  const builders: Record<ScenarioGroup, () => ScenarioDefinition[]> = {
    A: buildGroupA,
    B: buildGroupB,
    C: buildGroupC,
    D: buildGroupD,
    E: buildGroupE,
    F: buildGroupF,
    G: buildGroupG,
    H: buildGroupH,
    I: buildGroupI,
    J: buildGroupJ,
    K: buildGroupK,
    L: buildGroupL,
    M: buildGroupM,
    N: buildGroupN,
    O: buildGroupO,
    P: buildGroupP,
  };
  return builders[group]();
}

export function getScenarioStats(scenarios: ScenarioDefinition[]): {
  total: number;
  executable: number;
  e2e: number;
  oauth: number;
  manual: number;
  race: number;
  admin: number;
  byGroup: Record<string, number>;
} {
  const stats = {
    total: scenarios.length,
    executable: 0,
    e2e: 0,
    oauth: 0,
    manual: 0,
    race: 0,
    admin: 0,
    byGroup: {} as Record<string, number>,
  };

  for (const s of scenarios) {
    stats.byGroup[s.group] = (stats.byGroup[s.group] ?? 0) + 1;
    if (s.kind === "executable" || s.kind === "api_manual") stats.executable++;
    if (s.kind === "e2e_browser") stats.e2e++;
    if (s.kind === "e2e_oauth") stats.oauth++;
    if (s.kind === "manual" || s.kind === "admin_only") stats.manual++;
    if (s.kind === "race_condition") stats.race++;
    if (s.requiresAdmin) stats.admin++;
  }

  return stats;
}
