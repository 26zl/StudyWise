/**
 * Scenariodefinisjoner for auth-matrise
 *
 * Omfattende scenariodekning for testing av autentiseringsidentitet:
 * - Gruppe A: Grunnleggende registreringsunikkhet (12 scenarioer)
 * - Gruppe B: Innlogging vs registreringsforvirring (4 scenarioer)
 * - Gruppe C: Google/OAuth vs e-post (7 scenarioer)
 * - Gruppe D: E-post vs Google/OAuth (6 scenarioer)
 * - Gruppe E: Microsoft/OAuth (7 scenarioer)
 * - Gruppe F: SSO-kobling / leverandørgjenbruk (7 scenarioer)
 * - Gruppe G: Brukernavn-oppdateringsscenarioer (6 scenarioer)
 * - Gruppe H: E-post-oppdateringsscenarioer (5 scenarioer)
 * - Gruppe I: Duplikatdeteksjon etter sletting (8 scenarioer)
 * - Gruppe J: Utlogging / sesjon / kryss-fane (8 scenarioer)
 * - Gruppe K: Sen-konflikt / frontend-illusjon (8 scenarioer)
 * - Gruppe L: Kappløp / samtidighet (7 scenarioer)
 * - Gruppe M: Normalisering og dataintegritet (9 scenarioer)
 * - Gruppe N: Clerk/lokal konsistens (9 scenarioer)
 * - Gruppe O: Gjenoppretting / feilstatus (10 scenarioer)
 * - Gruppe P: Sikkerhet og misbruksnært (7 scenarioer)
 *
 * Totalt: 120 scenarioer
 */

// ============================================================================
// Typer
// ============================================================================

export type Provider = "email" | "google" | "microsoft";

export type ScenarioKind =
  | "executable" // Kan automatiseres fullt via Clerk Backend API
  | "api_manual" // API-automatisering mulig, men krever manuelt identitetsoppsett
  | "e2e_browser" // Krever nettleserautomatisering (Playwright)
  | "e2e_oauth" // Krever ekte OAuth-leverandørinteraksjon
  | "manual" // Fullstendig manuelt
  | "race_condition" // Krever samtidig kjøring
  | "admin_only"; // Krever Clerk-dashbord administratorhandling

export type ScenarioStatus =
  | "executed"
  | "manual_required"
  | "setup_failed"
  | "skipped"
  | "partial";

export type ScenarioGroup =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P";

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
// Hjelpefunksjoner for scenariobygging
// ============================================================================

let runSeed = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function setRunSeed(seed: string): void {
  runSeed = seed;
}

