/**
 * Dev-only helper: detekterer og rydder opp i blandede Clerk-cookies på localhost.
 *
 * Bakgrunn: Clerk kan i development bruke suffixed cookies (`__session_XXX`) som
 * del av egne redirect-/handshake-flows. Bare det at både suffixed og unsuffixed
 * cookies finnes samtidig er derfor ikke nok til å konkludere med feil.
 *
 * Det som faktisk er problematisk er inkonsistent state:
 *   - flere ulike suffix samtidig på samme localhost-origin
 *   - eller ulike verdier for samme Clerk-cookiefamilie
 *
 * I slike tilfeller kan `Clerk.session.getToken()` returnere null → 401 på
 * /api/user/me fordi Authorization-headeren mangler.
 *
 * Modulen gir tre funksjoner:
 *   1. `checkForStaleClerkCookies()` — logger en tydelig advarsel i konsollet med
 *      fix-instruks. Kalles tidlig i app-boot for raskt å gi utvikleren kontekst.
 *   2. `cleanupStaleClerkCookies()` — fjerner unsuffixed Clerk-cookies hvis en
 *      matchende suffixed variant eksisterer med identisk verdi. Kun trygt å kjøre
 *      når duplikatet er *verifisert* — vi rører aldri cookies som står alene.
 *   3. `installDevClerkResetHelper()` — eksponerer `window.__studywiseResetClerk()`
 *      i dev som aggressiv opprydding: sletter alle Clerk-cookies og reloader siden.
 *      Tenkt som manuell nødutgang når nivå 1+2 ikke er nok.
 *
 * Alt er no-op utenfor `process.env.NODE_ENV === "development"`. Prod-brukere
 * kan ikke havne i denne tilstanden (én Clerk-instans per domene), så det er
 * ingen grunn til å kjøre dette i prod.
 */

/** Navn på Clerk-cookies vi vet om. Brukes til match/cleanup. */
const CLERK_COOKIE_PREFIXES = [
  "__session",
  "__clerk_db_jwt",
  "__client_uat",
  "__refresh",
] as const;

type ClerkCookiePrefix = (typeof CLERK_COOKIE_PREFIXES)[number];
type CookieEntry = { name: string; value: string };
type ParsedCookieEntry = CookieEntry & { prefix: ClerkCookiePrefix; suffix: string | null };

function isDevMode(): boolean {
  return process.env.NODE_ENV === "development";
}

function readAllCookies(): CookieEntry[] {
  if (typeof document === "undefined") return [];
  return document.cookie
    .split("; ")
    .filter((c) => c.includes("="))
    .map((c) => {
      const eqIdx = c.indexOf("=");
      return { name: c.slice(0, eqIdx), value: c.slice(eqIdx + 1) };
    });
}

function parseClerkCookie(cookie: CookieEntry): ParsedCookieEntry | null {
  for (const prefix of CLERK_COOKIE_PREFIXES) {
    if (cookie.name === prefix) {
      return { ...cookie, prefix, suffix: null };
    }
    if (cookie.name.startsWith(`${prefix}_`)) {
      return {
        ...cookie,
        prefix,
        suffix: cookie.name.slice(prefix.length + 1),
      };
    }
  }
  return null;
}

function getClerkCookies(): ParsedCookieEntry[] {
  return readAllCookies()
    .map(parseClerkCookie)
    .filter((cookie): cookie is ParsedCookieEntry => cookie !== null);
}

type ClerkCookieAnalysis = {
  cleanupPrefixes: Set<ClerkCookiePrefix>;
  conflictingPrefixes: Set<ClerkCookiePrefix>;
  hasDualCookieState: boolean;
  hasSingleMirroredSuffixState: boolean;
  shouldWarn: boolean;
  suffixes: Set<string>;
};

function analyzeClerkCookies(clerkCookies: ParsedCookieEntry[]): ClerkCookieAnalysis {
  const suffixes = new Set(
    clerkCookies
      .map((cookie) => cookie.suffix)
      .filter((suffix): suffix is string => typeof suffix === "string" && suffix.length > 0),
  );
  const hasUnsuffixed = clerkCookies.some((cookie) => cookie.suffix === null);
  const hasSuffixed = suffixes.size > 0;
  const hasDualCookieState = hasUnsuffixed && hasSuffixed;
  const conflictingPrefixes = new Set<ClerkCookiePrefix>();
  const cleanupPrefixes = new Set<ClerkCookiePrefix>();

  for (const prefix of CLERK_COOKIE_PREFIXES) {
    const entriesForPrefix = clerkCookies.filter((cookie) => cookie.prefix === prefix);
    const unsuffixedEntry = entriesForPrefix.find((cookie) => cookie.suffix === null);
    const suffixedEntries = entriesForPrefix.filter((cookie) => cookie.suffix !== null);
    if (!unsuffixedEntry || suffixedEntries.length === 0) continue;

    const suffixedValues = new Set(suffixedEntries.map((cookie) => cookie.value));
    const suffixedSuffixes = new Set(
      suffixedEntries
        .map((cookie) => cookie.suffix)
        .filter((suffix): suffix is string => suffix !== null),
    );

    if (suffixedSuffixes.size > 1) {
      conflictingPrefixes.add(prefix);
    }

    const hasValueMismatch = Array.from(suffixedValues).some(
      (value) => value !== unsuffixedEntry.value,
    );
    if (hasValueMismatch) {
      conflictingPrefixes.add(prefix);
    }

    const hasExactDuplicate = Array.from(suffixedValues).some(
      (value) => value === unsuffixedEntry.value,
    );
    if (hasExactDuplicate && (suffixedSuffixes.size > 1 || hasValueMismatch)) {
      cleanupPrefixes.add(prefix);
    }
  }

  const hasSingleMirroredSuffixState =
    hasDualCookieState &&
    suffixes.size === 1 &&
    conflictingPrefixes.size === 0;

  return {
    cleanupPrefixes,
    conflictingPrefixes,
    hasDualCookieState,
    hasSingleMirroredSuffixState,
    shouldWarn: hasDualCookieState && !hasSingleMirroredSuffixState && conflictingPrefixes.size > 0,
    suffixes,
  };
}

/**
 * Nivå 1: Varsler i konsollet hvis dual cookie-state oppdages.
 * Returnerer true hvis varsel ble vist, false ellers.
 */
export function checkForStaleClerkCookies(): boolean {
  if (!isDevMode()) return false;
  if (typeof document === "undefined") return false;

  const clerkCookies = getClerkCookies();
  const analysis = analyzeClerkCookies(clerkCookies);
  if (!analysis.shouldWarn) return false;

  const reasons: string[] = [];
  if (analysis.suffixes.size > 1) {
    reasons.push("flere ulike Clerk-cookie-suffix");
  }
  if (analysis.conflictingPrefixes.size > 0) {
    reasons.push("ulik verdi i samme Clerk-cookiefamilie");
  }
  const reasonText = reasons.join(" og ");

  console.warn(
    "%c[StudyWise Dev] Inkonsistent Clerk-cookie-state oppdaget på localhost.%c\n" +
      `Vi fant ${reasonText || "konflikt i Clerk-cookies"}.\n` +
      "Dette kan føre til 401 på /api/user/me fordi Clerk.getToken() returnerer null.\n\n" +
      "Hvis du ser 401-feil:\n" +
      "  1. DevTools → Application → Cookies → localhost:3000 → Clear all\n" +
      "  2. Hard-refresh (Ctrl+Shift+R)\n" +
      "  3. Logg inn på nytt\n\n" +
      "Eller kjør %cwindow.__studywiseResetClerk()%c i konsollet for automatisk opprydding.",
    "color: #f59e0b; font-weight: bold;",
    "color: inherit;",
    "color: #3b82f6; font-weight: bold; font-family: monospace;",
    "color: inherit;",
  );
  return true;
}

/**
 * Nivå 3: Fjerner unsuffixed Clerk-cookies som har en matchende suffixed variant
 * med identisk verdi. Trygt fordi vi kun rører verifiserte duplikater.
 *
 * Returnerer antall cookies som ble slettet.
 */
export function cleanupStaleClerkCookies(): number {
  if (!isDevMode()) return 0;
  if (typeof document === "undefined") return 0;

  const clerkCookies = getClerkCookies();
  const analysis = analyzeClerkCookies(clerkCookies);
  if (!analysis.shouldWarn) return 0;

  let deletedCount = 0;
  for (const prefix of analysis.cleanupPrefixes) {
    deleteCookie(prefix);
    deletedCount++;
  }

  if (deletedCount > 0) {
    console.info(
      `%c[StudyWise Dev] Ryddet ${deletedCount} konfliktende Clerk-cookie(s). Last siden på nytt for å få ren tilstand.`,
      "color: #10b981; font-weight: bold;",
    );
  }

  return deletedCount;
}

function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  // Forsøk sletting på flere path/domain-kombinasjoner som Clerk kan ha brukt.
  // Cookies må slettes med samme attributter som de ble satt med.
  const pastDate = "Thu, 01 Jan 1970 00:00:00 GMT";
  const attempts = [
    `${name}=; expires=${pastDate}; path=/;`,
    `${name}=; expires=${pastDate}; path=/; domain=${window.location.hostname};`,
    `${name}=; expires=${pastDate}; path=/; domain=.${window.location.hostname};`,
  ];
  for (const cookieString of attempts) {
    document.cookie = cookieString;
  }
}

/**
 * Installerer `window.__studywiseResetClerk()` som en dev-nødutgang.
 * Sletter ALLE Clerk-cookies (både suffixed og unsuffixed) og reloader siden.
 * Tilsvarer manuell "Clear all" i DevTools for localhost, men raskere.
 */
export function installDevClerkResetHelper(): void {
  if (!isDevMode()) return;
  if (typeof window === "undefined") return;

  (window as Window & { __studywiseResetClerk?: () => void }).__studywiseResetClerk =
    () => {
      const clerkCookies = getClerkCookies();
      for (const cookie of clerkCookies) {
        deleteCookie(cookie.name);
      }
      console.info(
        `%c[StudyWise Dev] Slettet ${clerkCookies.length} Clerk-cookie(s). Reloader siden...`,
        "color: #10b981; font-weight: bold;",
      );
      window.location.reload();
    };
}