export function makeEmail(
  label: string,
  options?: { casing?: "uppercase" | "mixed"; whitespace?: "leading" | "trailing" | "both" },
): string {
  let email = `auth-matrix-${label}-${runSeed}@example.com`;
  if (options?.casing === "uppercase") {
    email = email.toUpperCase();
  } else if (options?.casing === "mixed") {
    email = email
      .split("")
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
      .join("");
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

export function makeUsername(
  label: string,
  options?: {
    casing?: "uppercase" | "mixed";
    whitespace?: "leading" | "trailing" | "both";
    invalid?: "special_chars" | "too_short" | "too_long";
  },
): string {
  let username = `mx_${label}_${runSeed.replace(/-/g, "")}`.slice(0, 30);
  if (options?.casing === "uppercase") {
    username = username.toUpperCase();
  } else if (options?.casing === "mixed") {
    username = username
      .split("")
      .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
      .join("");
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
// Gruppe A: Grunnleggende registreringsunikkhet (12 scenarioer)
// ============================================================================

export function buildGroupA(): ScenarioDefinition[] {
  return [
    {
      id: "A01-signup-control-different-all",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 1,
      description:
        "Kontroll: Registrering A med e-post E1, brukernavn U1; Registrering B med e-post E2, brukernavn U2",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "TWO_DISTINCT_LOCAL_USERS",
      tags: ["signup", "control", "baseline"],
      first: {
        provider: "email",
        email: makeEmail("a01-first"),
        username: makeUsername("a01first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a01-second"),
        username: makeUsername("a01second"),
      },
    },
    {
      id: "A02-signup-same-email-same-username",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 2,
      description: "Registrering B med samme e-post E1, samme brukernavn U1",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL",
      tags: ["signup", "duplicate-email", "duplicate-username"],
      first: {
        provider: "email",
        email: makeEmail("a02-shared"),
        username: makeUsername("a02shared"),
      },
      second: {
        provider: "email",
        email: makeEmail("a02-shared"),
        username: makeUsername("a02shared"),
      },
    },
    {
      id: "A03-signup-same-email-diff-username",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 3,
      description: "Registrering B med samme e-post E1, ulikt brukernavn U2",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL",
      tags: ["signup", "duplicate-email"],
      first: {
        provider: "email",
        email: makeEmail("a03-shared"),
        username: makeUsername("a03first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a03-shared"),
        username: makeUsername("a03second"),
      },
    },
    {
      id: "A04-signup-diff-email-same-username",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 4,
      description: "Registrering B med ulik e-post E2, samme brukernavn U1",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_USERNAME",
      tags: ["signup", "duplicate-username"],
      first: {
        provider: "email",
        email: makeEmail("a04-first"),
        username: makeUsername("a04shared"),
      },
      second: {
        provider: "email",
        email: makeEmail("a04-second"),
        username: makeUsername("a04shared"),
      },
    },
    {
      id: "A05-signup-same-email-diff-casing",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 5,
      description: "Registrering B med samme e-post men STORE bokstaver",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL",
      tags: ["signup", "normalization", "email-casing"],
      first: {
        provider: "email",
        email: makeEmail("a05-shared").toLowerCase(),
        username: makeUsername("a05first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a05-shared").toUpperCase(),
        username: makeUsername("a05second"),
        emailCasing: "uppercase",
      },
    },
    {
      id: "A06-signup-same-username-diff-casing",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 6,
      description: "Registrering B med samme brukernavn men ulik bokstavstørrelse",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_USERNAME",
      tags: ["signup", "normalization", "username-casing"],
      first: {
        provider: "email",
        email: makeEmail("a06-first"),
        username: makeUsername("a06shared").toLowerCase(),
      },
      second: {
        provider: "email",
        email: makeEmail("a06-second"),
        username: makeUsername("a06shared").toUpperCase(),
        usernameCasing: "uppercase",
      },
    },
    {
      id: "A07-signup-email-leading-whitespace",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 7,
      description: "Registrering B med ledende/etterfølgende mellomrom i e-post",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_OR_NORMALIZED",
      tags: ["signup", "normalization", "whitespace"],
      first: {
        provider: "email",
        email: makeEmail("a07-shared"),
        username: makeUsername("a07first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a07-shared", { whitespace: "both" }),
        username: makeUsername("a07second"),
        whitespace: "both",
      },
    },
    {
      id: "A08-signup-username-leading-whitespace",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 8,
      description: "Registrering B med ledende/etterfølgende mellomrom i brukernavn",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_VALIDATION_ERROR_OR_NORMALIZED",
      tags: ["signup", "normalization", "whitespace"],
      first: {
        provider: "email",
        email: makeEmail("a08-first"),
        username: makeUsername("a08shared"),
      },
      second: {
        provider: "email",
        email: makeEmail("a08-second"),
        username: makeUsername("a08shared", { whitespace: "both" }),
        whitespace: "both",
      },
    },
    {
      id: "A09-signup-invalid-username-special-chars",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 9,
      description: "Registrering B med ugyldige brukernavn-tegn (@#$%)",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_VALIDATION_ERROR",
      tags: ["signup", "validation", "invalid-input"],
      first: {
        provider: "email",
        email: makeEmail("a09-first"),
        username: makeUsername("a09first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a09-second"),
        username: makeUsername("a09second", { invalid: "special_chars" }),
        invalid: true,
        invalidReason: "special_characters",
      },
    },
    {
      id: "A10-signup-invalid-username-too-short",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 10,
      description: "Registrering B med for kort brukernavn (2 tegn)",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_VALIDATION_ERROR",
      tags: ["signup", "validation", "invalid-input"],
      first: {
        provider: "email",
        email: makeEmail("a10-first"),
        username: makeUsername("a10first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a10-second"),
        username: makeUsername("a10second", { invalid: "too_short" }),
        invalid: true,
        invalidReason: "too_short",
      },
    },
    {
      id: "A11-signup-invalid-username-too-long",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 11,
      description: "Registrering B med for langt brukernavn (100 tegn)",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_VALIDATION_ERROR",
      tags: ["signup", "validation", "invalid-input"],
      first: {
        provider: "email",
        email: makeEmail("a11-first"),
        username: makeUsername("a11first"),
      },
      second: {
        provider: "email",
        email: makeEmail("a11-second"),
        username: makeUsername("a11second", { invalid: "too_long" }),
        invalid: true,
        invalidReason: "too_long",
      },
    },
    {
      id: "A12-signup-mixed-casing-email-username",
      group: "A",
      groupName: "Grunnleggende registreringsunikkhet",
      scenarioNumber: 12,
      description: "Registrering B med blandet bokstavstørrelse i både e-post og brukernavn",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL_OR_USERNAME",
      tags: ["signup", "normalization", "edge-case"],
      first: {
        provider: "email",
        email: makeEmail("a12-shared").toLowerCase(),
        username: makeUsername("a12shared").toLowerCase(),
      },
      second: {
        provider: "email",
        email: makeEmail("a12-shared", { casing: "mixed" }),
        username: makeUsername("a12shared", { casing: "mixed" }),
        emailCasing: "mixed",
        usernameCasing: "mixed",
      },
    },
  ];
}

// ============================================================================
// Gruppe B: Innlogging vs registreringsforvirring (4 scenarioer)
// ============================================================================

export function buildGroupB(): ScenarioDefinition[] {
  return [
    {
      id: "B01-login-after-signup",
      group: "B",
      groupName: "Innlogging vs registreringsforvirring",
      scenarioNumber: 1,
      description:
        "Registrering A med e-post/passord, logg ut, deretter innlogging med samme konto",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "LOGIN_SUCCESS_SAME_USER",
      tags: ["login", "session"],
      setupSteps: [
        "Opprett Clerk-bruker via API",
        "Kall test-auth-flow for å opprette lokal bruker",
      ],
      executionSteps: [
        "Naviger til /sign-in",
        "Skriv inn påloggingsdata",
        "Send skjema",
        "Verifiser omdirigering til dashbord",
      ],
      capturePoints: [
        "/api/user/me-respons",
        "Lokal bruker-ID stemmer",
        "Sesjonstoken er til stede",
      ],
    },
    {
      id: "B02-signup-again-same-identity",
      group: "B",
      groupName: "Innlogging vs registreringsforvirring",
      scenarioNumber: 2,
      description:
        "Etter registrering A, logg ut, prøv registrering igjen med samme e-post/brukernavn",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_AT_SIGNUP_FORM",
      tags: ["signup", "duplicate"],
      setupSteps: ["Opprett Clerk-bruker A via API", "Etabler lokal bruker via test-auth-flow"],
      executionSteps: [
        "Naviger til /sign-up",
        "Skriv inn samme e-post og brukernavn",
        "Send skjema",
        "Fang opp feiltilstand",
      ],
      capturePoints: [
        "Clerk-feilmelding i UI",
        "Ingen omdirigering til dashbord",
        "Ingen andre lokal bruker opprettet",
      ],
    },
    {
      id: "B03-signup-redirected-to-login",
      group: "B",
      groupName: "Innlogging vs registreringsforvirring",
      scenarioNumber: 3,
      description:
        "Verifiser om registrering med eksisterende bruker omdirigerer til innlogging eller viser feil",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "REDIRECT_OR_CLEAR_ERROR",
      tags: ["signup", "ux"],
      setupSteps: ["Opprett Clerk-bruker A", "Etabler lokal bruker"],
      executionSteps: [
        "Naviger til /sign-up",
        "Skriv inn eksisterende e-post",
        "Observer om omdirigert eller vist feil",
      ],
      capturePoints: [
        "Nåværende URL etter innsending",
        "Feilmelding hvis noen",
        "Om bruker oppfatter suksess vs feil",
      ],
    },
    {
      id: "B04-signup-silent-reuse-check",
      group: "B",
      groupName: "Innlogging vs registreringsforvirring",
      scenarioNumber: 4,
      description:
        "Verifiser at registrering ikke stille gjenbruker eksisterende konto og skaper frontend-illusjon",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "NO_SILENT_REUSE",
      tags: ["signup", "security"],
      setupSteps: ["Opprett Clerk-bruker A med e-post/brukernavn", "Etabler lokal bruker"],
      executionSteps: [
        "Naviger til /sign-up",
        "Fyll inn skjema med eksisterende e-post",
        "Sjekk om bruker er logget inn som A uten tydelig indikasjon",
      ],
      capturePoints: [
        "/api/user/me bruker-ID",
        "Om bruker ble informert om eksisterende konto",
        "Om dashbord-tilgang skjedde",
      ],
    },
  ];
}

// ============================================================================
// Gruppe C: Google/OAuth vs e-post/passord (7 scenarioer)
// ============================================================================

export function buildGroupC(): ScenarioDefinition[] {
  return [
    {
      id: "C01-google-then-email-same-email-same-username",
      group: "C",
      groupName: "Google/OAuth vs e-post",
      scenarioNumber: 1,
      description:
        "Registrering A med Google (E1, U1), deretter registrering B med e-post/passord (E1, U1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_OR_MERGED",
      tags: ["oauth", "google", "duplicate-email"],
      setupSteps: [
        "Registrer deg med ekte Google-konto",
        "Fang opp Clerk-brukertilstand",
        "Fang opp lokal brukertilstand",
      ],
      executionSteps: [
        "Logg ut",
        "Naviger til /sign-up",
        "Prøv e-post/passord-registrering med samme e-post",
      ],
      capturePoints: [
        "Clerk bruker-IDer (samme eller ulike?)",
        "Lokale bruker-IDer (samme eller ulike?)",
        "Feilmelding eller sammenslåingsatferd",
      ],
    },
    {
      id: "C02-google-then-email-same-email-diff-username",
      group: "C",
      groupName: "Google/OAuth vs e-post",
      scenarioNumber: 2,
      description:
        "Registrering A med Google (E1, U1), deretter registrering B med e-post/passord (E1, U2)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_EMAIL",
      tags: ["oauth", "google", "duplicate-email"],
      setupSteps: ["Registrer deg med ekte Google-konto", "Fullfør brukernavnvalg"],
      executionSteps: [
        "Logg ut",
        "Prøv e-post/passord-registrering med samme e-post, ulikt brukernavn",
      ],
      capturePoints: ["Om Clerk blokkerer ved e-post", "Om ulikt brukernavn ble forsøkt"],
    },
    {
      id: "C03-google-then-email-diff-email-same-username",
      group: "C",
      groupName: "Google/OAuth vs e-post",
      scenarioNumber: 3,
      description:
        "Registrering A med Google (E1, U1), deretter registrering B med e-post/passord (E2, U1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_USERNAME",
      tags: ["oauth", "google", "duplicate-username"],
      setupSteps: ["Registrer deg med Google, sett brukernavn U1"],
      executionSteps: [
        "Logg ut",
        "Prøv e-post/passord-registrering med ulik e-post, samme brukernavn",
      ],
      capturePoints: ["Om brukernavn-kollisjon fanges opp", "I hvilket steg (Clerk eller backend)"],
    },
    {
      id: "C04-google-clerk-user-state",
      group: "C",
      groupName: "Google/OAuth vs e-post",
      scenarioNumber: 4,
      description:
        "Fang opp om Clerk gjenbruker samme bruker eller oppretter ny ved Google+e-post-kollisjon",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_CLERK_BEHAVIOR",
      tags: ["oauth", "google", "clerk-investigation"],
      blocker: "Krever ekte Google OAuth-flyt",
      manualSteps: [
        "Registrer deg med Google",
        "Noter Clerk bruker-ID",
        "Logg ut",
        "Registrer deg med e-post/passord med samme e-post",
        "Noter om ny Clerk-bruker eller samme",
      ],
    },
    {
      id: "C05-google-local-db-state",
      group: "C",
      groupName: "Google/OAuth vs e-post",
      scenarioNumber: 5,
      description:
        "Fang opp om lokal backend gjenbruker samme bruker eller oppretter duplikat ved Google+e-post",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_LOCAL_BEHAVIOR",
      tags: ["oauth", "google", "db-investigation"],
      blocker: "Krever ekte Google OAuth-flyt",
      manualSteps: [
        "Registrer deg med Google",
        "Spør Users-samlingen for denne e-posten",
        "Logg ut",
        "Forsøk e-post/passord-registrering",
        "Spør Users-samlingen igjen",
        "Sammenlign antall brukerdokumenter og IDer",
      ],
    },
    {
      id: "C06-google-external-account-link",
      group: "C",
      groupName: "Google/OAuth vs e-post",
      scenarioNumber: 6,
      description: "Test kobling av Google til eksisterende e-post/passord-konto",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "LINK_SUCCESS_OR_BLOCKED",
      tags: ["oauth", "google", "linking"],
      setupSteps: ["Opprett e-post/passord-konto"],
      executionSteps: [
        "Naviger til profil/tilkoblede kontoer",
        "Forsøk å koble Google med samme e-post",
      ],
      capturePoints: ["Om koblingen lykkes", "Om oauthAccounts-arrayet ble oppdatert"],
    },
    {
      id: "C07-google-multiple-accounts-same-email",
      group: "C",
      groupName: "Google/OAuth vs e-post",
      scenarioNumber: 7,
      description: "Test kanttilfelle: flere Google-kontoer med samme e-postdomene-mønstre",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_EDGE_CASE",
      tags: ["oauth", "google", "edge-case"],
      blocker: "Krever flere Google-kontoer",
      manualSteps: [
        "Registrer deg med Google-konto A (f.eks. bruker@gmail.com)",
        "Logg ut",
        "Registrer deg med Google-konto B (f.eks. bruker+alias@gmail.com)",
        "Observer om de behandles som samme eller ulike",
      ],
    },
  ];
}

// ============================================================================
// Gruppe D: E-post/passord vs Google/OAuth (6 scenarioer)
// ============================================================================

export function buildGroupD(): ScenarioDefinition[] {
  return [
    {
      id: "D01-email-then-google-same-email",
      group: "D",
      groupName: "E-post vs Google/OAuth",
      scenarioNumber: 1,
      description:
        "Registrering A med e-post/passord (E1, U1), deretter registrering B med Google (samme e-post)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_MERGE_OR_BLOCK",
      tags: ["oauth", "google", "cross-provider"],
      setupSteps: ["Opprett Clerk-bruker via API med e-post/passord", "Etabler lokal bruker"],
      executionSteps: [
        "Logg ut",
        "Klikk 'Registrer med Google' med samme e-post",
        "Fullfør OAuth-flyten",
      ],
      capturePoints: [
        "Om Clerk slår sammen kontoer",
        "Om lokal bruker gjenbrukes",
        "externalAccounts array-tilstand",
      ],
    },
    {
      id: "D02-email-then-google-same-username",
      group: "D",
      groupName: "E-post vs Google/OAuth",
      scenarioNumber: 2,
      description:
        "Registrering A med e-post/passord (E1, U1), deretter registrering B med Google (E2, U1 hvis mulig)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "USERNAME_CONFLICT_IF_REACHABLE",
      tags: ["oauth", "google", "duplicate-username"],
      setupSteps: ["Opprett e-post/passord-bruker med brukernavn U1"],
      executionSteps: [
        "Logg ut",
        "Registrer deg med Google (ulik e-post)",
        "Forsøk å sette brukernavn til U1",
      ],
      capturePoints: ["Om brukernavn-konflikt fanges opp", "I hvilket steg"],
    },
    {
      id: "D03-email-then-google-clerk-reuse",
      group: "D",
      groupName: "E-post vs Google/OAuth",
      scenarioNumber: 3,
      description: "Fang opp Clerk-gjenbruk vs ny bruker ved tillegg av Google til e-postkonto",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_CLERK_BEHAVIOR",
      tags: ["oauth", "google", "clerk-investigation"],
      blocker: "Krever ekte Google OAuth",
      manualSteps: [
        "Opprett e-post/passord-bruker, noter Clerk-ID",
        "Logg ut",
        "Registrer/logg inn med Google med samme e-post",
        "Noter om ny Clerk-ID eller samme",
      ],
    },
    {
      id: "D04-email-then-google-local-db-reuse",
      group: "D",
      groupName: "E-post vs Google/OAuth",
      scenarioNumber: 4,
      description: "Fang opp lokal DB-gjenbruk vs duplikat ved tillegg av Google til e-postkonto",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_LOCAL_BEHAVIOR",
      tags: ["oauth", "google", "db-investigation"],
      blocker: "Krever ekte Google OAuth",
      manualSteps: [
        "Opprett e-post/passord-bruker, noter lokal _id",
        "Logg ut",
        "Registrer/logg inn med Google med samme e-post",
        "Spør DB for denne e-posten",
        "Sammenlign antall brukere og IDer",
      ],
    },
    {
      id: "D05-email-password-google-link-existing",
      group: "D",
      groupName: "E-post vs Google/OAuth",
      scenarioNumber: 5,
      description: "Koble Google til eksisterende e-post/passord fra profilsiden",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "LINK_SUCCESS_OAUTH_ARRAY_UPDATED",
      tags: ["oauth", "google", "linking"],
      setupSteps: ["Opprett e-post/passord-konto, logg inn"],
      executionSteps: ["Naviger til profil", "Klikk 'Koble til Google'", "Fullfør OAuth"],
      capturePoints: ["User.oauthAccounts etter kobling", "Om leverandør ble synkronisert"],
    },
    {
      id: "D06-email-password-google-link-conflict",
      group: "D",
      groupName: "E-post vs Google/OAuth",
      scenarioNumber: 6,
      description: "Koble Google som allerede er koblet til en annen lokal konto",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "OAUTH_CONFLICT_BLOCKED",
      tags: ["oauth", "google", "linking", "conflict"],
      setupSteps: ["Opprett konto A, koble Google", "Opprett konto B"],
      executionSteps: ["Logg inn som B", "Prøv å koble samme Google-konto"],
      capturePoints: ["Feilmelding", "Om oauthAccountConflict returneres"],
    },
  ];
}

// ============================================================================
// Gruppe E: Microsoft/OAuth (7 scenarioer)
// ============================================================================

export function buildGroupE(): ScenarioDefinition[] {
  return [
    {
      id: "E01-microsoft-then-email-same-email",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 1,
      description: "Microsoft-registrering A (E1, U1), deretter e-post/passord-registrering B (E1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_OR_MERGED",
      tags: ["oauth", "microsoft", "duplicate-email"],
      setupSteps: ["Registrer deg med Microsoft"],
      executionSteps: ["Logg ut", "Prøv e-post/passord-registrering med samme e-post"],
      capturePoints: ["Clerk-atferd", "Lokal DB-tilstand"],
    },
    {
      id: "E02-microsoft-then-email-same-username",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 2,
      description:
        "Microsoft-registrering A (E1, U1), deretter e-post/passord-registrering B (E2, U1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_BLOCKED_DUPLICATE_USERNAME",
      tags: ["oauth", "microsoft", "duplicate-username"],
      setupSteps: ["Registrer deg med Microsoft, sett brukernavn U1"],
      executionSteps: ["Logg ut", "Prøv e-post/passord-registrering med U1"],
      capturePoints: ["Deteksjon av brukernavn-konflikt"],
    },
    {
      id: "E03-email-then-microsoft-same-email",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 3,
      description: "E-post/passord-registrering A (E1, U1), deretter Microsoft-registrering B (E1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "CLERK_MERGE_OR_BLOCK",
      tags: ["oauth", "microsoft", "cross-provider"],
      setupSteps: ["Opprett e-post/passord-bruker"],
      executionSteps: ["Logg ut", "Registrer deg med Microsoft med samme e-post"],
      capturePoints: ["Om kontoer slås sammen", "Lokal DB-tilstand"],
    },
    {
      id: "E04-google-then-microsoft-same-email",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 4,
      description: "Google-registrering A (E1), deretter Microsoft-registrering B (E1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "MULTI_PROVIDER_HANDLING",
      tags: ["oauth", "google", "microsoft", "multi-provider"],
      setupSteps: ["Registrer deg med Google"],
      executionSteps: ["Logg ut", "Registrer deg med Microsoft med samme e-post"],
      capturePoints: ["Om leverandører sameksisterer", "externalAccounts-array"],
    },
    {
      id: "E05-microsoft-then-google-same-email",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 5,
      description: "Microsoft-registrering A (E1), deretter Google-registrering B (E1)",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "MULTI_PROVIDER_HANDLING",
      tags: ["oauth", "google", "microsoft", "multi-provider"],
      setupSteps: ["Registrer deg med Microsoft"],
      executionSteps: ["Logg ut", "Registrer deg med Google med samme e-post"],
      capturePoints: ["Om leverandører sameksisterer", "Lokal brukertilstand"],
    },
    {
      id: "E06-microsoft-link-to-existing",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 6,
      description: "Koble Microsoft til eksisterende e-post/passord-konto",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "LINK_SUCCESS_OR_BLOCKED",
      tags: ["oauth", "microsoft", "linking"],
      setupSteps: ["Opprett e-post/passord-konto"],
      executionSteps: ["Naviger til profil", "Koble Microsoft"],
      capturePoints: ["oauthAccounts etter kobling"],
    },
    {
      id: "E07-microsoft-link-conflict",
      group: "E",
      groupName: "Microsoft/OAuth",
      scenarioNumber: 7,
      description: "Koble Microsoft som allerede er koblet til en annen konto",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "OAUTH_CONFLICT_BLOCKED",
      tags: ["oauth", "microsoft", "linking", "conflict"],
      setupSteps: ["Konto A kobler Microsoft", "Opprett konto B"],
      executionSteps: ["Logg inn som B", "Prøv å koble samme Microsoft"],
      capturePoints: ["Feilrespons", "oauthAccountConflict"],
    },
  ];
}

// ============================================================================
// Gruppe F: SSO-kobling / leverandørgjenbruk (7 scenarioer)
// ============================================================================

export function buildGroupF(): ScenarioDefinition[] {
  return [
    {
      id: "F01-link-google-already-linked-to-other",
      group: "F",
      groupName: "SSO-kobling / leverandørgjenbruk",
      scenarioNumber: 1,
      description: "Konto A prøver å koble Google som allerede tilhører konto B",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "OAUTH_ACCOUNT_CONFLICT",
      tags: ["sso", "linking", "conflict"],
      setupSteps: ["Opprett A, koble Google", "Opprett B"],
      executionSteps: ["Logg inn som B", "Prøv å koble samme Google"],
      capturePoints: ["oauthAccountConflict-respons"],
    },
    {
      id: "F02-link-microsoft-already-linked-to-other",
      group: "F",
      groupName: "SSO-kobling / leverandørgjenbruk",
      scenarioNumber: 2,
      description: "Konto A prøver å koble Microsoft som allerede tilhører konto B",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "OAUTH_ACCOUNT_CONFLICT",
      tags: ["sso", "linking", "conflict"],
      setupSteps: ["Opprett A, koble Microsoft", "Opprett B"],
      executionSteps: ["Logg inn som B", "Prøv å koble samme Microsoft"],
      capturePoints: ["oauthAccountConflict-respons"],
    },
    {
      id: "F03-provider-reuse-after-deletion",
      group: "F",
      groupName: "SSO-kobling / leverandørgjenbruk",
      scenarioNumber: 3,
      description: "Prøv leverandørgjenbruk etter kontosletting",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "PROVIDER_REUSABLE_AFTER_DELETE",
      tags: ["sso", "deletion", "reuse"],
      setupSteps: ["Opprett A, koble Google", "Slett A"],
      executionSteps: ["Opprett B", "Prøv å koble samme Google"],
      capturePoints: ["Om kobling lykkes", "tombstone-tilstand"],
    },
    {
      id: "F04-provider-reuse-after-soft-delete",
      group: "F",
      groupName: "SSO-kobling / leverandørgjenbruk",
      scenarioNumber: 4,
      description: "Prøv leverandørgjenbruk etter myk-sletting/tombstone-tilstand",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_TOMBSTONE_BEHAVIOR",
      tags: ["sso", "deletion", "tombstone"],
      blocker: "Krever DB-manipulering for å opprette tombstone",
      manualSteps: [
        "Opprett konto med Google",
        "Myk-slett (sett deletedAt men behold identitetsfelt)",
        "Opprett ny konto",
        "Prøv å koble samme Google",
      ],
    },
    {
      id: "F05-provider-reuse-after-failed-cleanup",
      group: "F",
      groupName: "SSO-kobling / leverandørgjenbruk",
      scenarioNumber: 5,
      description: "Prøv leverandørgjenbruk etter mislykket opprydding",
      kind: "manual",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_CLEANUP_FAILURE_BEHAVIOR",
      tags: ["sso", "cleanup", "failure"],
      blocker: "Krever simulering av oppryddingsfeil",
      manualSteps: [
        "Opprett konto med Google",
        "Slett konto men avbryt opprydding",
        "Verifiser gjenværende oauthAccounts-oppføring",
        "Prøv å gjenbruke samme Google",
      ],
    },
    {
      id: "F06-clerk-ui-provider-linking",
      group: "F",
      groupName: "SSO-kobling / leverandørgjenbruk",
      scenarioNumber: 6,
      description: "Prøv leverandørkobling fra Clerk UI-sti hvis tilgjengelig",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_UI_PATH",
      tags: ["sso", "linking", "ui"],
      setupSteps: ["Opprett e-post/passord-konto"],
      executionSteps: [
        "Naviger til brukerprofil",
        "Finn seksjonen for tilkoblede kontoer",
        "Dokumenter tilgjengelige koblingsalternativer",
      ],
      capturePoints: ["Tilgjengelige UI-stier", "Koblingsflytatferd"],
    },
    {
      id: "F07-app-controlled-provider-linking",
      group: "F",
      groupName: "SSO-kobling / leverandørgjenbruk",
      scenarioNumber: 7,
      description: "Prøv leverandørkobling fra app-kontrollert sti",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_APP_PATH",
      tags: ["sso", "linking", "app-controlled"],
      setupSteps: ["Logg inn"],
      executionSteps: [
        "Naviger til /profil",
        "Finn eventuelle leverandørkoblingsknapper",
        "Dokumenter flyten",
      ],
      capturePoints: ["App-kontrollerte koblingsstier", "Suksess/feil"],
    },
  ];
}

// ============================================================================
// Gruppe G: Brukernavn-oppdateringsscenarioer (6 scenarioer)
// ============================================================================

export function buildGroupG(): ScenarioDefinition[] {
  return [
    {
      id: "G01-update-username-to-existing",
      group: "G",
      groupName: "Brukernavn-oppdatering",
      scenarioNumber: 1,
      description: "Innlogget bruker endrer brukernavn til et eksisterende brukernavn",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "USERNAME_UPDATE_BLOCKED",
      tags: ["update", "username", "conflict"],
      first: {
        provider: "email",
        email: makeEmail("g01-first"),
        username: makeUsername("g01first"),
      },
      second: {
        provider: "email",
        email: makeEmail("g01-second"),
        username: makeUsername("g01second"),
      },
      action: "update",
    },
    {
      id: "G02-update-username-same-casing",
      group: "G",
      groupName: "Brukernavn-oppdatering",
      scenarioNumber: 2,
      description: "Innlogget bruker endrer brukernavn til samme verdi med ulik bokstavstørrelse",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ALLOWED_OR_NORMALIZED",
      tags: ["update", "username", "casing"],
      first: {
        provider: "email",
        email: makeEmail("g02-user"),
        username: makeUsername("g02user").toLowerCase(),
      },
      action: "update",
    },
    {
      id: "G03-update-username-whitespace",
      group: "G",
      groupName: "Brukernavn-oppdatering",
      scenarioNumber: 3,
      description: "Innlogget bruker endrer brukernavn med ledende/etterfølgende mellomrom",
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
      groupName: "Brukernavn-oppdatering",
      scenarioNumber: 4,
      description: "Innlogget bruker endrer brukernavn til ugyldig format",
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
      groupName: "Brukernavn-oppdatering",
      scenarioNumber: 5,
      description: "Brukernavnendring mens en annen konflikterende konto opprettes samtidig",
      kind: "race_condition",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ONE_SUCCEEDS_ONE_FAILS",
      tags: ["update", "username", "race", "concurrency"],
      concurrentActions: [
        "Bruker A oppdaterer brukernavn til U",
        "Bruker B registrerer seg med brukernavn U",
      ],
      expectedRace: "DB unik indeks blokkerer en",
    },
    {
      id: "G06-update-username-conflict-timing",
      group: "G",
      groupName: "Brukernavn-oppdatering",
      scenarioNumber: 6,
      description: "Verifiser om konflikt blokkeres tidlig eller kun ved DB-skrivefeil",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "EARLY_BLOCK_OR_DB_FALLBACK",
      tags: ["update", "username", "timing"],
      first: {
        provider: "email",
        email: makeEmail("g06-first"),
        username: makeUsername("g06first"),
      },
      second: {
        provider: "email",
        email: makeEmail("g06-second"),
        username: makeUsername("g06second"),
      },
      action: "update",
    },
  ];
}

// ============================================================================
// Gruppe H: E-post-oppdateringsscenarioer (5 scenarioer)
// ============================================================================

export function buildGroupH(): ScenarioDefinition[] {
  return [
    {
      id: "H01-update-email-to-existing",
      group: "H",
      groupName: "E-post-oppdatering",
      scenarioNumber: 1,
      description: "Innlogget bruker endrer e-post til en eksisterende e-post",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "EMAIL_UPDATE_BLOCKED",
      tags: ["update", "email", "conflict"],
      setupSteps: ["Opprett bruker A med E1", "Opprett bruker B med E2"],
      executionSteps: ["Logg inn som B", "Prøv å endre e-post til E1"],
      capturePoints: ["Feilmelding", "Om blokkert hos Clerk eller backend"],
    },
    {
      id: "H02-update-email-same-casing",
      group: "H",
      groupName: "E-post-oppdatering",
      scenarioNumber: 2,
      description: "Innlogget bruker endrer e-post til samme verdi med ulik bokstavstørrelse",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ALLOWED_OR_NORMALIZED",
      tags: ["update", "email", "casing"],
      setupSteps: ["Opprett bruker med e-post i små bokstaver"],
      executionSteps: ["Prøv å endre til versjon med store bokstaver"],
      capturePoints: ["Om tillatt", "Lagret form"],
    },
    {
      id: "H03-update-email-clerk-ui",
      group: "H",
      groupName: "E-post-oppdatering",
      scenarioNumber: 3,
      description: "Innlogget bruker endrer e-post gjennom Clerk UI hvis tilgjengelig",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_CLERK_UI_PATH",
      tags: ["update", "email", "clerk-ui"],
      setupSteps: ["Logg inn"],
      executionSteps: [
        "Naviger til Clerk-brukerprofilkomponent",
        "Finn alternativ for e-postendring",
      ],
      capturePoints: ["Om e-postendring er eksponert", "Flytatferd"],
    },
    {
      id: "H04-update-email-app-controlled",
      group: "H",
      groupName: "E-post-oppdatering",
      scenarioNumber: 4,
      description: "Innlogget bruker endrer e-post gjennom app-kontrollert flyt",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DOCUMENT_APP_PATH",
      tags: ["update", "email", "app-controlled"],
      setupSteps: ["Logg inn"],
      executionSteps: ["Naviger til /profil", "Finn alternativ for e-postendring"],
      capturePoints: ["App-kontrollerte stier", "Synkronisering med Clerk"],
    },
    {
      id: "H05-update-email-consistency",
      group: "H",
      groupName: "E-post-oppdatering",
      scenarioNumber: 5,
      description:
        "Verifiser at frontend, Clerk og lokal backend forblir konsistente etter e-postendring",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ALL_CONSISTENT",
      tags: ["update", "email", "consistency"],
      setupSteps: ["Opprett bruker"],
      executionSteps: ["Endre e-post via tilgjengelig sti", "Spør alle tre kilder"],
      capturePoints: ["Frontend /me e-post", "Clerk-bruker e-post", "MongoDB e-post"],
    },
  ];
}

// ============================================================================
// Bygg alle grupper
// ============================================================================

export function buildGroupI(): ScenarioDefinition[] {
  // Sletting/gjenbruk-scenarioer - forkortet for plass
  return [
    {
      id: "I01-delete-then-reuse-username",
      group: "I",
      groupName: "Sletting/gjenbruk",
      scenarioNumber: 1,
      description: "Slett konto A, gjenbruk gammelt brukernavn på ny konto B",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "USERNAME_REUSABLE_AFTER_DELETE",
      tags: ["deletion", "reuse", "username"],
      first: {
        provider: "email",
        email: makeEmail("i01-first"),
        username: makeUsername("i01shared"),
      },
      second: {
        provider: "email",
        email: makeEmail("i01-second"),
        username: makeUsername("i01shared"),
      },
      action: "delete",
    },
    {
      id: "I02-delete-then-reuse-email",
      group: "I",
      groupName: "Sletting/gjenbruk",
      scenarioNumber: 2,
      description: "Slett konto A, gjenbruk gammel e-post på ny konto B",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "EMAIL_REUSABLE_AFTER_DELETE",
      tags: ["deletion", "reuse", "email"],
      first: {
        provider: "email",
        email: makeEmail("i02-shared"),
        username: makeUsername("i02first"),
      },
      second: {
        provider: "email",
        email: makeEmail("i02-shared"),
        username: makeUsername("i02second"),
      },
      action: "delete",
    },
    {
      id: "I03-delete-reuse-google",
      group: "I",
      groupName: "Sletting/gjenbruk",
      scenarioNumber: 3,
      description: "Gjenbruk gammel Google-identitet på ny konto B",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "GOOGLE_REUSABLE_AFTER_DELETE",
      tags: ["deletion", "reuse", "oauth"],
      setupSteps: ["Opprett A med Google", "Slett A"],
      executionSteps: ["Opprett B", "Koble samme Google"],
      capturePoints: ["Om kobling lykkes"],
    },
    {
      id: "I04-delete-reuse-microsoft",
      group: "I",
      groupName: "Sletting/gjenbruk",
      scenarioNumber: 4,
      description: "Gjenbruk gammel Microsoft-identitet på ny konto B",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "MICROSOFT_REUSABLE_AFTER_DELETE",
      tags: ["deletion", "reuse", "oauth"],
      setupSteps: ["Opprett A med Microsoft", "Slett A"],
      executionSteps: ["Opprett B", "Koble samme Microsoft"],
      capturePoints: ["Om kobling lykkes"],
    },
    {
      id: "I05-verify-tombstone-fields",
      group: "I",
      groupName: "Sletting/gjenbruk",
      scenarioNumber: 5,
      description: "Verifiser at tombstone-felt er nullstilt/anonymisert korrekt",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "TOMBSTONE_CORRECT",
      tags: ["deletion", "tombstone"],
      first: { provider: "email", email: makeEmail("i05-user"), username: makeUsername("i05user") },
      action: "delete",
    },
    {
      id: "I06-deleted-cannot-auth",
      group: "I",
      groupName: "Sletting/gjenbruk",
      scenarioNumber: 6,
      description: "Verifiser at slettet konto ikke fortsatt kan autentisere",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "AUTH_REJECTED",
      tags: ["deletion", "auth"],
      first: { provider: "email", email: makeEmail("i06-user"), username: makeUsername("i06user") },
      action: "delete",
    },
    {
      id: "I07-deleted-sessions-die",
      group: "I",
      groupName: "Sletting/gjenbruk",
      scenarioNumber: 7,
      description: "Verifiser at sesjoner for slettet konto avsluttes korrekt",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "SESSIONS_INVALIDATED",
      tags: ["deletion", "session"],
      setupSteps: ["Opprett bruker", "Logg inn"],
      executionSteps: ["Slett konto", "Prøv å aksessere beskyttet rute"],
      capturePoints: ["Sesjonsavvisning"],
    },
    {
      id: "I08-deleted-data-cleanup",
      group: "I",
      groupName: "Sletting/gjenbruk",
      scenarioNumber: 8,
      description: "Verifiser at alle brukerdata ryddes opp korrekt etter sletting",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DATA_CLEANED",
      tags: ["deletion", "cleanup"],
      first: { provider: "email", email: makeEmail("i08-user"), username: makeUsername("i08user") },
      action: "delete",
    },
  ] as ScenarioDefinition[];
}

export function buildGroupJ(): ScenarioDefinition[] {
  // Sesjon/kryss-fane-scenarioer
  return [
    {
      id: "J01-logout-other-tab",
      group: "J",
      groupName: "Sesjon/kryss-fane",
      scenarioNumber: 1,
      description: "Utlogging i en fane mens en annen beskyttet fane er åpen",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "OTHER_TAB_UPDATED",
      tags: ["session", "cross-tab", "logout"],
      setupSteps: ["Logg inn", "Åpne to faner"],
      executionSteps: ["Logg ut i fane 1", "Sjekk fane 2"],
      capturePoints: ["Fane 2 auth-tilstand"],
    },
    {
      id: "J02-delete-other-tab",
      group: "J",
      groupName: "Sesjon/kryss-fane",
      scenarioNumber: 2,
      description: "Slett konto i en fane mens en annen beskyttet fane er åpen",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "OTHER_TAB_SIGNED_OUT",
      tags: ["session", "cross-tab", "deletion"],
      setupSteps: ["Logg inn", "Åpne to faner"],
      executionSteps: ["Slett i fane 1", "Sjekk fane 2"],
      capturePoints: ["Fane 2 omdirigering"],
    },
    {
      id: "J03-inflight-during-logout",
      group: "J",
      groupName: "Sesjon/kryss-fane",
      scenarioNumber: 3,
      description: "Pågående forespørsel under utlogging",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "REQUEST_HANDLED_GRACEFULLY",
      tags: ["session", "race", "logout"],
      setupSteps: ["Logg inn"],
      executionSteps: ["Start lang forespørsel", "Logg ut midt i forespørselen"],
      capturePoints: ["Forespørselsresultat"],
    },
    {
      id: "J04-inflight-during-deletion",
      group: "J",
      groupName: "Sesjon/kryss-fane",
      scenarioNumber: 4,
      description: "Pågående forespørsel under sletting",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "REQUEST_HANDLED_GRACEFULLY",
      tags: ["session", "race", "deletion"],
      setupSteps: ["Logg inn"],
      executionSteps: ["Start lang forespørsel", "Slett midt i forespørselen"],
      capturePoints: ["Forespørselsresultat"],
    },
    {
      id: "J05-expired-clerk-token",
      group: "J",
      groupName: "Sesjon/kryss-fane",
      scenarioNumber: 5,
      description: "Utløpt Clerk-token under aktiv app-sesjon",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "TOKEN_REFRESH_OR_SIGNOUT",
      tags: ["session", "token", "expiry"],
      setupSteps: ["Logg inn"],
      executionSteps: ["Vent på tokenutløp", "Gjør forespørsel"],
      capturePoints: ["Oppdaterings- eller utloggingsatferd"],
    },
    {
      id: "J06-auth-conflict-other-tab",
      group: "J",
      groupName: "Sesjon/kryss-fane",
      scenarioNumber: 6,
      description: "Auth-konflikt i en fane mens en annen fane er åpen",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CONFLICT_PROPAGATES",
      tags: ["session", "cross-tab", "conflict"],
      setupSteps: ["Logg inn", "Åpne to faner"],
      executionSteps: ["Utløs konflikt i fane 1", "Sjekk fane 2"],
      capturePoints: ["Fane 2 konflikttilstand"],
    },
    {
      id: "J07-broadcast-channel-logout",
      group: "J",
      groupName: "Sesjon/kryss-fane",
      scenarioNumber: 7,
      description: "Verifiser at kryss-fane utloggingskringkasting fortsatt fungerer",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "BROADCAST_WORKS",
      tags: ["session", "broadcast", "logout"],
      setupSteps: ["Logg inn i flere faner"],
      executionSteps: ["Logg ut i en", "Sjekk de andre"],
      capturePoints: ["BroadcastChannel-hendelser"],
    },
    {
      id: "J08-stale-me-cache-cleared",
      group: "J",
      groupName: "Sesjon/kryss-fane",
      scenarioNumber: 8,
      description: "Verifiser at utdatert cachet /me-data tømmes korrekt",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CACHE_CLEARED",
      tags: ["session", "cache", "me"],
      setupSteps: ["Logg inn"],
      executionSteps: ["Logg ut", "Sjekk react-query cache"],
      capturePoints: ["Cache-tilstand etter utlogging"],
    },
  ] as ScenarioDefinition[];
}

export function buildGroupK(): ScenarioDefinition[] {
  // Sen-konflikt / frontend-illusjon-scenarioer
  return [
    {
      id: "K01-clerk-success-me-409",
      group: "K",
      groupName: "Sen-konflikt",
      scenarioNumber: 1,
      description: "Clerk-registrering ser vellykket ut, men /me returnerer 409",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CONFLICT_SHOWN_TO_USER",
      tags: ["late-conflict", "409"],
      setupSteps: ["Opprett konflikttilstand"],
      executionSteps: ["Registrer deg", "Kall /me"],
      capturePoints: ["/me-respons", "UI-tilstand"],
    },
    {
      id: "K02-clerk-success-me-403",
      group: "K",
      groupName: "Sen-konflikt",
      scenarioNumber: 2,
      description: "Clerk-registrering ser vellykket ut, men /me returnerer 403",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "AUTH_ERROR_SHOWN",
      tags: ["late-conflict", "403"],
      setupSteps: ["Opprett blokkert tilstand"],
      executionSteps: ["Registrer deg", "Kall /me"],
      capturePoints: ["/me-respons", "UI-tilstand"],
    },
    {
      id: "K03-dashboard-but-invalid-identity",
      group: "K",
      groupName: "Sen-konflikt",
      scenarioNumber: 3,
      description: "Frontend lander på dashbord, men backend-identitet er ugyldig",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "REDIRECT_OR_ERROR",
      tags: ["late-conflict", "illusion"],
      setupSteps: ["Opprett kanttilstand"],
      executionSteps: ["Naviger til dashbord"],
      capturePoints: ["Om beskyttet innhold vises"],
    },
    {
      id: "K04-username-conflict-resolver",
      group: "K",
      groupName: "Sen-konflikt",
      scenarioNumber: 4,
      description: "Brukernavn-konfliktløser vises etter registrering",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "RESOLVER_SHOWN",
      tags: ["late-conflict", "username", "resolver"],
      setupSteps: ["Opprett brukernavn-konflikt"],
      executionSteps: ["Registrer deg", "Sjekk UI"],
      capturePoints: ["Visning av konfliktmodal"],
    },
    {
      id: "K05-auth-conflict-guard-signout",
      group: "K",
      groupName: "Sen-konflikt",
      scenarioNumber: 5,
      description: "AuthConflictGuard logger ut bruker etter registrering",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "AUTO_SIGNOUT",
      tags: ["late-conflict", "guard", "signout"],
      setupSteps: ["Opprett konflikttilstand"],
      executionSteps: ["Registrer deg", "Observer vaktens atferd"],
      capturePoints: ["Utloggingsutløser"],
    },
    {
      id: "K06-same-account-perceived-new",
      group: "K",
      groupName: "Sen-konflikt",
      scenarioNumber: 6,
      description: "Samme konto gjenbrukt, men bruker oppfatter det som ny registrering",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "UX_CONFUSION_DETECTED",
      tags: ["late-conflict", "ux", "illusion"],
      setupSteps: ["Opprett gjenbruksscenario"],
      executionSteps: ["Registrer deg", "Sjekk meldinger"],
      capturePoints: ["Om bruker informeres"],
    },
    {
      id: "K07-new-clerk-no-local",
      group: "K",
      groupName: "Sen-konflikt",
      scenarioNumber: 7,
      description: "Ny Clerk-bruker opprettet, men ingen lokal DB-bruker opprettet",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ORPHANED_CLERK_USER",
      tags: ["late-conflict", "orphan"],
      first: { provider: "email", email: makeEmail("k07-user"), username: makeUsername("k07user") },
    },
    {
      id: "K08-new-clerk-backend-blocks-local",
      group: "K",
      groupName: "Sen-konflikt",
      scenarioNumber: 8,
      description: "Ny Clerk-bruker opprettet og backend blokkerer korrekt lokal opprettelse",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "BACKEND_BLOCKED_LOCAL",
      tags: ["late-conflict", "block"],
      first: {
        provider: "email",
        email: makeEmail("k08-first"),
        username: makeUsername("k08shared"),
      },
      second: {
        provider: "email",
        email: makeEmail("k08-second"),
        username: makeUsername("k08shared"),
      },
    },
  ] as ScenarioDefinition[];
}

export function buildGroupL(): ScenarioDefinition[] {
  // Kappløp/samtidighets-scenarioer
  return [
    {
      id: "L01-concurrent-signup-same-email",
      group: "L",
      groupName: "Kappløp/samtidighet",
      scenarioNumber: 1,
      description: "To samtidige registreringer med samme e-post",
      kind: "race_condition",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ONE_WINS_ONE_FAILS",
      tags: ["race", "signup", "email"],
      concurrentActions: ["Registrering A med E1", "Registrering B med E1"],
      expectedRace: "Clerk blokkerer en",
    },
    {
      id: "L02-concurrent-signup-same-username",
      group: "L",
      groupName: "Kappløp/samtidighet",
      scenarioNumber: 2,
      description: "To samtidige registreringer med samme brukernavn",
      kind: "race_condition",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ONE_WINS_ONE_FAILS",
      tags: ["race", "signup", "username"],
      concurrentActions: ["Registrering A med U1", "Registrering B med U1"],
      expectedRace: "Clerk eller DB blokkerer en",
    },
    {
      id: "L03-concurrent-me-calls",
      group: "L",
      groupName: "Kappløp/samtidighet",
      scenarioNumber: 3,
      description: "To samtidige /me-kall for samme ferske Clerk-bruker",
      kind: "race_condition",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "LOCAL_USER_CREATED_ONCE",
      tags: ["race", "me", "create"],
      concurrentActions: ["Kall /me", "Kall /me"],
      expectedRace: "findOrCreate dedupliserer",
    },
    {
      id: "L04-concurrent-username-update",
      group: "L",
      groupName: "Kappløp/samtidighet",
      scenarioNumber: 4,
      description: "Samtidige brukernavn-oppdateringskonflikter",
      kind: "race_condition",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "ONE_WINS_ONE_FAILS",
      tags: ["race", "update", "username"],
      concurrentActions: ["Bruker A oppdaterer til U", "Bruker B oppdaterer til U"],
      expectedRace: "DB unik indeks blokkerer en",
    },
    {
      id: "L05-concurrent-delete-auth",
      group: "L",
      groupName: "Kappløp/samtidighet",
      scenarioNumber: 5,
      description: "Samtidig sletting + auth-forespørsel",
      kind: "race_condition",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "GRACEFUL_HANDLING",
      tags: ["race", "delete", "auth"],
      concurrentActions: ["Slett konto", "Gjør auth-forespørsel"],
      expectedRace: "Forespørsel feiler elegant",
    },
    {
      id: "L06-concurrent-provider-link",
      group: "L",
      groupName: "Kappløp/samtidighet",
      scenarioNumber: 6,
      description: "Samtidige leverandørkoblingsforsøk",
      kind: "race_condition",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "ONE_WINS_ONE_FAILS",
      tags: ["race", "link", "oauth"],
      concurrentActions: ["Bruker A kobler Google", "Bruker B kobler samme Google"],
      expectedRace: "Første vinner",
    },
    {
      id: "L07-db-unique-indexes-fallback",
      group: "L",
      groupName: "Kappløp/samtidighet",
      scenarioNumber: 7,
      description: "Verifiser at DB unike indekser er den endelige reserveløsningen",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DB_PREVENTS_DUPLICATE",
      tags: ["race", "db", "index"],
      first: {
        provider: "email",
        email: makeEmail("l07-first"),
        username: makeUsername("l07shared"),
      },
      second: {
        provider: "email",
        email: makeEmail("l07-second"),
        username: makeUsername("l07shared"),
      },
    },
  ] as ScenarioDefinition[];
}

export function buildGroupM(): ScenarioDefinition[] {
  // Normalisering og dataintegritet-scenarioer
  return [
    {
      id: "M01-email-normalization-variants",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 1,
      description: "E-postnormalisering med store/små bokstav-varianter",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "NORMALIZED_CORRECTLY",
      tags: ["normalization", "email"],
      first: {
        provider: "email",
        email: makeEmail("m01-shared").toLowerCase(),
        username: makeUsername("m01first"),
      },
      second: {
        provider: "email",
        email: makeEmail("m01-shared").toUpperCase(),
        username: makeUsername("m01second"),
      },
    },
    {
      id: "M02-username-normalization-variants",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 2,
      description: "Brukernavn-normalisering med bokstavstørrelse-varianter",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "NORMALIZED_CORRECTLY",
      tags: ["normalization", "username"],
      first: {
        provider: "email",
        email: makeEmail("m02-first"),
        username: makeUsername("m02shared").toLowerCase(),
      },
      second: {
        provider: "email",
        email: makeEmail("m02-second"),
        username: makeUsername("m02shared").toUpperCase(),
      },
    },
    {
      id: "M03-empty-username",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 3,
      description: "Tomt brukernavn / null brukernavn-stier",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "VALIDATION_ERROR",
      tags: ["normalization", "username", "empty"],
      first: { provider: "email", email: makeEmail("m03-user"), username: "" },
    },
    {
      id: "M04-missing-usernameNormalized",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 4,
      description: "Brukere med brukernavn til stede men manglende usernameNormalized",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "DOCUMENT_STATE",
      tags: ["data-integrity", "migration"],
      blocker: "Krever DB-spørring",
      manualSteps: ["Spør DB for brukere der brukernavn eksisterer men usernameNormalized er null"],
    },
    {
      id: "M05-deleted-lingering-identity",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 5,
      description: "Slettede brukere med gjenværende identitetsfelt",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "IDENTITY_CLEARED",
      tags: ["data-integrity", "deletion"],
      first: { provider: "email", email: makeEmail("m05-user"), username: makeUsername("m05user") },
      action: "delete",
    },
    {
      id: "M06-duplicate-providerAccountId",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 6,
      description: "Duplikat providerAccountId i oauthAccounts",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "DOCUMENT_STATE",
      tags: ["data-integrity", "oauth"],
      blocker: "Krever DB-spørring",
      manualSteps: ["Spør DB for duplikate providerAccountId-oppføringer"],
    },
    {
      id: "M07-stale-syncConflict",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 7,
      description: "Utdaterte eller misformede syncConflict-oppføringer",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "DOCUMENT_STATE",
      tags: ["data-integrity", "sync"],
      blocker: "Krever DB-spørring",
      manualSteps: ["Spør DB for brukere med ikke-null syncConflict"],
    },
    {
      id: "M08-inconsistent-clerk-local",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 8,
      description: "Inkonsistent lokal rad der Clerk-felt og app-felt ikke stemmer overens",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "DOCUMENT_STATE",
      tags: ["data-integrity", "consistency"],
      blocker: "Krever Clerk API + DB-sammenligning",
      manualSteps: ["Sammenlign Clerk-brukerdata med lokal DB for eksempelbrukere"],
    },
    {
      id: "M09-unicode-edge-cases",
      group: "M",
      groupName: "Normalisering",
      scenarioNumber: 9,
      description: "Unicode-lignende kanttilfeller hvis støttet av brukernavnregler",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "VALIDATION_OR_NORMALIZED",
      tags: ["normalization", "unicode"],
      first: { provider: "email", email: makeEmail("m09-user"), username: "user_émoji_🎉" },
    },
  ] as ScenarioDefinition[];
}

export function buildGroupN(): ScenarioDefinition[] {
  // Clerk/lokal konsistens-scenarioer
  return [
    {
      id: "N01-clerk-admin-email-change",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 1,
      description: "Clerk-dashbord/admin endrer e-post direkte",
      kind: "admin_only",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "SYNC_ON_NEXT_AUTH",
      tags: ["consistency", "admin", "email"],
      blocker: "Krever tilgang til Clerk-dashbord",
      manualSteps: [
        "Logg inn på Clerk-dashbord",
        "Endre brukerens e-post",
        "Bruker logger inn igjen",
        "Sjekk lokal DB-synkronisering",
      ],
    },
    {
      id: "N02-clerk-admin-provider-link",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 2,
      description: "Clerk-dashbord/admin kobler leverandør direkte",
      kind: "admin_only",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "SYNC_ON_NEXT_AUTH",
      tags: ["consistency", "admin", "oauth"],
      blocker: "Krever tilgang til Clerk-dashbord",
      manualSteps: [
        "Koble leverandør via Clerk-dashbord",
        "Bruker logger inn",
        "Sjekk lokal oauthAccounts-synkronisering",
      ],
    },
    {
      id: "N03-clerk-admin-username-change",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 3,
      description: "Clerk-dashbord/admin endrer brukernavn direkte",
      kind: "admin_only",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "SYNC_ON_NEXT_AUTH",
      tags: ["consistency", "admin", "username"],
      blocker: "Krever tilgang til Clerk-dashbord",
      manualSteps: [
        "Endre brukernavn via Clerk-dashbord",
        "Bruker logger inn",
        "Sjekk lokal DB-synkronisering",
      ],
    },
    {
      id: "N04-background-sync-after-admin-change",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 4,
      description: "Bakgrunnssynkronisering etter admin-endring",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "SYNC_CONFLICT_RECORDED",
      tags: ["consistency", "sync"],
      blocker: "Krever admin-endring + synkroniseringsutløser",
      manualSteps: [
        "Gjør admin-endring",
        "Utløs bakgrunnssynkronisering",
        "Sjekk syncConflict-felt",
      ],
    },
    {
      id: "N05-sync-conflict-recorded",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 5,
      description: "Verifiser om syncConflict registreres ved misforhold",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "DOCUMENT_BEHAVIOR",
      tags: ["consistency", "sync", "conflict"],
      blocker: "Krever opprettelse av misforhold",
      manualSteps: ["Opprett Clerk/lokal misforhold", "Sjekk syncConflict"],
    },
    {
      id: "N06-sync-banner-appears",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 6,
      description: "Verifiser om banner/advarsel vises ved synkroniseringskonflikt",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "BANNER_SHOWN",
      tags: ["consistency", "ui", "banner"],
      setupSteps: ["Opprett synkroniseringskonflikt-tilstand"],
      executionSteps: ["Logg inn", "Naviger til dashbord"],
      capturePoints: ["Banner-synlighet"],
    },
    {
      id: "N07-sync-banner-dismiss",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 7,
      description: "Verifiser om bruker kan avvise synkroniseringskonflikt-banner",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DISMISS_BEHAVIOR",
      tags: ["consistency", "ui", "dismiss"],
      setupSteps: ["Opprett synkroniseringskonflikt"],
      executionSteps: ["Vis banner", "Klikk avvis"],
      capturePoints: ["Om avvisning vedvarer"],
    },
    {
      id: "N08-dismiss-hides-or-resolves",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 8,
      description: "Verifiser om avvisning kun skjuler UI eller faktisk løser tilstanden",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "UI_HIDE_VS_RESOLUTION",
      tags: ["consistency", "dismiss", "state"],
      setupSteps: ["Opprett konflikt", "Avvis"],
      executionSteps: ["Sjekk DB syncConflict-felt"],
      capturePoints: ["Felt-tilstand etter avvisning"],
    },
    {
      id: "N09-conflict-reappear-on-sync",
      group: "N",
      groupName: "Clerk/lokal konsistens",
      scenarioNumber: 9,
      description:
        "Verifiser om samme konflikt umiddelbart dukker opp igjen ved neste synkronisering",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "REAPPEAR_OR_STAY_DISMISSED",
      tags: ["consistency", "sync", "reappear"],
      setupSteps: ["Opprett konflikt", "Avvis", "Utløs synkronisering"],
      executionSteps: ["Sjekk banner-tilstand"],
      capturePoints: ["Om konflikten returnerer"],
    },
  ] as ScenarioDefinition[];
}

export function buildGroupO(): ScenarioDefinition[] {
  // Gjenoppretting / feilstatus-scenarioer
  return [
    {
      id: "O01-failed-signup-midway",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 1,
      description: "Mislykket registrering midtveis",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "NO_ORPHAN_STATE",
      tags: ["recovery", "signup", "failure"],
      setupSteps: [],
      executionSteps: ["Start registrering", "Avbryt midt i skjema", "Sjekk tilstand"],
      capturePoints: ["Clerk-brukertilstand", "Lokal DB-tilstand"],
    },
    {
      id: "O02-failed-google-callback",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 2,
      description: "Mislykket Google-tilbakekalling midtveis",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "NO_ORPHAN_STATE",
      tags: ["recovery", "oauth", "failure"],
      setupSteps: ["Start Google-registrering"],
      executionSteps: ["Avbryt ved Google-samtykke"],
      capturePoints: ["Tilstand etter avbrytelse"],
    },
    {
      id: "O03-failed-microsoft-callback",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 3,
      description: "Mislykket Microsoft-tilbakekalling midtveis",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "NO_ORPHAN_STATE",
      tags: ["recovery", "oauth", "failure"],
      setupSteps: ["Start Microsoft-registrering"],
      executionSteps: ["Avbryt ved Microsoft-samtykke"],
      capturePoints: ["Tilstand etter avbrytelse"],
    },
    {
      id: "O04-failed-local-sync-after-clerk",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 4,
      description: "Mislykket lokal synkronisering etter Clerk-suksess",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "CLERK_USER_ORPHANED",
      tags: ["recovery", "sync", "orphan"],
      first: { provider: "email", email: makeEmail("o04-user"), username: makeUsername("o04user") },
    },
    {
      id: "O05-failed-clerk-sync-after-local",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 5,
      description: "Mislykket Clerk-synkronisering etter lokal suksess",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "LOCAL_USER_ORPHANED",
      tags: ["recovery", "sync", "orphan"],
      blocker: "Krever simulering av Clerk API-feil",
      manualSteps: ["Opprett lokal bruker", "Feil Clerk-synkronisering", "Sjekk tilstand"],
    },
    {
      id: "O06-failed-delete-cleanup",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 6,
      description: "Mislykket slettingsopprydding",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "PARTIAL_CLEANUP",
      tags: ["recovery", "delete", "cleanup"],
      first: { provider: "email", email: makeEmail("o06-user"), username: makeUsername("o06user") },
      action: "delete",
    },
    {
      id: "O07-failed-signout-cleanup",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 7,
      description: "Mislykket utloggingsopprydding",
      kind: "e2e_browser",
      automatable: true,
      requiresE2e: true,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "SESSION_STATE_CLEAN",
      tags: ["recovery", "signout", "cleanup"],
      setupSteps: ["Logg inn"],
      executionSteps: ["Avbryt utlogging"],
      capturePoints: ["Sesjonstilstand"],
    },
    {
      id: "O08-cleanup-retry-behavior",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 8,
      description: "Oppryddingsforsøk-atferd",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "RETRY_WORKS",
      tags: ["recovery", "cleanup", "retry"],
      blocker: "Krever simulering av oppryddingsfeil",
      manualSteps: ["Mislykk opprydding", "Utløs nytt forsøk", "Sjekk resultat"],
    },
    {
      id: "O09-orphaned-clerk-user",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 9,
      description: "Foreldreløs Clerk-bruker (ingen lokal)",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "DOCUMENT_ORPHANS",
      tags: ["recovery", "orphan", "clerk"],
      blocker: "Krever Clerk/DB-sammenligning",
      manualSteps: ["Spør Clerk-brukere", "Spør lokale brukere", "Finn foreldreløse"],
    },
    {
      id: "O10-orphaned-local-user",
      group: "O",
      groupName: "Gjenoppretting",
      scenarioNumber: 10,
      description: "Foreldreløs lokal DB-bruker (Clerk slettet)",
      kind: "manual",
      automatable: false,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: true,
      expectedOutcome: "DOCUMENT_ORPHANS",
      tags: ["recovery", "orphan", "local"],
      blocker: "Krever Clerk/DB-sammenligning",
      manualSteps: ["Spør lokale brukere", "Sjekk Clerk for hver clerkId", "Finn foreldreløse"],
    },
  ] as ScenarioDefinition[];
}

export function buildGroupP(): ScenarioDefinition[] {
  // Sikkerhets- og misbruksnære scenarioer
  return [
    {
      id: "P01-rapid-signup-collisions",
      group: "P",
      groupName: "Sikkerhet",
      scenarioNumber: 1,
      description: "Forsøk gjentatte registreringskollisjoner raskt",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "RATE_LIMITED",
      tags: ["security", "rate-limit", "signup"],
      first: {
        provider: "email",
        email: makeEmail("p01-target"),
        username: makeUsername("p01target"),
      },
    },
    {
      id: "P02-rapid-username-collisions",
      group: "P",
      groupName: "Sikkerhet",
      scenarioNumber: 2,
      description: "Forsøk gjentatte brukernavn-endringskollisjoner raskt",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "RATE_LIMITED",
      tags: ["security", "rate-limit", "username"],
      first: { provider: "email", email: makeEmail("p02-user"), username: makeUsername("p02user") },
      action: "update",
    },
    {
      id: "P03-rapid-provider-link-collisions",
      group: "P",
      groupName: "Sikkerhet",
      scenarioNumber: 3,
      description: "Forsøk gjentatte leverandørkoblingskollisjoner raskt",
      kind: "e2e_oauth",
      automatable: false,
      requiresE2e: true,
      requiresOAuth: true,
      requiresAdmin: false,
      expectedOutcome: "RATE_LIMITED",
      tags: ["security", "rate-limit", "oauth"],
      setupSteps: [],
      executionSteps: ["Forsøk raskt å koble samme leverandør gjentatte ganger"],
      capturePoints: ["Hastighetsbegrensnings-respons"],
    },
    {
      id: "P04-rate-limiting-endpoints",
      group: "P",
      groupName: "Sikkerhet",
      scenarioNumber: 4,
      description: "Verifiser hastighetsbegrensningsatferd på relevante endepunkter",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "RATE_LIMITS_ENFORCED",
      tags: ["security", "rate-limit"],
      first: { provider: "email", email: makeEmail("p04-user"), username: makeUsername("p04user") },
    },
    {
      id: "P05-diagnostics-dev-only",
      group: "P",
      groupName: "Sikkerhet",
      scenarioNumber: 5,
      description: "Verifiser at diagnostikk virkelig er kun for utvikling",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "DIAGNOSTICS_BLOCKED_PROD",
      tags: ["security", "diagnostics"],
      first: { provider: "email", email: makeEmail("p05-user"), username: makeUsername("p05user") },
    },
    {
      id: "P06-debug-endpoint-info-leak",
      group: "P",
      groupName: "Sikkerhet",
      scenarioNumber: 6,
      description: "Verifiser at debug-endepunkter ikke lekker for mye informasjon",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "NO_SENSITIVE_LEAK",
      tags: ["security", "info-leak"],
      first: { provider: "email", email: makeEmail("p06-user"), username: makeUsername("p06user") },
    },
    {
      id: "P07-flowid-correlation",
      group: "P",
      groupName: "Sikkerhet",
      scenarioNumber: 7,
      description: "Verifiser at flowId-korrelasjon fungerer gjennom hele kjeden",
      kind: "executable",
      automatable: true,
      requiresE2e: false,
      requiresOAuth: false,
      requiresAdmin: false,
      expectedOutcome: "FLOWID_CORRELATES",
      tags: ["security", "logging", "correlation"],
      first: { provider: "email", email: makeEmail("p07-user"), username: makeUsername("p07user") },
    },
  ] as ScenarioDefinition[];
}

// ============================================================================
// Bygg komplett matrise
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
