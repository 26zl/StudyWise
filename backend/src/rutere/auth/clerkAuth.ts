/**
 * Synkroniserer Clerk-brukere til MongoDB User.
 * Finner eller oppretter bruker på clerkId og oppdaterer lokal profil fra Clerk ved behov.
 */
import { randomUUID } from "node:crypto";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { hashSha256 } from "../../utils/cryptoUtils.js";
import { User } from "../../database/models/User.js";
import { DeletedUserTombstone } from "../../database/models/DeletedUserTombstone.js";
import { logger } from "../../utils/logger.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import type { Request } from "express";
import {
  DEFAULT_ROLE,
  type AuthProvider,
  type OAuthAccount,
  type OAuthProvider,
  type SyncConflictType,
} from "common/auth";
import { TERMS_VERSION } from "common/system";
import type { IUser } from "../../database/models/User.js";
import { getConfiguredWebOrigins } from "../../utils/webOrigins.js";
import { sanitizeUsername } from "../../database/models/User.js";
import { isValidAuthTurnstileCookieValue } from "../../utils/authTurnstileCookie.js";
import { isProd, turnstileEnabled } from "../../utils/env.js";
import { getCache, setCache } from "../../cache/redis.js";
import { guardRelink, getCurrentClerkEnv, type ClerkEnv } from "./relinkGuard.js";
import { isMongoDuplicateKeyError } from "../../utils/canvasUserSync.js";

/** Minste intervall (ms) mellom profiloppdateringer fra Clerk for samme bruker (5 min). */
const CLERK_PROFILE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Holder styr på pågående profilsync pr. bruker, slik at parallelle kallere
 * deler på samme sync og får samme ferske resultat i stedet for å enten
 * konkurrere om dokumentet eller bli dumpet på stale Mongo-state.
 */
const existingUserProfileSyncs = new Map<
  string,
  Promise<IUser | null>
>();

/** Profilfelter hentet fra Clerk som synkroniseres til lokal User. */
type ClerkProfile = {
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  authProviders: AuthProvider[];
  /** OAuth-kontoer fra Clerk (provider + providerAccountId). */
  oauthAccounts: OAuthAccount[];
  /** Om brukeren har aktivert tofaktorautentisering (MFA/TOTP). */
  mfaEnabled: boolean;
  /** Om brukeren har generert backup-koder for MFA-recovery. */
  backupCodesEnabled: boolean;
  /** True hvis Clerk returnerte OAuth-kontoer som ble hoppet over pga. ufullstendige data (intern ID uten e-post). */
  hadSkippedIncompleteOauth?: boolean;
  /** True hvis Clerk hadde et auto-satt brukernavn (f.eks. e-post fra Microsoft SSO) som ble filtrert bort. */
  hadAutoSetSsoUsername?: boolean;
};

type RelinkableUser = Pick<IUser, "_id" | "clerkId" | "clerkEnv">;

// Clerk backend client brukes for å hente brukerinfo og sjekke helse, ikke for auth-verifisering – det gjøres med verifyToken() direkte i getClerkUserIdFromToken() for å unngå overhead ved å opprette klient i auth-flow.
let cachedClerkClient: ReturnType<typeof createClerkClient> | null = null;
let cachedClerkSecretKey: string | null = null;

function getClerkBackendClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    logger.warn("CLERK_SECRET_KEY mangler – kan ikke bruke Clerk Backend API");
    return null;
  }
  // Gjenbruk eksisterende klient hvis secret key er uendret
  if (cachedClerkClient && cachedClerkSecretKey === secretKey) {
    return cachedClerkClient;
  }
  cachedClerkClient = createClerkClient({ secretKey });
  cachedClerkSecretKey = secretKey;
  return cachedClerkClient;
}

/** Wrapper for Clerk API-kall med timeout for å forhindre hengende requests. */
const CLERK_API_TIMEOUT_MS = 10_000;
async function withClerkTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Clerk API timeout: ${label}`)), CLERK_API_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tilbakekaller alle aktive Clerk-sesjoner for en bruker.
 * Brukes av admin-funksjon "logg ut alle sesjoner".
 *
 * Returnerer `{ total, revoked }` slik at kaller kan skille fullt vellykket
 * (`total === revoked`) fra delvis feilet (noen sesjoner kastet under revoke
 * men ble svelget). Tidligere returnerte vi kun `revoked` — det skjulte
 * partial-failures fra sikkerhetskritiske kallere som reset-mfa.
 */
export async function revokeAllClerkSessions(
  clerkUserId: string,
): Promise<{ total: number; revoked: number }> {
  const clerk = getClerkBackendClient();
  if (!clerk) throw new Error("Clerk-klient ikke konfigurert");
  const sessions = await withClerkTimeout(
    clerk.sessions.getSessionList({ userId: clerkUserId, status: "active" }),
    "getSessionList",
  );
  const active = sessions.data ?? [];
  let revoked = 0;
  for (const session of active) {
    try {
      await clerk.sessions.revokeSession(session.id);
      revoked += 1;
    } catch (err) {
      logger.warn({ err, sessionId: session.id, clerkUserId }, "Kunne ikke revoke Clerk-sesjon");
    }
  }
  return { total: active.length, revoked };
}

/**
 * Deaktiverer alle MFA-faktorer (TOTP, backup codes, phone) for en bruker
 * i Clerk. Brukes av admin når en bruker har mistet tilgang til sin
 * autentiseringsapp og må settes opp på nytt.
 *
 * Returnerer true ved suksess (eller hvis brukeren ikke hadde MFA fra før —
 * Clerk er idempotent her). Kaster hvis Clerk-klient ikke er konfigurert
 * eller API-et svarer uventet, slik at admin-UI-et kan vise feil.
 */
export async function disableClerkUserMfa(clerkUserId: string): Promise<boolean> {
  const clerk = getClerkBackendClient();
  if (!clerk) throw new Error("Clerk-klient ikke konfigurert");
  try {
    await withClerkTimeout(
      clerk.users.disableUserMFA(clerkUserId),
      "disableUserMFA",
    );
    return true;
  } catch (error) {
    logger.error(
      { err: error, clerkUserId },
      "Kunne ikke deaktivere MFA i Clerk",
    );
    throw error;
  }
}

/**
 * Trigger Clerk til å sende verifiseringsepost på nytt for en bruker.
 * Bruker den primære e-postadressens emailAddressId.
 * Returnerer true hvis verifiseringsforespørsel ble sendt.
 */
export async function resendClerkEmailVerification(clerkUserId: string): Promise<boolean> {
  const clerk = getClerkBackendClient();
  if (!clerk) throw new Error("Clerk-klient ikke konfigurert");
  const user = await clerk.users.getUser(clerkUserId);
  const primaryEmailId = user.primaryEmailAddressId;
  if (!primaryEmailId) {
    throw new Error("Brukeren har ingen primær e-postadresse");
  }
  // Clerk SDK: createEmailAddress med verify-flagg, eller createVerificationEmail.
  // Vi bruker emailAddresses.updateEmailAddress for å trigge re-verifikasjon.
  await clerk.emailAddresses.updateEmailAddress(primaryEmailId, {
    verified: false,
  });
  return true;
}

/**
 * Sjekker at Clerk API er oppnåelig (brukes av /health).
 * Returnerer true hvis nøkkel er satt og et minimalt kall lykkes.
 */
export async function isClerkHealthy(): Promise<boolean> {
  const clerk = getClerkBackendClient();
  if (!clerk) return false;
  try {
    await clerk.users.getUserList({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

/** Sjekker om feilen er MongoDB duplicate key (E11000). Thin wrapper rundt delt util. */
function isDuplicateKeyError(error: unknown): boolean {
  return isMongoDuplicateKeyError(error);
}

/** Sjekker om duplicate key error er for OAuth accounts index. */
function isOAuthAccountDuplicateKeyError(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) return false;
  const keyPattern = (error as { keyPattern?: Record<string, unknown> })
    .keyPattern;
  return !!(keyPattern && "oauthAccounts.provider" in keyPattern);
}

/** Sjekker om duplicate key error er for username-indeks. */
function isUsernameDuplicateKeyError(error: unknown): boolean {
  if (!isDuplicateKeyError(error)) return false;
  const keyPattern = (error as { keyPattern?: Record<string, unknown> })
    .keyPattern;
  if (
    keyPattern &&
    ("usernameNormalized" in keyPattern || "username" in keyPattern)
  ) {
    return true;
  }
  // error er allerede validert som objekt av isDuplicateKeyError()
  const message =
    "message" in (error as object)
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return message.includes("username_normalized_unique");
}

/** Resultattype for OAuth-kontokonflikt. */
export type OAuthAccountConflictResult = {
  __oauthAccountConflict: true;
  provider: OAuthProvider;
  conflictingUserId: string;
};

/** Resultat når OAuth-innlogging mangler stabil provider-identifikator fra Clerk. */
export type OAuthMetadataMissingResult = {
  __oauthMetadataMissing: true;
  provider: Extract<AuthProvider, "google" | "microsoft">;
};

/** Typevakt for OAuthAccountConflictResult. */
export function isOAuthAccountConflict(result: AuthFlowResult): result is OAuthAccountConflictResult {
  return result !== null && typeof result === "object" && "__oauthAccountConflict" in result;
}

/** Typevakt for OAuthMetadataMissingResult. */
export function isOAuthMetadataMissing(result: AuthFlowResult): result is OAuthMetadataMissingResult {
  return result !== null && typeof result === "object" && "__oauthMetadataMissing" in result;
}

function queueDeletedOAuthConflictCleanup(account: OAuthAccount): void {
  const filter: Record<string, unknown> = {
    "oauthAccounts.provider": account.provider,
    "oauthAccounts.providerAccountId": account.providerAccountId,
  };

  void DeletedUserTombstone.updateMany(filter, {
    $unset: {
      oauthAccounts: 1,
    },
  })
    .then((result) => {
      if ((result.modifiedCount ?? 0) > 0) {
        logger.info(
          {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            modifiedCount: result.modifiedCount,
          },
          "Asynkron opprydding av stale OAuth-identiteter i tombstones fullført",
        );
      }
    })
    .catch((err) => {
      logger.warn(
        {
          err,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
        "Asynkron opprydding av stale OAuth-identiteter i tombstones feilet",
      );
    });
}

function queueDeletedUsernameCleanup(usernameNormalized: string): void {
  void DeletedUserTombstone.updateMany(
    {
      usernameNormalized,
    },
    {
      $unset: {
        usernameNormalized: 1,
      },
    },
  )
    .then((result) => {
      if ((result.modifiedCount ?? 0) > 0) {
        logger.info(
          { usernameNormalized, modifiedCount: result.modifiedCount },
          "Asynkron opprydding av stale brukernavn i tombstones fullført",
        );
      }
    })
    .catch((err) => {
      logger.warn(
        { err, usernameNormalized },
        "Asynkron opprydding av stale brukernavn i tombstones feilet",
      );
    });
}

/**
 * Sjekker om noen av OAuth-kontoene allerede er koblet til en annen bruker.
 * Returnerer konfliktinfo hvis funnet, null hvis ingen konflikt.
 */
async function checkOAuthAccountConflicts(
  oauthAccounts: OAuthAccount[],
  excludeUserId?: IUser["_id"] | null,
  excludeClerkId?: string | null,
): Promise<OAuthAccountConflictResult | null> {
  if (oauthAccounts.length === 0) return null;

  for (const account of oauthAccounts) {
    const baseFilter: Record<string, unknown> = {
      "oauthAccounts.provider": account.provider,
      "oauthAccounts.providerAccountId": account.providerAccountId,
    };
    if (excludeUserId) {
      baseFilter._id = { $ne: excludeUserId };
    }
    if (excludeClerkId) {
      baseFilter.clerkId = { $ne: excludeClerkId };
    }

    const activeConflictFilter: Record<string, unknown> = {
      ...baseFilter,
      deletedAt: { $exists: false },
    };
    const conflictingUser =
      await User.findOne(activeConflictFilter).select("_id");
    if (conflictingUser) {
      return {
        __oauthAccountConflict: true,
        provider: account.provider,
        conflictingUserId: conflictingUser._id.toString(),
      };
    }

    const hasDeletedConflicts = await DeletedUserTombstone.exists({
      "oauthAccounts.provider": account.provider,
      "oauthAccounts.providerAccountId": account.providerAccountId,
    });
    if (hasDeletedConflicts) {
      // Ikke blokker innlogging med opprydding av tombstones.
      queueDeletedOAuthConflictCleanup(account);
    }
  }

  return null;
}

/**
 * Sjekker om en clerkId finnes i den nåværende Clerk-instansen.
 * Returnerer false hvis brukeren ikke eksisterer (404) — typisk fordi clerkId-en
 * tilhører en annen Clerk-instans (f.eks. dev vs. prod).
 * Returnerer true hvis brukeren eksisterer, eller ved nettverksfeil (fail-safe).
 */
export async function clerkUserExistsInCurrentInstance(clerkId: string): Promise<boolean> {
  const clerk = getClerkBackendClient();
  if (!clerk) return true; // Fail-safe: anta den finnes

  try {
    await withClerkTimeout(clerk.users.getUser(clerkId), "getUser");
    return true;
  } catch (error) {
    // Clerk SDK v3+: sjekk status direkte (mer robust enn string-matching)
    if (isClerkAPIResponseError(error) && error.status === 404) {
      return false;
    }
    // Fallback: string-matching for eldre SDK-versjoner eller uventede feiltyper
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("404") || message.includes("not found") || message.includes("resource_not_found")) {
      return false;
    }
    // Nettverksfeil etc. — fail-safe, blokker som normalt
    logger.warn(
      { clerkId, errorMessage: error instanceof Error ? error.message : String(error) },
      "clerkUserExistsInCurrentInstance: ukjent feiltype fra Clerk API — fail-safe returnerer true",
    );
    return true;
  }
}

/**
 * Re-linker en eksisterende MongoDB-bruker til en ny clerkId.
 * Brukes når den eksisterende brukerens clerkId tilhører en annen Clerk-instans
 * (f.eks. dev Clerk vs. prod Clerk mot samme MongoDB).
 *
 * Sikkerhet: verifiserer at den nye Clerk-brukerens e-post matcher den eksisterende
 * MongoDB-brukerens e-post (eller OAuth-e-poster) før re-linking tillates.
 * Brukernavn oppdateres IKKE direkte her — det synkroniseres i et eget steg etter relink.
 * Primær e-post avgjøres heller ikke her — vanlig profilsynk håndterer eventuell oppdatering
 * eller konflikt mot andre brukere etter at clerkId er flyttet.
 */

/** Merger to lister med OAuth-kontoer basert på provider+providerAccountId (deduplisert).
 *  Oppdaterer e-post på eksisterende kontoer hvis incoming har en nyere verdi. */
function mergeOauthAccounts(
  existing: OAuthAccount[],
  incoming: OAuthAccount[],
): OAuthAccount[] {
  const merged = [...existing];
  for (const account of incoming) {
    const existingIdx = merged.findIndex(
      (e) =>
        e.provider === account.provider &&
        e.providerAccountId === account.providerAccountId,
    );
    if (existingIdx === -1) {
      merged.push(account);
    } else if (account.email && account.email !== merged[existingIdx].email) {
      // Oppdater e-post fra Clerk hvis den har endret seg (forhindrer stale data)
      merged[existingIdx] = { ...merged[existingIdx], email: account.email };
    }
  }
  return merged;
}

async function relinkUserToClerkId(
  existingUserId: IUser["_id"],
  newClerkUserId: string,
  profile: ClerkProfile,
  oauthAccounts: OAuthAccount[],
  clerkEmail?: string,
  previousClerkEnv?: ClerkEnv | null,
): Promise<IUser | null> {
  const currentClerkEnv = getCurrentClerkEnv();
  const existingUser = await User.findOne({
    _id: existingUserId,
    deletedAt: { $exists: false },
  }).select("email clerkEnv oauthAccounts authProviders");

  // Sikkerhet: bekreft at e-posten til den nye Clerk-brukeren matcher MongoDB-brukerens
  // primære e-post ELLER en av brukerens lagrede OAuth-e-poster.
  // OAuth-e-poster aksepteres fordi brukeren kan logge inn i prod via Google/Microsoft
  // mens primær-e-post er en annen (f.eks. Proton Mail).
  if (clerkEmail && existingUser) {
    const normalizedClerkEmail = clerkEmail.toLowerCase().trim();
    const primaryEmail = existingUser.email?.toLowerCase().trim();
    const oauthEmails = (existingUser.oauthAccounts ?? [])
      .map((a: { email?: string }) => a.email?.toLowerCase().trim())
      .filter(Boolean) as string[];
    const allKnownEmails = new Set([primaryEmail, ...oauthEmails].filter(Boolean));

    if (!allKnownEmails.has(normalizedClerkEmail)) {
      logger.warn(
        { existingUserId: existingUserId.toString(), newClerkUserId, clerkEmail },
        "Kryssmiljø re-link avvist: Clerk-brukerens e-post matcher verken primær eller OAuth-e-post",
      );
      await audit({
        actorUserId: `relink:${newClerkUserId}`,
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        category: "security",
        outcome: "failure",
        metadata: {
          reason: "cross_env_relink_email_mismatch",
          existingUserId: existingUserId.toString(),
          newClerkUserId,
        },
      });
      return null;
    }
  }

  // Kryssmiljø re-link guard: blokker ping-pong og dev/prod-blanding.
  const guard = await guardRelink(existingUserId.toString(), newClerkUserId, {
    previousClerkEnv: previousClerkEnv ?? existingUser?.clerkEnv ?? null,
  });
  if (guard.blocked) {
    logger.warn(
      {
        existingUserId: existingUserId.toString(),
        newClerkUserId,
        reason: guard.reason,
        count: guard.count,
        previousClerkEnv: previousClerkEnv ?? existingUser?.clerkEnv ?? null,
        currentEnv: currentClerkEnv,
      },
      guard.reason === "dev_gate_env_mismatch"
        ? "Kryssmiljø re-link blokkert (dev-gate): manuell utlogging kreves"
        : "Kryssmiljø re-link blokkert (ping-pong innenfor cooldown)",
    );
    await audit({
      actorUserId: `relink:${newClerkUserId}`,
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      category: "security",
      outcome: "failure",
      metadata: {
        reason: guard.reason,
        existingUserId: existingUserId.toString(),
        newClerkUserId,
        count: guard.count,
        previousClerkEnv: previousClerkEnv ?? existingUser?.clerkEnv ?? null,
        currentEnv: currentClerkEnv,
      },
    });
    return null;
  }

  // Merge authProviders og oauthAccounts med eksisterende verdier i stedet for å
  // overskrive — re-link skal bevare brukerens identitet (e-post, providers, kontoer).
  // Den nye Clerk-instansen har kanskje kun Google, men brukeren hadde email + Microsoft også.
  const mergedAuthProviders = [
    ...new Set([
      ...(existingUser?.authProviders ?? []),
      ...profile.authProviders,
    ]),
  ] as string[];

  const mergedOauthAccounts = mergeOauthAccounts(
    (existingUser?.oauthAccounts ?? []) as OAuthAccount[],
    oauthAccounts,
  );

  const updateFields: Record<string, unknown> = {
    clerkId: newClerkUserId,
    clerkEnv: currentClerkEnv,
    authProviders: mergedAuthProviders,
    mfaEnabled: profile.mfaEnabled,
    backupCodesEnabled: profile.backupCodesEnabled,
  };
  if (profile.firstName) updateFields.firstName = profile.firstName;
  if (profile.lastName) updateFields.lastName = profile.lastName;
  if (mergedOauthAccounts.length > 0) updateFields.oauthAccounts = mergedOauthAccounts;

  // Bygg $unset for tomme arrays (speiler logikken i buildClerkProfileUpdate)
  const unsetFields: Record<string, 1> = {};
  if (mergedOauthAccounts.length === 0) unsetFields.oauthAccounts = 1;

  const relinkedUser = await User.findOneAndUpdate(
    {
      _id: existingUserId,
      deletedAt: { $exists: false },
      clerkId: { $ne: newClerkUserId },
    },
    {
      $set: updateFields,
      ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
    },
    { returnDocument: "after" },
  ).select("+canvasApiToken");

  if (!relinkedUser) {
    const alreadyRelinkedUser = await User.findOne({
      _id: existingUserId,
      clerkId: newClerkUserId,
      deletedAt: { $exists: false },
    }).select("+canvasApiToken");

    if (!alreadyRelinkedUser) {
      return null;
    }

    try {
      return await syncExistingUserWithClerkProfile(
        alreadyRelinkedUser,
        newClerkUserId,
        profile,
      );
    } catch (err) {
      logger.warn(
        { err, userId: alreadyRelinkedUser._id.toString(), newClerkUserId },
        "Kryssmiljø re-link var allerede fullført, men etterfølgende profilsynk feilet",
      );
      return alreadyRelinkedUser;
    }
  }

  logger.info(
    { userId: relinkedUser._id.toString(), newClerkUserId },
    "Kryssmiljø re-link: eksisterende bruker re-linket til ny Clerk-instans",
  );
  // Behold relink-state i Redis slik at cooldown håndheves.
  // Tidligere ble nøkkelen slettet her, men det omgikk cooldownen fordi
  // neste relink-forsøk ble behandlet som "første gang" (tom state).
  // State har TTL på 5 min og ryddes automatisk av Redis.
  await audit({
    actorUserId: relinkedUser._id.toString(),
    action: AUDIT_ACTIONS.ACCOUNT_RELINKED,
    category: "auth",
    outcome: "success",
    metadata: {
      subAction: "cross_env_relink",
      newClerkUserId,
    },
  });

  try {
    return await syncExistingUserWithClerkProfile(
      relinkedUser,
      newClerkUserId,
      profile,
    );
  } catch (err) {
    logger.warn(
      { err, userId: relinkedUser._id.toString(), newClerkUserId },
      "Kryssmiljø re-link fullførte, men etterfølgende profilsynk feilet",
    );
    return relinkedUser;
  }
}

async function attemptRelinkWhenPreviousClerkMissing(options: {
  existingUser: RelinkableUser;
  clerkUserId: string;
  profile: ClerkProfile;
  oauthAccounts: OAuthAccount[];
  clerkEmail?: string;
  flowId?: string;
  infoMessage: string;
  warnMessage: string;
  logFields?: Record<string, unknown>;
}): Promise<IUser | null> {
  const {
    existingUser,
    clerkUserId,
    profile,
    oauthAccounts,
    clerkEmail,
    flowId,
    infoMessage,
    warnMessage,
    logFields = {},
  } = options;

  if (!existingUser.clerkId) {
    return null;
  }

  const existsInClerk = await clerkUserExistsInCurrentInstance(existingUser.clerkId);
  if (existsInClerk) {
    return null;
  }

  logger.info(
    {
      clerkUserId,
      oldClerkId: existingUser.clerkId,
      userId: existingUser._id,
      flowId,
      ...logFields,
    },
    infoMessage,
  );

  const relinked = await relinkUserToClerkId(
    existingUser._id,
    clerkUserId,
    profile,
    oauthAccounts,
    clerkEmail,
    existingUser.clerkEnv ?? null,
  );
  if (relinked) {
    return relinked;
  }

  logger.warn(
    {
      clerkUserId,
      oldClerkId: existingUser.clerkId,
      userId: existingUser._id,
      flowId,
      ...logFields,
    },
    warnMessage,
  );

  // Audit feilede relink-forsøk — sikkerhetsrelevant for å oppdage
  // gjentatte forsøk på kontoovertakelse via kryssmiljø-relink.
  void audit({
    actorUserId: `relink:${clerkUserId}`,
    action: AUDIT_ACTIONS.ACCOUNT_RELINKED,
    category: "security",
    outcome: "failure",
    metadata: {
      subAction: "cross_env_relink_failed",
      oldClerkId: existingUser.clerkId,
      flowId: flowId ?? null,
    },
  });

  return null;
}


/** Normaliserer e-post til lowercase og trim; returnerer null ved tom/manglende. */
function normalizeEmail(email: string | undefined): string | null {
  if (!email) {
    return null;
  }

  const normalized = email.toLowerCase().trim();
  return normalized.length > 0 ? normalized : null;
}

type UsernameSyncAction =
  | { mode: "set"; username: string; usernameNormalized: string }
  | { mode: "unset" }
  | { mode: "keep"; conflictingUserId: string }
  | { mode: "keep"; reason: "preserve_existing" };

async function resolveUsernameSyncAction(
  username: string | undefined,
  excludeUserId?: IUser["_id"] | null,
  existingUsername?: string,
): Promise<UsernameSyncAction> {
  const sanitized = sanitizeUsername(username);
  if (!sanitized) {
    // Clerk har ikke brukernavn — behold eksisterende hvis bruker allerede har et
    if (existingUsername) {
      return { mode: "keep", reason: "preserve_existing" };
    }
    return { mode: "unset" };
  }

  // Bevar eksisterende brukernavn under profilsynk — brukernavn-endringer
  // gjøres via PUT /profile (oppdaterer MongoDB + Clerk), ikke via Clerk-synk.
  // Dette forhindrer at kryssmiljø-relink overskriver brukernavnet med
  // dev-Clerk sitt brukernavn.
  if (existingUsername && existingUsername !== sanitized.username) {
    return { mode: "keep", reason: "preserve_existing" };
  }

  const baseFilter: Record<string, unknown> = {
    usernameNormalized: sanitized.usernameNormalized,
  };
  if (excludeUserId) {
    baseFilter._id = { $ne: excludeUserId };
  }

  const activeFilter: Record<string, unknown> = {
    ...baseFilter,
    deletedAt: { $exists: false },
  };
  const conflictingUser = await User.findOne(activeFilter).select("_id");
  if (conflictingUser) {
    return { mode: "keep", conflictingUserId: conflictingUser._id.toString() };
  }

  const hasDeletedConflicts = await DeletedUserTombstone.exists({
    usernameNormalized: sanitized.usernameNormalized,
  });
  if (hasDeletedConflicts) {
    // Ikke blokker innlogging med opprydding av tombstones.
    queueDeletedUsernameCleanup(sanitized.usernameNormalized);
  }

  return {
    mode: "set",
    username: sanitized.username,
    usernameNormalized: sanitized.usernameNormalized,
  };
}

function resolveStoredUsername(
  action: UsernameSyncAction,
  fallbackUsername: string | undefined,
): string | undefined {
  switch (action.mode) {
    case "set":
      return action.username;
    case "unset":
      return undefined;
    case "keep":
      return fallbackUsername;
  }
}

async function recordUserCreated(
  user: IUser,
  clerkUserId: string,
  req?: Request,
): Promise<void> {
  logger.info(
    { userId: user._id, clerkId: clerkUserId },
    "Clerk-bruker opprettet i MongoDB",
  );
  await audit({
    actorUserId: user._id.toString(),
    action: AUDIT_ACTIONS.USER_CREATED,
    category: "auth",
    outcome: "success",
    role: user.role ?? DEFAULT_ROLE,
    metadata: { clerkId: clerkUserId },
    req,
  });
  // Bruker har opprettet konto — det forutsetter at de har sett og klikket
  // gjennom aksept-teksten på sign-up-siden. Logg dette eksplisitt med
  // versjonen som gjaldt på opprettelsestidspunktet. Kombinert med
  // git-historikken til /vilkar og /personvern gir dette juridisk bevis
  // for nøyaktig hva hver bruker samtykket til og når.
  if (user.termsVersionAccepted && user.termsAcceptedAt) {
    await audit({
      actorUserId: user._id.toString(),
      action: AUDIT_ACTIONS.TERMS_ACCEPTED,
      category: "privacy",
      outcome: "success",
      role: user.role ?? DEFAULT_ROLE,
      metadata: {
        version: user.termsVersionAccepted,
        acceptedAt: user.termsAcceptedAt.toISOString(),
        context: "sign_up",
      },
      req,
    });
  }
}

/** Henter e-post og navn fra Clerk Backend API for en bruker. Returnerer null ved feil eller manglende primær e-post. */
async function getClerkProfile(
  clerkUserId: string,
): Promise<ClerkProfile | null> {
  const clerk = getClerkBackendClient();
  if (!clerk) {
    return null;
  }

  const clerkUser = await withClerkTimeout(clerk.users.getUser(clerkUserId), "getClerkProfile");
  if (!clerkUser) {
    return null;
  }

  const primaryEmail = clerkUser.emailAddresses.find(
    (e) => e.id === clerkUser.primaryEmailAddressId,
  );
  const email = normalizeEmail(primaryEmail?.emailAddress);
  if (!email) {
    logger.warn(
      { clerkUserId },
      "Clerk-bruker mangler primær e-postadresse og kan ikke synkroniseres",
    );
    return null;
  }

  if (primaryEmail?.verification?.status !== "verified") {
    logger.warn(
      { clerkUserId, email },
      "Primær e-postadresse er ikke verifisert. Kontoen kan ikke synkroniseres av sikkerhetshensyn.",
    );
    return null;
  }

  // Bestem innloggingsmetoder og samle OAuth-kontoer fra Clerk external accounts
  const authProviderSet = new Set<AuthProvider>();
  const oauthAccounts: OAuthAccount[] = [];
  let hadSkippedIncompleteOauth = false;
  const externalAccounts = clerkUser.externalAccounts ?? [];

  for (const account of externalAccounts) {
    const rawProvider = account.provider?.toLowerCase() ?? "";
    let mappedProvider: OAuthProvider | null = null;

    if (rawProvider.includes("google") || rawProvider === "oauth_google") {
      mappedProvider = "google";
      authProviderSet.add("google");
    } else if (
      rawProvider.includes("microsoft") ||
      rawProvider === "oauth_microsoft"
    ) {
      mappedProvider = "microsoft";
      authProviderSet.add("microsoft");
    }

    // Lagre OAuth-konto med providerAccountId og e-post for å forhindre at samme konto brukes på flere brukere.
    // Clerk Backend SDK har providerUserId direkte på ExternalAccount-klassen.
    // providerUserId kan være tom streng "" for uverifiserte kontoer — bruk account.id som fallback.
    const realProviderUserId = account.providerUserId?.trim() || null;
    const fallbackAccountId = account.id?.trim() || null;
    const accountId = realProviderUserId || fallbackAccountId;
    if (mappedProvider && accountId) {
      // Prøv e-post direkte fra external account først, deretter slå opp via
      // emailAddresses.linkedTo som Clerk bruker i dev mode (der emailAddress
      // på external account kan være tom, men e-posten finnes som linked adresse).
      //
      // Viktig: `EmailAddress.linkedTo[].id` peker til Identification-objektets
      // ID (idn_*), IKKE til ExternalAccount.id (eac_*). Clerk eksponerer
      // mappingen via `ExternalAccount.identificationId`. Å sammenligne mot
      // account.id var feil og gjorde at vi skippet legitimt linkede OAuth-
      // kontoer (symptom: Microsoft linket i Clerk ble aldri lagret i Mongo,
      // "OAuth-konto bruker intern ID og mangler e-post" i loggen).
      let oauthEmail = account.emailAddress;
      const identificationId = account.identificationId?.trim() || null;
      if ((!oauthEmail || !oauthEmail.includes("@")) && identificationId) {
        const linkedEmail = clerkUser.emailAddresses.find((ea) =>
          ea.linkedTo?.some((link) => link.id === identificationId),
        );
        if (linkedEmail?.emailAddress) {
          oauthEmail = linkedEmail.emailAddress;
        }
      }
      const hasValidEmail = typeof oauthEmail === "string" && oauthEmail.includes("@");

      // Skip OAuth-kontoer som bruker Clerk-intern ID (ikke ekte provider-ID) OG mangler e-post.
      // Disse er ufullstendige Clerk-artefakter (f.eks. etter kryssmiljø-relink) som ville
      // duplisere eksisterende kontoer med en annen providerAccountId og uten kryssvalidering.
      if (!realProviderUserId && !hasValidEmail) {
        logger.warn(
          { provider: mappedProvider, clerkUserId, fallbackAccountId },
          "OAuth-konto fra Clerk bruker intern ID og mangler e-post — hopper over (ufullstendig konto)",
        );
        hadSkippedIncompleteOauth = true;
      } else {
        if (!hasValidEmail) {
          logger.warn(
            { provider: mappedProvider, clerkUserId },
            "OAuth-konto fra Clerk mangler e-postadresse — kryssvalidering av e-post vil ikke fungere for denne kontoen",
          );
        }
        oauthAccounts.push({
          provider: mappedProvider,
          providerAccountId: String(accountId),
          ...(hasValidEmail
            ? { email: oauthEmail.toLowerCase().trim() }
            : {}),
        });
      }
    } else if (mappedProvider && !accountId) {
      logger.warn(
        {
          provider: mappedProvider,
          clerkUserId,
          verification: account.verification?.status,
          rawProviderUserId: account.providerUserId,
          rawAccountId: account.id,
        },
        "OAuth-konto fra Clerk mangler providerUserId og externalId — kan ikke lagre i oauthAccounts",
      );
    }
  }

  // Sjekk om brukeren har e-postadresser som ikke er knyttet til en OAuth-konto (lokal e-post)
  const oauthEmails = new Set(
    oauthAccounts.map((a) => a.email?.toLowerCase()).filter(Boolean),
  );
  const harLokalEpost = clerkUser.emailAddresses.some((e) => {
    const addr = e.emailAddress?.toLowerCase()?.trim();
    return addr && !oauthEmails.has(addr);
  });

  if (harLokalEpost) {
    authProviderSet.add("email");
  } else if (authProviderSet.size === 0) {
    // Fallback: ingen OAuth og ingen lokal e-post — bør ikke skje, men sikrer at listen aldri er tom
    authProviderSet.add("email");
  }

  const authProviders: AuthProvider[] = [...authProviderSet];

  // Clerk markerer MFA som aktivert når brukeren har minst én TOTP-faktor
  const mfaEnabled = clerkUser.twoFactorEnabled === true;
  // Clerk eksponerer backupCodeEnabled separat — settes til true når brukeren
  // har generert backup-koder via UserProfile / Account Portal.
  const backupCodesEnabled = clerkUser.backupCodeEnabled === true;

  // Ignorer Clerk-brukernavn som er identisk med e-postadressen (case-insensitivt).
  // Microsoft SSO setter automatisk username = e-post i Clerk, mens Google lar det
  // stå tomt. Vi vil kun akseptere brukernavn som brukeren bevisst har valgt —
  // enten via sign-up-flyten eller PUT /profile, ikke auto-satte SSO-verdier.
  const clerkUsername = clerkUser.username ?? undefined;
  const isAutoSetSsoUsername =
    clerkUsername && clerkUsername.toLowerCase() === email.toLowerCase();

  return {
    email,
    username: isAutoSetSsoUsername ? undefined : clerkUsername,
    /** True hvis Clerk hadde et auto-satt brukernavn (f.eks. e-post fra SSO) som ble filtrert bort. */
    hadAutoSetSsoUsername: !!isAutoSetSsoUsername,
    firstName: clerkUser.firstName ?? undefined,
    lastName: clerkUser.lastName ?? undefined,
    authProviders,
    oauthAccounts,
    mfaEnabled,
    backupCodesEnabled,
    hadSkippedIncompleteOauth,
  };
}

/** Avgjør om eksisterende bruker bør få profil oppdatert fra Clerk (aldri synket eller for gammel synk). */
function shouldSyncExistingUserProfile(user: IUser): boolean {
  if (!user.clerkId) {
    return false;
  }

  if (!user.clerkProfileSyncedAt) {
    return true;
  }

  const elapsed = Date.now() - user.clerkProfileSyncedAt.getTime();
  // Håndter NTP-drift: hvis synctidspunktet er i fremtiden, tving re-synk
  if (elapsed < 0) return true;
  return elapsed >= CLERK_PROFILE_SYNC_INTERVAL_MS;
}

/** Bygger MongoDB $set/$unset-objekt for å oppdatere User med Clerk-profil; includeEmail=false brukes ved e-postkonflikt. */
function buildClerkProfileUpdate(
  profile: ClerkProfile,
  syncedAt: Date,
  options: {
    includeEmail?: boolean;
    /** Bevar eksisterende firstName/lastName i MongoDB (brukes ved post-relink sync
     *  der Clerk-instansen kan ha ufullstendige navn fra OAuth sign-up). */
    preserveNames?: boolean;
    usernameAction: UsernameSyncAction;
  },
) {
  const { includeEmail = true, preserveNames = false, usernameAction } = options;
  const currentClerkEnv = getCurrentClerkEnv();
  const setFields: Record<string, unknown> = {
    clerkProfileSyncedAt: syncedAt,
    clerkEnv: currentClerkEnv,
  };
  const unsetFields: Record<string, 1> = {};

  if (includeEmail) {
    setFields.email = profile.email;
  }

  setFields.mfaEnabled = profile.mfaEnabled;
  setFields.backupCodesEnabled = profile.backupCodesEnabled;

  // Synk alle innloggingsmetoder fra Clerk (liste over alle tilkoblede providere)
  if (profile.authProviders.length > 0) {
    setFields.authProviders = profile.authProviders;
  }

  if (profile.oauthAccounts.length > 0) {
    setFields.oauthAccounts = profile.oauthAccounts;
  } else if (!profile.hadSkippedIncompleteOauth) {
    // Kun fjern oauthAccounts hvis Clerk faktisk rapporterte null OAuth-kontoer.
    // Hvis kontoer ble hoppet over pga. ufullstendige data (f.eks. kryssmiljø-relink
    // der Clerk returnerer intern ID uten e-post), behold eksisterende data i MongoDB.
    unsetFields.oauthAccounts = 1;
  }

  if (usernameAction.mode === "set") {
    setFields.username = usernameAction.username;
    setFields.usernameNormalized = usernameAction.usernameNormalized;
  } else if (usernameAction.mode === "unset") {
    unsetFields.username = 1;
    unsetFields.usernameNormalized = 1;
  }

  if (!preserveNames) {
    if (profile.firstName) {
      setFields.firstName = profile.firstName;
    } else {
      unsetFields.firstName = 1;
    }

    if (profile.lastName) {
      setFields.lastName = profile.lastName;
    } else {
      unsetFields.lastName = 1;
    }
  }

  return {
    $set: setFields,
    ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
  };
}

/**
 * Legger til en synkroniseringskonflikt på bruker-dokumentet slik at frontend kan vise den.
 * Erstatter eksisterende konflikt av samme type (unngår duplikater).
 */
async function recordSyncConflict(
  userId: IUser["_id"],
  conflict: {
    type: SyncConflictType;
    melding: string;
    clerkVerdi?: string;
    lokalVerdi?: string;
  },
): Promise<void> {
  const entry = {
    ...conflict,
    oppdagetVed: new Date().toISOString(),
  };

  // Atomisk: fjern eksisterende konflikt av samme type og legg til ny i én operasjon.
  // Mongoose v9 krever `updatePipeline: true` for aggregation pipeline-syntaks (array som andre arg).
  // allow-deleted-users: userId er allerede validert av kall-stedet (sync-flyten) før denne hjelperen kalles
  await User.updateOne(
    { _id: userId },
    [
      {
        $set: {
          syncConflicts: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ["$syncConflicts", []] },
                  cond: { $ne: ["$$this.type", conflict.type] },
                },
              },
              [entry],
            ],
          },
        },
      },
    ],
    { updatePipeline: true },
  );

  // Logg uten PII — clerkVerdi/lokalVerdi kan inneholde e-postadresser
  logger.warn(
    {
      userId,
      conflictType: conflict.type,
    },
    `Synkroniseringskonflikt registrert: ${conflict.type}`,
  );
}

/**
 * Oppdaterer eksisterende User med Clerk-profil.
 * Ved e-postkonflikt: setter syncConflict og beholder lokal e-post.
 * Ved OAuth-konflikt: setter syncConflict og beholder lokale oauthAccounts.
 * Ved duplicate key (race) returneres siste lagrede bruker.
 */
async function syncExistingUserWithClerkProfile(
  existing: IUser,
  clerkUserId: string,
  profile: ClerkProfile,
): Promise<IUser> {
  const syncedAt = new Date();
  const existingUsername = existing.username ?? undefined;
  const usernameAction = await resolveUsernameSyncAction(
    profile.username,
    existing._id,
    existingUsername,
  );
  const nextUsername = resolveStoredUsername(usernameAction, existingUsername);
  const existingOauth = JSON.stringify(existing.oauthAccounts ?? []);
  const nextOauth = JSON.stringify(profile.oauthAccounts ?? []);
  const oauthAccountsChanged = existingOauth !== nextOauth;
  const emailChanged = existing.email !== profile.email;
  const usernameChanged = existingUsername !== nextUsername;
  const firstNameChanged =
    (existing.firstName ?? undefined) !== profile.firstName;
  const lastNameChanged = (existing.lastName ?? undefined) !== profile.lastName;

  if (usernameAction.mode === "keep") {
    const reason = "reason" in usernameAction ? usernameAction.reason : "conflict";
    logger.info(
      {
        clerkUserId,
        userId: existing._id,
        ...("conflictingUserId" in usernameAction ? { conflictingUserId: usernameAction.conflictingUserId } : {}),
        reason,
      },
      reason === "preserve_existing"
        ? "Bevarer eksisterende brukernavn under profilsynk (Clerk-brukernavn annerledes)"
        : "Droppet Clerk-brukernavn fordi det allerede er i bruk",
    );
  }

  if (
    !emailChanged &&
    !usernameChanged &&
    !firstNameChanged &&
    !lastNameChanged &&
    !oauthAccountsChanged
  ) {
    // allow-deleted-users: `existing` er allerede validert som aktiv bruker av kall-stedet (findOrCreateUserByClerkId)
    const updated = await User.findByIdAndUpdate(
      existing._id,
      { $set: { clerkProfileSyncedAt: syncedAt } },
      { returnDocument: "after" },
    ).select("+canvasApiToken");
    return updated ?? existing;
  }

  // Etter kryssmiljø re-link kan Clerk ha en annen primær-e-post enn MongoDB og
  // færre providers/OAuth-kontoer enn det som er lagret (den nye Clerk-instansen
  // kjenner kun sin egen provider, f.eks. bare Google, mens MongoDB har email+Google+Microsoft).
  // Deteksjon: Clerk sin primær-e-post matcher en av brukerens eksisterende OAuth-kontoer
  // men er forskjellig fra MongoDB sin e-post — da er det en re-link-artefakt.
  // Beregnes FØR e-post/OAuth-konfliktsjekker slik at alle paths bruker beskyttede verdier.
  const isPostRelinkSync =
    emailChanged &&
    existing.email != null &&
    profile.email != null &&
    existing.email !== profile.email &&
    (existing.oauthAccounts ?? []).some(
      (a) => a.email?.toLowerCase().trim() === profile.email!.toLowerCase().trim(),
    );

  // Hvis post-relink: merge providers/OAuth i stedet for å overskrive
  const syncProfile = isPostRelinkSync
    ? {
        ...profile,
        authProviders: [
          ...new Set([
            ...(existing.authProviders ?? []),
            ...profile.authProviders,
          ]),
        ] as typeof profile.authProviders,
        oauthAccounts: mergeOauthAccounts(
          (existing.oauthAccounts ?? []) as OAuthAccount[],
          profile.oauthAccounts,
        ),
      }
    : profile;

  // Etter re-link: behold eksisterende brukernavn (Clerk-instansen har et annet)
  const syncUsernameAction: typeof usernameAction = isPostRelinkSync && usernameAction.mode === "set"
    ? { mode: "keep" as const, reason: "preserve_existing" as const }
    : usernameAction;

  if (emailChanged && !isPostRelinkSync) {
    // Kun ved reelle e-postendringer (ikke post-relink artefakt der Clerk har OAuth-e-post
    // som primær mens MongoDB har den opprinnelige e-posten — det er forventet og uskadelig).
    const conflictingUser = await User.findOne({
      email: profile.email,
      _id: { $ne: existing._id },
      deletedAt: { $exists: false },
    });

    if (conflictingUser) {
      logger.warn(
        {
          clerkUserId,
          userId: existing._id,
          conflictingUserId: conflictingUser._id,
        },
        "Kunne ikke oppdatere lokal e-post fra Clerk fordi adressen allerede er i bruk",
      );

      // Registrer synkroniseringskonflikt slik at frontend kan vise den til brukeren.
      await recordSyncConflict(existing._id, {
        type: "email_mismatch",
        melding:
          `E-postadressen «${profile.email}» som er registrert i innloggingskontoen din er allerede i bruk ` +
          "av en annen StudyWise-bruker. Kontoen din bruker fortsatt den opprinnelige e-posten. " +
          "Endre e-posten tilbake i kontoinnstillingene, eller kontakt support.",
        clerkVerdi: profile.email,
        lokalVerdi: existing.email,
      });

      // allow-deleted-users: `existing` er allerede en validert User-doc fra findOrCreateUserByClerkId-flyten
      // isPostRelinkSync er alltid false her (ytre guard: `emailChanged && !isPostRelinkSync`)
      const updatedWithoutEmail = await User.findByIdAndUpdate(
        existing._id,
        buildClerkProfileUpdate(syncProfile, syncedAt, {
          includeEmail: false,
          usernameAction: syncUsernameAction,
        }),
        { returnDocument: "after" },
      ).select("+canvasApiToken");
      return updatedWithoutEmail ?? existing;
    }
  }

  // Kryssvalidering: sjekk om nylig tilkoblede OAuth-kontoers e-post matcher en annen brukers primær-e-post
  if (oauthAccountsChanged) {
    const newOauthEmails = profile.oauthAccounts
      .filter(
        (a) =>
          !existing.oauthAccounts?.some(
            (e) =>
              e.provider === a.provider &&
              e.providerAccountId === a.providerAccountId,
          ),
      )
      .map((a) => a.email)
      .filter((e): e is string => !!e);

    if (newOauthEmails.length > 0) {
      // Sjekk mot andre brukeres primær-e-post OG oauthAccounts.email (speiler registreringslogikk)
      const conflictByOauthEmail = await User.findOne({
        $or: [
          { email: { $in: newOauthEmails } },
          { "oauthAccounts.email": { $in: newOauthEmails } },
        ],
        _id: { $ne: existing._id },
        deletedAt: { $exists: false },
      }).select("_id");

      if (conflictByOauthEmail) {
        logger.warn(
          {
            clerkUserId,
            userId: existing._id,
            conflictingUserId: conflictByOauthEmail._id,
            oauthEmailCount: newOauthEmails.length,
          },
          "OAuth e-post matcher en annen brukers primær-e-post under synk; beholder lokale oauthAccounts",
        );

        await recordSyncConflict(existing._id, {
          type: "oauth_link_rejected",
          melding:
            "OAuth-kontoen du koblet til har en e-postadresse som allerede er knyttet til en annen StudyWise-bruker. " +
            "Koblingen ble ikke lagret lokalt. Fjern koblingen i kontoinnstillingene, eller kontakt support.",
          clerkVerdi: newOauthEmails.join(", "),
        });

        const profileWithoutOauth: ClerkProfile = {
          ...syncProfile,
          oauthAccounts: existing.oauthAccounts ?? [],
        };
        // allow-deleted-users: `existing` er en validert User-doc oppe i flyten + clerkId-filter sikrer korrekt eier
        const updatedWithoutOauth = await User.findOneAndUpdate(
          { _id: existing._id, clerkId: clerkUserId },
          buildClerkProfileUpdate(profileWithoutOauth, syncedAt, {
            includeEmail: false,
            preserveNames: isPostRelinkSync,
            usernameAction: syncUsernameAction,
          }),
          { returnDocument: "after" },
        ).select("+canvasApiToken");
        return updatedWithoutOauth ?? existing;
      }
    }
  }

  try {
    // allow-deleted-users: `existing` er en validert User-doc oppe i flyten + clerkId-filter sikrer korrekt eier
    const updated = await User.findOneAndUpdate(
      { _id: existing._id, clerkId: clerkUserId },
      buildClerkProfileUpdate(syncProfile, syncedAt, {
        includeEmail: !isPostRelinkSync,
        preserveNames: isPostRelinkSync,
        usernameAction: syncUsernameAction,
      }),
      { returnDocument: "after" },
    ).select("+canvasApiToken");

    if (updated) {
      logger.info(
        {
          userId: updated._id,
          clerkUserId,
          emailChanged,
          usernameChanged,
          oauthAccountsChanged,
          firstNameChanged,
          lastNameChanged,
        },
        "Synkroniserte lokal brukerprofil fra Clerk",
      );
      return updated;
    }

    return existing;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // Hvis duplicate key er fra OAuth-indeksen, registrer en synkroniseringskonflikt
      // og synkroniser andre feltendringer (navn, e-post) uten oauthAccounts-endring.
      if (isOAuthAccountDuplicateKeyError(error) && oauthAccountsChanged) {
        logger.warn(
          { err: error, clerkUserId, userId: existing._id },
          "OAuth-konto-konflikt under Clerk-profilsynk; registrerer syncConflict og synkroniserer andre felt",
        );

        // Registrer synkroniseringskonflikt slik at frontend viser en advarsel.
        const conflictProvider = profile.oauthAccounts.find(
          (a) =>
            !existing.oauthAccounts?.some(
              (e) =>
                e.provider === a.provider &&
                e.providerAccountId === a.providerAccountId,
            ),
        );
        await recordSyncConflict(existing._id, {
          type: "oauth_link_rejected",
          melding:
            `${conflictProvider?.provider === "google" ? "Google" : "Microsoft"}-kontoen du koblet til i kontoinnstillingene ` +
            "er allerede knyttet til en annen StudyWise-bruker. Koblingen ble ikke lagret lokalt. " +
            "Fjern koblingen i kontoinnstillingene, eller kontakt support.",
          clerkVerdi: conflictProvider?.provider ?? "unknown",
        });

        try {
          const profileWithoutOauth: ClerkProfile = {
            ...syncProfile,
            oauthAccounts: existing.oauthAccounts ?? [],
          };
          const retryUpdate = buildClerkProfileUpdate(
            profileWithoutOauth,
            syncedAt,
            {
              includeEmail: !isPostRelinkSync,
              preserveNames: isPostRelinkSync,
              usernameAction: syncUsernameAction,
            },
          );
          const retried = await User.findOneAndUpdate(
            { _id: existing._id, clerkId: clerkUserId },
            retryUpdate,
            { returnDocument: "after" },
          ).select("+canvasApiToken");
          return retried ?? existing;
        } catch (retryError) {
          logger.warn(
            { err: retryError, clerkUserId, userId: existing._id },
            "Retry av Clerk-profilsynk uten oauthAccounts feilet også",
          );
        }
      } else {
        logger.warn(
          { err: error, clerkUserId, userId: existing._id },
          "Duplicate-key under Clerk-profilsynk; beholder eksisterende lokal profil",
        );
      }
      const latest = await User.findOne({ clerkId: clerkUserId, deletedAt: { $exists: false } }).select("+canvasApiToken");
      return latest ?? existing;
    }

    throw error;
  }
}

/**
 * Utfører selve profil-syncen fra Clerk til MongoDB. Parallelle kall for samme
 * bruker deler på én pågående sync-promise — nye kallere awaiter den istedenfor
 * å returnere `null`. Det lukker race-vinduet der `forceSync=true` ellers kunne
 * få stale Mongo-data fordi en bakgrunnssync fortsatt skrev til dokumentet.
 * Returnerer synket bruker, eller null hvis dataene ikke kunne hentes.
 */
function performExistingUserProfileSync(
  existing: IUser,
  clerkUserId: string,
): Promise<IUser | null> {
  const syncKey = existing._id.toString();
  const inFlight = existingUserProfileSyncs.get(syncKey);
  if (inFlight) {
    return inFlight;
  }
  const promise: Promise<IUser | null> = (async () => {
    try {
      const freshUser = await User.findById(existing._id);
      if (!freshUser || freshUser.deletedAt) return null;
      const profile = await getClerkProfile(clerkUserId);
      if (!profile) return null;
      return await syncExistingUserWithClerkProfile(
        freshUser,
        clerkUserId,
        profile,
      );
    } finally {
      existingUserProfileSyncs.delete(syncKey);
    }
  })();
  existingUserProfileSyncs.set(syncKey, promise);
  return promise;
}

/**
 * Køer asynkron profiloppdatering for eksisterende bruker. Hvis synk allerede pågår for denne brukeren, hoppes den over.
 */
function queueExistingUserProfileSync(
  existing: IUser,
  clerkUserId: string,
): void {
  void (async () => {
    const PROFILE_SYNC_TIMEOUT_MS = 15_000;
    try {
      const result = await Promise.race([
        performExistingUserProfileSync(existing, clerkUserId),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), PROFILE_SYNC_TIMEOUT_MS),
        ),
      ]);
      if (result === "timeout") {
        logger.warn(
          { clerkUserId, userId: existing._id, timeoutMs: PROFILE_SYNC_TIMEOUT_MS },
          "Bakgrunnssynk av Clerk-profil timet ut",
        );
      }
    } catch (err) {
      logger.warn(
        { err, clerkUserId, userId: existing._id },
        "Kunne ikke synkronisere eksisterende Clerk-profil",
      );
    }
  })();
}

/** Spesialresultat for kontokonflikt som ikke er en auth-feil. */
export interface AccountConflictResult {
  __accountConflict: true;
}

/** Spesialresultat når server-side Turnstile-verifisering mangler. */
export interface TurnstileRequiredResult {
  __turnstileRequired: true;
}

/** Spesialresultat for slettet bruker som prøver å logge inn. */
export interface UserDeletedResult {
  __userDeleted: true;
}

/** Spesialresultat for låst bruker (admin har sperret kontoen). */
export interface UserLockedResult {
  __userLocked: true;
  lockedAt: Date;
  lockedReason?: string;
}

/** Resultattype for brukernavn-konflikt. */
export type UsernameConflictResult = {
  __usernameConflict: true;
  username: string;
};

/** Felles union-type for alle mulige resultater fra findOrCreateUserByClerkId. */
type AuthFlowResult =
  | IUser
  | AccountConflictResult
  | TurnstileRequiredResult
  | UserDeletedResult
  | UserLockedResult
  | OAuthAccountConflictResult
  | OAuthMetadataMissingResult
  | UsernameConflictResult
  | null;

/** Typevakt for AccountConflictResult. */
export function isAccountConflict(result: AuthFlowResult): result is AccountConflictResult {
  return result !== null && typeof result === "object" && "__accountConflict" in result;
}

/** Typevakt for TurnstileRequiredResult. */
export function isTurnstileRequired(result: AuthFlowResult): result is TurnstileRequiredResult {
  return result !== null && typeof result === "object" && "__turnstileRequired" in result;
}

/** Typevakt for UserDeletedResult. */
export function isUserDeleted(result: AuthFlowResult): result is UserDeletedResult {
  return result !== null && typeof result === "object" && "__userDeleted" in result;
}

/** Typevakt for UserLockedResult. */
export function isUserLocked(result: AuthFlowResult): result is UserLockedResult {
  return result !== null && typeof result === "object" && "__userLocked" in result;
}

/** Typevakt for UsernameConflictResult. */
export function isUsernameConflict(result: AuthFlowResult): result is UsernameConflictResult {
  return result !== null && typeof result === "object" && "__usernameConflict" in result;
}

/**
 * Henter eller oppretter StudyWise-bruker for en Clerk user id.
 * Eksisterende brukere får lokal profil oppdatert fra Clerk med jevne mellomrom i bakgrunnen.
 * Ved e-postkonflikt med annen Clerk-konto avvises registrering.
 * Returnerer AccountConflictResult hvis e-posten allerede er i bruk av annen konto.
 * Returnerer OAuthAccountConflictResult hvis OAuth-kontoen allerede er koblet til en annen bruker.
 * Returnerer UsernameConflictResult hvis brukernavnet allerede er tatt.
 */
export async function findOrCreateUserByClerkId(
  clerkUserId: string,
  options?: {
    flowId?: string;
    forceSync?: boolean;
    authTurnstileCookie?: string;
    sessionId?: string;
    /** HTTP-request for IP/user-agent-logging ved ny brukeropprettelse (juridisk bevis). */
    req?: Request;
  },
): Promise<AuthFlowResult> {
  const fid = options?.flowId;
  const currentClerkEnv = getCurrentClerkEnv();
  const isDeletedByClerkId = await DeletedUserTombstone.exists({
    clerkId: clerkUserId,
  });
  if (isDeletedByClerkId) {
    logger.warn(
      { clerkUserId, flowId: fid },
      "authFlow: clerkId matches deleted tombstone — returning userDeleted",
    );
    return { __userDeleted: true };
  }

  // +canvasApiToken slik at GET /me kan gjenbruke bruker uten ekstra DB-kall
  const existing = await User.findOne({ clerkId: clerkUserId }).select(
    "+canvasApiToken",
  );
  if (existing) {
    if (existing.deletedAt) {
      logger.warn(
        { clerkUserId, userId: existing._id, flowId: fid },
        "authFlow: existing-by-clerkId is DELETED — returning userDeleted",
      );
      return { __userDeleted: true };
    }

    if (existing.lockedAt) {
      logger.warn(
        { clerkUserId, userId: existing._id, lockedAt: existing.lockedAt, flowId: fid },
        "authFlow: existing-by-clerkId is LOCKED — returning userLocked",
      );
      return {
        __userLocked: true,
        lockedAt: existing.lockedAt,
        lockedReason: existing.lockedReason,
      };
    }

    logger.info(
      {
        clerkUserId,
        userId: existing._id,
        flowId: fid,
      },
      "authFlow: found existing user by clerkId — returning existing",
    );

    if (currentClerkEnv !== "unknown" && existing.clerkEnv !== currentClerkEnv) {
      void User.updateOne(
        { _id: existing._id, clerkId: clerkUserId, deletedAt: { $exists: false } },
        { $set: { clerkEnv: currentClerkEnv } },
      ).catch((err) => {
        logger.warn(
          { err, clerkUserId, userId: existing._id, flowId: fid },
          "authFlow: kunne ikke backfille clerkEnv for eksisterende bruker",
        );
      });
    }

    // Sesjonsbasert Turnstile-gate: krev Turnstile-cookie for nye sesjoner (ikke tidligere verifiserte).
    // Sjekker ved HVER fersk sesjon, uavhengig av profilsync-intervall.
    // resolveSessionTurnstileVerification håndterer racen der parallelle requests
    // kappes om samme nonce — tapende request venter kort på at vinneren markerer sesjonen.
    // Hoppes helt over når turnstileEnabled=false (Clerk + ratelimit beskytter da).
    const sid = options?.sessionId;
    if (turnstileEnabled && isProd && !(await resolveSessionTurnstileVerification(sid, options?.authTurnstileCookie))) {
      logger.warn(
        { clerkUserId, userId: existing._id, flowId: fid, sid },
        "authFlow: sesjon mangler Turnstile-verifisering — blokkerer",
      );
      return { __turnstileRequired: true };
    }

    if (options?.forceSync) {
      // forceSync skal være synkron: /me (og andre kallesteder som sender
      // forceSync=true) forventer at lokal state faktisk er oppdatert fra
      // Clerk når responsen kommer tilbake. Uten await ville vi returnert
      // stale Mongo-data og frontend ville cachet det som "ferskt".
      const FORCE_SYNC_TIMEOUT_MS = 10_000;
      try {
        const syncResult = await Promise.race([
          performExistingUserProfileSync(existing, clerkUserId),
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), FORCE_SYNC_TIMEOUT_MS),
          ),
        ]);
        if (syncResult === "timeout") {
          logger.warn(
            { clerkUserId, userId: existing._id, timeoutMs: FORCE_SYNC_TIMEOUT_MS },
            "authFlow: forceSync timet ut — returnerer beste tilgjengelige bruker",
          );
        }
      } catch (err) {
        logger.warn(
          { err, clerkUserId, userId: existing._id, flowId: fid },
          "authFlow: forceSync feilet — returnerer beste tilgjengelige bruker",
        );
      }
      // Hent oppdatert bruker fra Mongo (performExistingUserProfileSync kan ha
      // gitt null hvis en parallell sync pågikk; da reflekterer ny findOne
      // uansett siste lagrede state når den syncen også er ferdig i DB).
      const refreshed = await User.findOne({
        clerkId: clerkUserId,
        deletedAt: { $exists: false },
      }).select("+canvasApiToken");
      return refreshed ?? existing;
    }

    if (shouldSyncExistingUserProfile(existing)) {
      queueExistingUserProfileSync(existing, clerkUserId);
    }
    return existing;
  }

  try {
    const profile = await getClerkProfile(clerkUserId);
    if (!profile) {
      logger.warn(
        { clerkUserId, flowId: fid },
        "authFlow: getClerkProfile returned null — aborting",
      );
      return null;
    }

    const { email, firstName, lastName, oauthAccounts } = profile;
    const clerkProfileSyncedAt = new Date();
    const usernameAction = await resolveUsernameSyncAction(profile.username);

    logger.info(
      {
        clerkUserId,
        email,
        username: profile.username,
        authProviders: profile.authProviders,
        oauthAccountCount: oauthAccounts.length,
        usernameAction: usernameAction.mode,
        flowId: fid,
      },
      "authFlow: Clerk profile fetched — proceeding with conflict checks",
    );

    const oauthProvider = profile.authProviders.find(
      (p): p is "google" | "microsoft" => p === "google" || p === "microsoft",
    );
    if (oauthProvider && oauthAccounts.length === 0) {
      logger.warn(
        { clerkUserId, authProviders: profile.authProviders },
        "OAuth-innlogging mangler providerAccountId fra Clerk; avviser for å unngå duplikatkonto",
      );
      return {
        __oauthMetadataMissing: true,
        provider: oauthProvider,
      };
    }

    // Sjekk om noen av OAuth-kontoene allerede er koblet til en annen bruker
    if (oauthAccounts.length > 0) {
      const oauthConflict = await checkOAuthAccountConflicts(
        oauthAccounts,
        null,
        clerkUserId,
      );
      if (oauthConflict) {
        // Kryssmiljø-sjekk: hvis den konfliktskapende brukerens clerkId ikke finnes
        // i denne Clerk-instansen (f.eks. dev vs. prod), re-link i stedet for å blokkere.
        const conflictingUser = await User.findOne({
          _id: oauthConflict.conflictingUserId,
          deletedAt: { $exists: false },
        }).select("clerkId clerkEnv");

        // Logg eksplisitt hver vei vi kan ende opp i blokkering — gjør debugging mulig
        if (!conflictingUser) {
          logger.warn(
            {
              clerkUserId,
              conflictingUserId: oauthConflict.conflictingUserId,
              flowId: fid,
            },
            "authFlow: OAuth conflict — konfliktskapende bruker ikke funnet (slettet?), kan ikke re-linke",
          );
        } else if (!conflictingUser.clerkId) {
          logger.warn(
            {
              clerkUserId,
              conflictingUserId: oauthConflict.conflictingUserId,
              flowId: fid,
            },
            "authFlow: OAuth conflict — konfliktskapende bruker mangler clerkId, kan ikke re-linke",
          );
        } else {
          const relinked = await attemptRelinkWhenPreviousClerkMissing({
            existingUser: conflictingUser,
            clerkUserId,
            profile,
            oauthAccounts,
            clerkEmail: email ?? undefined,
            flowId: fid,
            infoMessage:
              "authFlow: OAuth conflict — gammel clerkId finnes ikke i denne Clerk-instansen, re-linker bruker",
            warnMessage:
              "authFlow: OAuth conflict — re-link returnerte null (e-post-mismatch eller guard blokkert)",
            logFields: {
              conflictingUserId: oauthConflict.conflictingUserId,
            },
          });
          if (relinked) return relinked;

          const existsInClerk = await clerkUserExistsInCurrentInstance(conflictingUser.clerkId);
          if (existsInClerk) {
            logger.info(
              {
                clerkUserId,
                oldClerkId: conflictingUser.clerkId,
                conflictingUserId: oauthConflict.conflictingUserId,
                flowId: fid,
              },
              "authFlow: OAuth conflict — gammel clerkId finnes fortsatt i Clerk, blokkerer",
            );
          }
        }

        logger.warn(
          {
            clerkUserId,
            provider: oauthConflict.provider,
            conflictingUserId: oauthConflict.conflictingUserId,
            flowId: fid,
          },
          "authFlow: OAuth account conflict — blocking registration",
        );
        return oauthConflict;
      }
    }

    // Kryssvalidering: sjekk om ny brukers e-post matcher en eksisterende brukers OAuth-e-post
    // (f.eks. bruker A har primær-e-post X og linket Google med e-post Y; bruker B prøver å registrere med e-post Y)
    const existingByOAuthEmail = await User.findOne({
      "oauthAccounts.email": email,
      deletedAt: { $exists: false },
    }).select("_id clerkId clerkEnv");
    if (
      existingByOAuthEmail &&
      existingByOAuthEmail.clerkId !== clerkUserId
    ) {
      if (existingByOAuthEmail.clerkId) {
        const relinked = await attemptRelinkWhenPreviousClerkMissing({
          existingUser: existingByOAuthEmail,
          clerkUserId,
          profile,
          oauthAccounts,
          clerkEmail: email ?? undefined,
          flowId: fid,
          infoMessage: "authFlow: OAuth-email-konflikt — gammel clerkId finnes ikke, re-linker",
          warnMessage:
            "authFlow: OAuth-email-konflikt — re-link returnerte null (e-post-mismatch eller guard blokkert)",
        });
        if (relinked) return relinked;
      }
      logger.warn(
        {
          clerkUserId,
          email,
          conflictingUserId: existingByOAuthEmail._id.toString(),
          flowId: fid,
        },
        "authFlow: email matches existing user's OAuth email — blocking registration",
      );
      return { __accountConflict: true as const };
    }

    // Kryssvalidering: sjekk om ny brukers OAuth-e-poster matcher en eksisterende brukers primær-e-post
    // (f.eks. bruker A har primær-e-post Y; bruker B prøver å registrere med Google (e-post Y))
    const oauthEmails = oauthAccounts
      .map((a) => a.email)
      .filter((e): e is string => !!e);
    if (oauthEmails.length > 0) {
      const existingByPrimaryEmail = await User.findOne({
        email: { $in: oauthEmails },
        deletedAt: { $exists: false },
      }).select("_id clerkId clerkEnv");
      if (
        existingByPrimaryEmail &&
        existingByPrimaryEmail.clerkId !== clerkUserId
      ) {
        if (existingByPrimaryEmail.clerkId) {
          const relinked = await attemptRelinkWhenPreviousClerkMissing({
            existingUser: existingByPrimaryEmail,
            clerkUserId,
            profile,
            oauthAccounts,
            clerkEmail: email ?? undefined,
            flowId: fid,
            infoMessage: "authFlow: primær-email-konflikt — gammel clerkId finnes ikke, re-linker",
            warnMessage:
              "authFlow: primær-email-konflikt — re-link returnerte null (e-post-mismatch eller guard blokkert)",
          });
          if (relinked) return relinked;
        }
        logger.warn(
          {
            clerkUserId,
            oauthEmailCount: oauthEmails.length,
            conflictingUserId: existingByPrimaryEmail._id.toString(),
            flowId: fid,
          },
          "authFlow: OAuth email matches existing user's primary email — blocking registration",
        );
        return { __accountConflict: true as const };
      }

      // Kryssvalidering: ny brukers OAuth-emails mot eksisterende brukeres OAuth-emails
      const existingByOAuthEmailArray = await User.findOne({
        "oauthAccounts.email": { $in: oauthEmails },
        clerkId: { $ne: clerkUserId },
        deletedAt: { $exists: false },
      }).select("_id clerkId clerkEnv");
      if (existingByOAuthEmailArray) {
        if (existingByOAuthEmailArray.clerkId) {
          const relinked = await attemptRelinkWhenPreviousClerkMissing({
            existingUser: existingByOAuthEmailArray,
            clerkUserId,
            profile,
            oauthAccounts,
            clerkEmail: email ?? undefined,
            flowId: fid,
            infoMessage: "authFlow: OAuth-email-krysskonflikt — gammel clerkId finnes ikke, re-linker",
            warnMessage:
              "authFlow: OAuth-email-krysskonflikt — re-link returnerte null (e-post-mismatch eller guard blokkert)",
          });
          if (relinked) return relinked;
        }
        logger.warn(
          {
            clerkUserId,
            oauthEmailCount: oauthEmails.length,
            conflictingUserId: existingByOAuthEmailArray._id.toString(),
            flowId: fid,
          },
          "authFlow: OAuth email matches existing user's OAuth email — blocking registration",
        );
        return { __accountConflict: true as const };
      }
    }

    // Brukernavn allerede tatt – avvis registrering.
    // Frontend redirecter til sign-up med feilmelding slik at brukeren kan
    // velge et nytt brukernavn og registrere seg på nytt.
    if (usernameAction.mode === "keep" && "conflictingUserId" in usernameAction && profile.username) {
      // Race-condition-sjekk: et parallelt request kan ha opprettet brukeren allerede.
      // Hvis den konfliktskapende brukeren har samme clerkId, returner den i stedet for å blokkere.
      const conflictUser = await User.findOne({
        _id: usernameAction.conflictingUserId,
        deletedAt: { $exists: false },
      }).select("clerkId clerkEnv");
      if (conflictUser?.clerkId === clerkUserId) {
        logger.info(
          { clerkUserId, userId: usernameAction.conflictingUserId, flowId: fid },
          "authFlow: brukernavn-konflikt er med egen konto (parallelt request) — gjenbruker",
        );
        const existingUser = await User.findOne({
          _id: usernameAction.conflictingUserId,
          clerkId: clerkUserId,
          deletedAt: { $exists: false },
        }).select("+canvasApiToken");
        if (existingUser) return existingUser;
      }

      if (conflictUser?.clerkId) {
        const relinked = await attemptRelinkWhenPreviousClerkMissing({
          existingUser: conflictUser,
          clerkUserId,
          profile,
          oauthAccounts,
          clerkEmail: email ?? undefined,
          flowId: fid,
          infoMessage:
            "authFlow: username conflict — gammel clerkId finnes ikke i denne Clerk-instansen, re-linker for å bevare brukernavn",
          warnMessage:
            "authFlow: username conflict — re-link returnerte null (e-post-mismatch eller guard blokkert)",
          logFields: {
            conflictingUserId: usernameAction.conflictingUserId,
            username: profile.username,
          },
        });
        if (relinked) return relinked;

        const existsInClerk = await clerkUserExistsInCurrentInstance(conflictUser.clerkId);
        if (existsInClerk) {
          logger.info(
            {
              clerkUserId,
              oldClerkId: conflictUser.clerkId,
              conflictingUserId: usernameAction.conflictingUserId,
              username: profile.username,
              flowId: fid,
            },
            "authFlow: username conflict — gammel clerkId finnes fortsatt i Clerk, blokkerer",
          );
        }
      }

      logger.warn(
        {
          clerkUserId,
          username: profile.username,
          conflictingUserId: usernameAction.conflictingUserId,
          flowId: fid,
        },
        "authFlow: username conflict — blocking registration",
      );
      return {
        __usernameConflict: true,
        username: profile.username,
      };
    }

    const existingByEmail = await User.findOne({ email });
    logger.info(
      {
        clerkUserId,
        email,
        existingByEmailId: existingByEmail?._id?.toString() ?? null,
        existingByEmailClerkId: existingByEmail?.clerkId ?? null,
        existingByEmailDeleted: !!existingByEmail?.deletedAt,
        flowId: fid,
      },
      "authFlow: email lookup result",
    );
    if (existingByEmail) {
      if (existingByEmail.deletedAt) {
        // Slettet bruker har fortsatt original e-post (ufullstendig opprydding).
        // Anonymiser e-posten slik at ny bruker kan opprettes med samme e-post.
        // Bruk findOneAndUpdate med deletedAt-guard og timestamp i e-post for å unngå
        // race conditions og pattern-kollisjoner.
        const anonymizedEmail = `deleted-${existingByEmail._id.toString()}-${randomUUID()}@studywise.invalid`;
        const anonymized = await User.findOneAndUpdate(
          { _id: existingByEmail._id, deletedAt: { $exists: true } },
          {
            $set: { email: anonymizedEmail },
            $unset: {
              clerkId: 1,
              clerkEnv: 1,
              oauthAccounts: 1,
              authProviders: 1,
              username: 1,
              usernameNormalized: 1,
              firstName: 1,
              lastName: 1,
              canvasApiToken: 1,
              canvasTokenHash: 1,
              canvasBaseUrl: 1,
              role: 1,
              mfaEnabled: 1,
              backupCodesEnabled: 1,
            },
          },
        );
        if (!anonymized) {
          // Brukeren ble gjenopprettet av en annen request mellom findOne og update — avvis
          logger.warn(
            { clerkUserId, existingUserId: existingByEmail._id, flowId: fid },
            "authFlow: deleted user revived during email anonymization race — blocking",
          );
          return { __accountConflict: true as const };
        }
        logger.info(
          { clerkUserId, deletedUserId: existingByEmail._id },
          "Anonymiserte e-post for slettet bruker — tillater ny kontoopprettelse",
        );
        // Fall gjennom til brukeropprettelse nedenfor
      } else {
        if (
          existingByEmail.clerkId &&
          existingByEmail.clerkId !== clerkUserId
        ) {
          const relinked = await attemptRelinkWhenPreviousClerkMissing({
            existingUser: existingByEmail,
            clerkUserId,
            profile,
            oauthAccounts,
            clerkEmail: email ?? undefined,
            flowId: fid,
            infoMessage:
              "authFlow: email conflict — gammel clerkId finnes ikke i denne Clerk-instansen, re-linker bruker",
            warnMessage:
              "authFlow: email conflict — re-link returnerte null (e-post-mismatch eller guard blokkert)",
          });
          if (relinked) return relinked;

          // Samme e-post, annen Clerk-konto som finnes i denne instansen.
          // Brukeren må slette den eksisterende kontoen først, eller kontakte support.
          logger.warn(
            {
              clerkUserId,
              existingClerkId: existingByEmail.clerkId,
              userId: existingByEmail._id,
              flowId: fid,
            },
            "authFlow: email conflict — different clerkId owns this email — blocking",
          );
          return { __accountConflict: true as const };
        }

        // Sikkerhet: krev at clerkId allerede matcher — auto-linking av brukere
        // uten clerkId er fjernet for å forhindre kontoovertakelse via e-post.
        if (!existingByEmail.clerkId) {
          logger.warn(
            { clerkUserId, userId: existingByEmail._id, flowId: fid },
            "authFlow: refusing auto-link — existing user has no clerkId (legacy account)",
          );
          return { __accountConflict: true as const };
        }

        // allow-deleted-users: existingByEmail er validert som aktiv (deletedAt sjekket via findOne ovenfor); deletedAt-race håndteres eksplisitt nedenfor
        const linkedUser = await User.findOneAndUpdate(
          {
            _id: existingByEmail._id,
            clerkId: clerkUserId,
          },
          {
            $set: {
              clerkId: clerkUserId,
              clerkEnv: currentClerkEnv,
              firstName: firstName ?? existingByEmail.firstName,
              lastName: lastName ?? existingByEmail.lastName,
              clerkProfileSyncedAt,
              authProviders: profile.authProviders,
              mfaEnabled: profile.mfaEnabled,
              backupCodesEnabled: profile.backupCodesEnabled,
              ...(oauthAccounts.length > 0 ? { oauthAccounts } : {}),
              ...(usernameAction.mode === "set"
                ? { username: usernameAction.username, usernameNormalized: usernameAction.usernameNormalized }
                : {}),
            },
            ...(oauthAccounts.length === 0
              ? { $unset: { oauthAccounts: 1 } }
              : {}),
          },
          { returnDocument: "after" },
        ).select("+canvasApiToken");

        if (linkedUser?.deletedAt) {
          // Linket bruker ble slettet mellom findOne og findOneAndUpdate — rydd opp og opprett ny
          const anonymizedEmail = `deleted-${linkedUser._id.toString()}-${randomUUID()}@studywise.invalid`;
          const anonymizeResult = await User.updateOne(
            { _id: linkedUser._id, deletedAt: { $exists: true } },
            { $set: { email: anonymizedEmail }, $unset: { clerkId: 1, clerkEnv: 1 } },
          );
          if (anonymizeResult.modifiedCount === 0) {
            // Brukeren ble gjenopprettet (deletedAt fjernet) mellom sjekk og oppdatering — avbryt
            logger.warn(
              { clerkUserId, deletedUserId: linkedUser._id },
              "authFlow: slettet bruker ble gjenopprettet under anonymisering — returnerer conflict",
            );
            return { __accountConflict: true as const };
          }
          logger.info(
            { clerkUserId, deletedUserId: linkedUser._id },
            "Fjernet clerkId fra slettet bruker etter linking-race — faller gjennom til ny bruker",
          );
          // Fall gjennom til brukeropprettelse nedenfor
        } else if (linkedUser) {
          logger.info(
            { userId: linkedUser._id, clerkUserId },
            "Eksisterende bruker linket til Clerk",
          );
          return linkedUser;
        }
      }
    }

    // Gjeldende vilkår/personvern-versjon ved opprettelsestidspunktet — lagres
    // på brukeren som bevis for hva de samtykket til. Sign-up-siden viser
    // aksept-tekst og lenker til /vilkar + /personvern, så klikk på "Opprett
    // konto" = eksplisitt samtykke (by-action consent).
    const termsAcceptedAt = new Date();

    const buildCreateUserPayload = (includeUsername: boolean) => ({
      email,
      clerkId: clerkUserId,
      clerkEnv: currentClerkEnv,
      clerkProfileSyncedAt,
      role: DEFAULT_ROLE,
      firstName,
      lastName,
      authProviders: profile.authProviders,
      mfaEnabled: profile.mfaEnabled,
      backupCodesEnabled: profile.backupCodesEnabled,
      oauthAccounts: oauthAccounts.length > 0 ? oauthAccounts : undefined,
      termsAcceptedAt,
      termsVersionAccepted: TERMS_VERSION,
      ...(includeUsername && usernameAction.mode === "set"
        ? {
            username: usernameAction.username,
            usernameNormalized: usernameAction.usernameNormalized,
          }
        : {}),
    });

    // Server-side Turnstile-gate: krev gyldig Turnstile-cookie for nye brukerregistreringer i produksjon.
    // Forhindrer bot-registrering selv om Turnstile-widget-sjekken på klienten blir omgått.
    // resolveSessionTurnstileVerification håndterer både rask path (sesjon allerede verifisert)
    // og race-vinduet der parallelle requests kappes om samme nonce.
    // Hoppes helt over når turnstileEnabled=false (Clerk + ratelimit beskytter da).
    const newUserSid = options?.sessionId;
    if (turnstileEnabled && isProd && !(await resolveSessionTurnstileVerification(newUserSid, options?.authTurnstileCookie))) {
      logger.warn(
        { clerkUserId, email, flowId: fid },
        "authFlow: mangler gyldig Turnstile-cookie ved brukeropprettelse — blokkerer",
      );
      return { __turnstileRequired: true };
    }

    try {
      logger.info(
        { clerkUserId, email, username: profile.username, flowId: fid },
        "authFlow: attempting User.create()",
      );
      const user = await User.create(buildCreateUserPayload(true));
      logger.info(
        { clerkUserId, userId: user._id, email, flowId: fid },
        "authFlow: User.create() succeeded — new user created",
      );
      await recordUserCreated(user, clerkUserId, options?.req);

      // Rydd opp auto-satt SSO-brukernavn i Clerk (f.eks. Microsoft setter username = e-post).
      // Gjøres asynkront etter opprettelse — feiling blokkerer ikke brukeropplevelsen.
      if (profile.hadAutoSetSsoUsername) {
        void updateClerkUserProfile(clerkUserId, { username: "" }).catch(() => {
          logger.debug({ clerkUserId }, "Kunne ikke fjerne auto-satt Clerk-brukernavn");
        });
      }
      return user;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      logger.warn(
        {
          clerkUserId,
          email,
          flowId: fid,
          keyPattern: (error as { keyPattern?: unknown }).keyPattern,
        },
        "authFlow: duplicate key error caught during User.create()",
      );

      // Sjekk om duplikatfeilen er for OAuth-konto (strengt - avvis registrering)
      if (isOAuthAccountDuplicateKeyError(error)) {
        const oauthConflict = await checkOAuthAccountConflicts(
          oauthAccounts,
          null,
          clerkUserId,
        );
        if (oauthConflict) {
          logger.warn(
            {
              clerkUserId,
              provider: oauthConflict.provider,
              conflictingUserId: oauthConflict.conflictingUserId,
              flowId: fid,
            },
            "authFlow: OAuth conflict via duplicate key error",
          );
          return oauthConflict;
        }
      }

      if (isUsernameDuplicateKeyError(error) && usernameAction.mode === "set") {
        logger.warn(
          { clerkUserId, username: usernameAction.username, flowId: fid },
          "authFlow: username conflict via duplicate key error",
        );
        return {
          __usernameConflict: true,
          username: usernameAction.username,
        };
      }

      if (usernameAction.mode === "set") {
        const conflictingUsernameUser = await User.findOne({
          usernameNormalized: usernameAction.usernameNormalized,
          clerkId: { $ne: clerkUserId },
          deletedAt: { $exists: false },
        }).select("_id");

        if (conflictingUsernameUser) {
          logger.warn(
            {
              clerkUserId,
              username: usernameAction.username,
              conflictingUserId: conflictingUsernameUser._id,
              flowId: fid,
            },
            "authFlow: concurrent username conflict",
          );
          return {
            __usernameConflict: true,
            username: usernameAction.username,
          };
        }
      }

      const concurrentUser = await User.findOne({
        $or: [{ clerkId: clerkUserId }, { email }],
      }).select("+canvasApiToken");

      if (concurrentUser?.deletedAt) {
        logger.warn(
          { clerkUserId, userId: concurrentUser._id, flowId: fid },
          "authFlow: race hit deleted user — rejecting",
        );
        return { __userDeleted: true };
      }

      if (concurrentUser?.clerkId && concurrentUser.clerkId !== clerkUserId) {
        const relinked = await attemptRelinkWhenPreviousClerkMissing({
          existingUser: concurrentUser,
          clerkUserId,
          profile,
          oauthAccounts,
          clerkEmail: email ?? undefined,
          flowId: fid,
          infoMessage: "authFlow: duplikatnøkkel-race — gammel clerkId finnes ikke, re-linker",
          warnMessage:
            "authFlow: duplikatnøkkel-race — re-link returnerte null (e-post-mismatch eller guard blokkert)",
        });
        if (relinked) return relinked;

        logger.warn(
          {
            clerkUserId,
            userId: concurrentUser._id,
            existingClerkId: concurrentUser.clerkId,
            flowId: fid,
          },
          "authFlow: duplicate-key recovery found user with different clerkId",
        );
        return { __accountConflict: true as const };
      }

      if (concurrentUser && concurrentUser.clerkId !== clerkUserId) {
        logger.warn(
          { clerkUserId, userId: concurrentUser._id, flowId: fid },
          "authFlow: duplicate-key recovery found legacy/unlinked user — blocking reuse",
        );
        return { __accountConflict: true as const };
      }

      if (concurrentUser) {
        logger.info(
          { userId: concurrentUser._id, clerkUserId, flowId: fid },
          "authFlow: reusing user after duplicate-key race",
        );
        return concurrentUser;
      }

      throw error;
    }
  } catch (err) {
    logger.error(
      { err, clerkUserId, flowId: fid },
      "authFlow: FAILED to sync Clerk user to MongoDB",
    );
    return null;
  }
}

/**
 * Oppdaterer brukerprofil i Clerk (firstName, lastName, username).
 * Returnerer true ved suksess.
 */
export async function updateClerkUserProfile(
  clerkUserId: string,
  updates: { firstName?: string; lastName?: string; username?: string },
): Promise<boolean> {
  const clerk = getClerkBackendClient();
  if (!clerk) {
    logger.warn("Clerk backend client ikke tilgjengelig for profiloppdatering");
    return false;
  }

  try {
    await clerk.users.updateUser(clerkUserId, updates);
    return true;
  } catch (error) {
    logger.error(
      { err: error, clerkUserId },
      "Kunne ikke oppdatere Clerk-brukerprofil",
    );
    return false;
  }
}

/**
 * Sletter bruker i Clerk. Returnerer true ved suksess eller hvis bruker allerede er borte (404).
 */
export async function deleteClerkUserById(
  clerkUserId: string,
): Promise<boolean> {
  const clerk = getClerkBackendClient();
  if (!clerk) {
    return false;
  }

  try {
    await clerk.users.deleteUser(clerkUserId);
    return true;
  } catch (error) {
    // Clerk SDK v3+: sjekk status direkte (konsistent med clerkUserExistsInCurrentInstance)
    if (isClerkAPIResponseError(error) && error.status === 404) {
      return true;
    }
    // Fallback: string-matching for eldre SDK-versjoner eller uventede feiltyper
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();
    if (message.includes("404") || message.includes("not found") || message.includes("resource_not_found")) {
      return true;
    }
    logger.error({ err: error, clerkUserId }, "Kunne ikke slette Clerk-bruker");
    return false;
  }
}

/**
 * Henter tillatte frontend-origins for Clerk token (authorizedParties).
 * Caches ved første kall — WEB_ORIGINS endres ikke under kjøretid.
 */
let cachedAuthorizedParties: string[] | undefined | null = null;
function getAuthorizedParties(): string[] | undefined {
  if (cachedAuthorizedParties !== null) return cachedAuthorizedParties;
  const list = getConfiguredWebOrigins();
  cachedAuthorizedParties = list.length > 0 ? list : undefined;
  return cachedAuthorizedParties;
}

/**
 * In-memory cache for verifiserte Clerk-tokens.
 * Kort TTL (30s) — samme token brukes gjentatte ganger av browseren i rask rekkefølge.
 * Maks 500 entries for å begrense minnebruk.
 * Token hashes (SHA256) som nøkler for å unngå lagring av sensitive tokens i klartext.
 */
const TOKEN_CACHE_TTL_MS = 30_000;
const TOKEN_CACHE_MAX = 200;
/**
 * Stale-token-grace ved Clerk-utfall: hvor lenge etter token-exp vi godtar en
 * tidligere verifisert cache-entry hvis verifyToken feiler med upstream-feil.
 * 30 minutter dekker en typisk Clerk-blip uten å gi en betydelig sikkerhets-
 * vindu for revoked/expired tokens. Tombstone-sjekkene (isClerkIdDeleted,
 * isSessionDeleted) kjører fortsatt på stale-godtaket.
 */
const TOKEN_STALE_GRACE_MS = 30 * 60 * 1000;
export type ClerkFactorVerificationAge = [firstFactorAge: number, secondFactorAge: number];
type ClerkTokenCacheEntry = {
  sub: string;
  sid?: string;
  exp: number;
  fva?: ClerkFactorVerificationAge;
};
const tokenCache = new Map<string, ClerkTokenCacheEntry>();

/**
 * Klassifiserer en Clerk-verifyToken-feil som upstream (Clerk er nede / nettverk)
 * vs. token-spesifikk (token er ugyldig/utløpt). Brukes til å avgjøre om vi kan
 * akseptere en stale cache-entry midlertidig.
 *
 * @clerk/backend kaster `TokenVerificationError` for token-spesifikke feil
 * (TokenInvalid, TokenExpired, TokenSignatureInvalid osv.). Alt annet — typisk
 * fetch-feil mot JWKS-endepunktet eller `clerk.sessions.getSession()` —
 * behandles som upstream. Vi feiler aldri til "upstream" på en
 * TokenVerificationError, slik at ugyldige tokens IKKE blir akseptert som stale.
 */
function isUpstreamClerkFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  if (typeof name === "string" && name === "TokenVerificationError") {
    return false;
  }
  return true;
}

function parseFactorVerificationAge(payload: { fva?: unknown }): ClerkFactorVerificationAge | undefined {
  const fva = payload.fva;
  if (!Array.isArray(fva) || fva.length < 2) return undefined;
  const [firstFactorAge, secondFactorAge] = fva;
  if (
    typeof firstFactorAge !== "number" ||
    typeof secondFactorAge !== "number" ||
    !Number.isFinite(firstFactorAge) ||
    !Number.isFinite(secondFactorAge)
  ) {
    return undefined;
  }
  return [firstFactorAge, secondFactorAge];
}

/**
 * Sesjonsbasert Turnstile-verifisering: holder styr på Clerk-sesjoner (sid)
 * som har bestått Turnstile-sjekk. Forhindrer at en fersk sesjon bruker API
 * uten å ha passert human-check, uavhengig av profilsync-intervall.
 *
 * Bruker Redis for deling mellom dynos, med lokal Map som fallback
 * og read-through cache for å redusere Redis-kall.
 *
 * TTL er 24 timer — samsvarer med typisk Clerk-sesjonsvarighet.
 * Ved logout fjernes sesjonen fra Redis (markSessionDeleted), slik at
 * Turnstile-verifiseringen automatisk invalideres sammen med sesjonen.
 * Ved utløp av Clerk-sesjon krever backend ny autentisering uansett.
 */
const TURNSTILE_VERIFIED_SESSION_TTL_S = 86400; // 24 timer — koblet til sesjonslivssyklus via logout-invalidering
const TURNSTILE_SESSION_PREFIX = "auth:turnstile-session:";

// Lokal in-memory cache: brukes som read-through for Redis (unngår Redis-kall per request)
const turnstileLocalCache = new Map<string, number>();

/**
 * Marker en Clerk-sesjon som Turnstile-verifisert.
 * Returnerer Promise slik at kalleren kan awaite Redis-skrivingen
 * for cross-dyno konsistens (forhindrer race mellom parallelle kall på ulike dynos).
 */
export async function markSessionTurnstileVerified(sid: string): Promise<void> {
  const expiry = Date.now() + TURNSTILE_VERIFIED_SESSION_TTL_S * 1000;
  turnstileLocalCache.set(sid, expiry);
  // Rydd opp utløpte entries periodisk
  if (turnstileLocalCache.size > 500) {
    const now = Date.now();
    for (const [key, exp] of turnstileLocalCache) {
      if (exp <= now) turnstileLocalCache.delete(key);
    }
  }
  // Skriv til Redis synkront slik at andre dynos ser verifiseringen umiddelbart
  try {
    await setCache(`${TURNSTILE_SESSION_PREFIX}${sid}`, "1", TURNSTILE_VERIFIED_SESSION_TTL_S);
  } catch {
    // Ikke-kritisk — lokal cache fungerer som fallback for denne dynoen
  }
}

/** Sjekk om en Clerk-sesjon allerede er Turnstile-verifisert. */
export async function isSessionTurnstileVerified(sid: string | undefined): Promise<boolean> {
  if (!sid) return false;
  // Sjekk lokal cache først (rask path)
  const localExp = turnstileLocalCache.get(sid);
  if (localExp) {
    if (localExp > Date.now()) return true;
    turnstileLocalCache.delete(sid);
  }
  // Fallback: sjekk Redis (cross-dyno)
  try {
    const val = await getCache(`${TURNSTILE_SESSION_PREFIX}${sid}`);
    if (val !== null) {
      // Populer lokal cache for fremtidige kall
      turnstileLocalCache.set(sid, Date.now() + TURNSTILE_VERIFIED_SESSION_TTL_S * 1000);
      return true;
    }
  } catch {
    // Redis nede — lokal cache har allerede svart negativt
  }
  return false;
}

/**
 * Resolver Turnstile-verifisering for en fersk Clerk-sesjon med race-toleranse.
 *
 * Flyt:
 *  1. Rask path: sesjonen er allerede markert verifisert → returner true.
 *  2. Forsøk å konsumere nonce atomisk (SET NX) → marker sesjonen og returner true.
 *  3. Nonce allerede forbrukt av parallell request: poll sesjonsstatus kort
 *     (opp til ~200 ms) mens vinneren fullfører sin markSessionTurnstileVerified.
 *     Dette dekker race-vinduet mellom nonce-konsum og sesjonsmarkering.
 *
 * Uten steg 3 vil parallelle kall (f.eks. frontend som fyrer /me + /canvas samtidig
 * rett etter sso-callback) treffe 403 "turnstile_required" selv om brukeren har
 * en gyldig cookie — bare én request vinner kappløpet om noncen.
 */
const TURNSTILE_RACE_POLL_INTERVAL_MS = 25;
const TURNSTILE_RACE_POLL_MAX_ATTEMPTS = 8; // ~200 ms total
export async function resolveSessionTurnstileVerification(
  sid: string | undefined,
  authTurnstileCookie: string | undefined,
): Promise<boolean> {
  if (await isSessionTurnstileVerified(sid)) return true;

  if (await isValidAuthTurnstileCookieValue(authTurnstileCookie)) {
    if (sid) await markSessionTurnstileVerified(sid);
    return true;
  }

  // Nonce var allerede konsumert — en parallell request vant kappløpet.
  // Poll sesjonsstatus kort slik at vi ikke 403-er tapende request i vinduet
  // mellom nonce-konsum og markSessionTurnstileVerified.
  if (!sid) return false;
  for (let i = 0; i < TURNSTILE_RACE_POLL_MAX_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, TURNSTILE_RACE_POLL_INTERVAL_MS));
    if (await isSessionTurnstileVerified(sid)) return true;
  }
  return false;
}

/** Hasher token med SHA256 for sikker cache-nøkkel. */
const hashToken = hashSha256;

function resolveTokenCacheExpiry(payload: { exp?: unknown }): number {
  const now = Date.now();
  const localExpiry = now + TOKEN_CACHE_TTL_MS;
  const jwtExpiry =
    typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;

  if (!jwtExpiry) return localExpiry;
  return Math.min(localExpiry, jwtExpiry);
}

function pruneTokenCache(): void {
  // Fjern utløpte entries først
  const now = Date.now();
  for (const [key, entry] of tokenCache) {
    if (entry.exp <= now) tokenCache.delete(key);
  }
  // Håndhev maks-grense: fjern entries med tidligst utløp først
  if (tokenCache.size > TOKEN_CACHE_MAX) {
    const keysToDelete = tokenCache.size - TOKEN_CACHE_MAX;
    const sorted = [...tokenCache.entries()].sort((a, b) => a[1].exp - b[1].exp);
    for (let i = 0; i < keysToDelete && i < sorted.length; i++) {
      tokenCache.delete(sorted[i][0]);
    }
  }
}

/**
 * Fjerner alle cached tokens for en gitt clerkId.
 * Kalles ved kontosletting slik at slettede brukere ikke kan bruke cached tokens i opptil 30s.
 * Nøklene er nå token-hashes, men vi itererer på entry.sub som fortsatt er clerkId.
 */
/** Henter Clerk session ID (sid) fra token-cachen (etter at getClerkUserIdFromToken har verifisert). */
export function getSessionIdFromTokenCache(bearerToken: string): string | undefined {
  const tokenHash = hashToken(bearerToken);
  const cached = tokenCache.get(tokenHash);
  return cached?.sid;
}

/** Henter Clerk `fva` (factor verification age) fra token-cachen etter token-verifisering. */
export function getFactorVerificationAgeFromTokenCache(
  bearerToken: string,
): ClerkFactorVerificationAge | undefined {
  const tokenHash = hashToken(bearerToken);
  const cached = tokenCache.get(tokenHash);
  return cached?.fva;
}

/**
 * Invalider token-cache for en spesifikk sesjon (brukes ved logout).
 * Invaliderer kun gjeldende sesjon — andre faner/enheter forblir upåvirket.
 */
export function invalidateTokenCacheBySession(clerkId: string, sessionId?: string): void {
  for (const [tokenHash, entry] of tokenCache) {
    if (entry.sub === clerkId && (!sessionId || entry.sid === sessionId)) {
      tokenCache.delete(tokenHash);
    }
  }
  // Marker sesjonen som slettet i Redis slik at andre dynos også avviser den
  if (sessionId) {
    void markSessionDeleted(sessionId);
  }
}

/**
 * Invalider token-cache for ALLE sesjoner tilhørende en clerkId (brukes ved kontosletting).
 * Blokkerer alle tokens for brukeren på tvers av dynos.
 */
export function invalidateTokenCacheByClerkId(clerkId: string): void {
  for (const [tokenHash, entry] of tokenCache) {
    if (entry.sub === clerkId) tokenCache.delete(tokenHash);
  }
  // Marker clerkId som slettet i Redis slik at andre dynos også avviser tokenet
  void markClerkIdDeleted(clerkId);
}

/** Redis-nøkkel-prefix for slettede clerkIds (cross-dyno invalidering ved kontosletting). */
const DELETED_CLERK_PREFIX = "auth:deleted-clerk:";
/** Redis-nøkkel-prefix for slettede sesjoner (cross-dyno invalidering ved logout). */
const DELETED_SESSION_PREFIX = "auth:deleted-session:";
/** TTL for slettet-markør: litt lengre enn token-cache TTL for sikker dekning. */
const DELETED_CLERK_TTL_S = 60;

async function markClerkIdDeleted(clerkId: string): Promise<void> {
  try {
    await setCache(`${DELETED_CLERK_PREFIX}${clerkId}`, "1", DELETED_CLERK_TTL_S);
  } catch {
    // Ikke-kritisk — lokal cache er allerede invalidert
  }
}

async function markSessionDeleted(sessionId: string): Promise<void> {
  try {
    await setCache(`${DELETED_SESSION_PREFIX}${sessionId}`, "1", DELETED_CLERK_TTL_S);
  } catch {
    // Ikke-kritisk — lokal cache er allerede invalidert
  }
}

async function isClerkIdDeleted(clerkId: string): Promise<boolean> {
  try {
    const val = await getCache(`${DELETED_CLERK_PREFIX}${clerkId}`);
    return val !== null;
  } catch (err) {
    // Fail-open: lokal dyno har allerede fjernet token fra tokenCache ved sletting.
    // Redis-sjekk er sekundær mekanisme for andre dynos (maks 30s vindu).
    logger.warn({ err, clerkId }, "Redis-feil ved sjekk av slettet clerkId — fail-open");
    return false;
  }
}

async function isSessionDeleted(sessionId: string | undefined): Promise<boolean> {
  if (!sessionId) return false;
  try {
    const val = await getCache(`${DELETED_SESSION_PREFIX}${sessionId}`);
    return val !== null;
  } catch (err) {
    logger.warn({ err, sessionId }, "Redis-feil ved sjekk av slettet sesjon — fail-open");
    return false;
  }
}

/**
 * Verifiserer Clerk session-token og returnerer Clerk user id (sub) ved suksess.
 * Bruker authorizedParties når WEB_ORIGINS er satt.
 * Cacher resultatet i minnet i 30 sekunder for å unngå gjentatte JWKS-kall.
 */
/**
 * Henter opprettelsestidspunkt for Clerk-sesjonen via Backend API.
 * Bruker `sessions.getSession(sid)` som returnerer autoritativt `createdAt`-tidspunkt
 * for når brukeren faktisk logget inn (ikke token-fornyelse).
 * Returnerer Unix-tidsstempel i sekunder, eller null hvis sesjon ikke kan hentes autoritativt.
 *
 * Brukes av step-up-auth for sensitive operasjoner (kontosletting) — MÅ derfor være
 * fail-closed. JWT `iat` fornyes ved token-refresh og kan ikke brukes som proxy for
 * "nylig autentisert", selv ikke som fallback.
 */
export async function getClerkSessionCreatedAt(
  bearerToken: string,
): Promise<number | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    const authorizedParties = getAuthorizedParties();
    const payload = await verifyToken(bearerToken, {
      secretKey,
      ...(authorizedParties && authorizedParties.length > 0
        ? { authorizedParties }
        : {}),
    });
    const sid = typeof payload.sid === "string" ? payload.sid : null;
    if (!sid) return null;

    const clerk = getClerkBackendClient();
    if (!clerk) return null;

    const session = await clerk.sessions.getSession(sid);
    if (session?.createdAt) {
      return Math.floor(session.createdAt / 1000);
    }

    return null;
  } catch {
    return null;
  }
}

export async function getClerkUserIdFromToken(
  bearerToken: string,
): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  // Hash token for sikker cache-nøkkel (unngår å lagre sensitive tokens i klartext)
  const tokenHash = hashToken(bearerToken);

  // Sjekk cache først
  const cached = tokenCache.get(tokenHash);
  if (cached) {
    if (cached.exp >= Date.now()) {
      // Cross-dyno sjekk: avvis token hvis clerkId er slettet (kontosletting) eller sesjon er slettet (logout)
      // Parallelle Redis-oppslag for bedre ytelse i auth-hot-path
      const [clerkDeleted, sessionDeleted] = await Promise.all([
        isClerkIdDeleted(cached.sub),
        isSessionDeleted(cached.sid),
      ]);
      if (clerkDeleted || sessionDeleted) {
        tokenCache.delete(tokenHash);
        return null;
      }
      return cached.sub;
    }
    // Behold expired cache-entry til den er forbi stale-grace-vinduet —
    // brukes som fallback hvis verifyToken feiler med upstream-feil under en
    // Clerk-outage. Når grace-vinduet er over, slett.
    if (Date.now() - cached.exp >= TOKEN_STALE_GRACE_MS) {
      tokenCache.delete(tokenHash);
    }
  }

  try {
    const authorizedParties = getAuthorizedParties();
    const payload = await verifyToken(bearerToken, {
      secretKey,
      ...(authorizedParties && authorizedParties.length > 0
        ? { authorizedParties }
        : {}),
    });
    const sub = payload.sub;
    if (typeof sub !== "string") return null;

    const sid = typeof payload.sid === "string" ? payload.sid : undefined;

    // Cross-dyno sjekk: avvis token hvis clerkId er slettet (kontosletting) eller sesjon er slettet (logout)
    // Parallelle Redis-oppslag for bedre ytelse i auth-hot-path
    const [clerkDeleted2, sessionDeleted2] = await Promise.all([
      isClerkIdDeleted(sub),
      isSessionDeleted(sid),
    ]);
    if (clerkDeleted2 || sessionDeleted2) return null;

    // Cache aldri lengre enn tokenets faktiske utløpstid.
    tokenCache.set(tokenHash, {
      sub,
      sid,
      fva: parseFactorVerificationAge(payload),
      exp: resolveTokenCacheExpiry(payload),
    });
    pruneTokenCache();

    return sub;
  } catch (err) {
    // Stale-token-toleranse ved Clerk-utfall: hvis verifyToken feilet med en
    // upstream-feil (nettverk/5xx mot JWKS, ikke en TokenVerificationError),
    // og vi har en nylig verifisert cache-entry innenfor stale-grace-vinduet,
    // godta den midlertidig så brukeren ikke blir kastet ut under en kort
    // Clerk-blip. Tombstone-sjekkene kjører fortsatt — slettede kontoer/
    // sesjoner blir aldri akseptert som stale.
    if (isUpstreamClerkFailure(err) && cached && Date.now() - cached.exp < TOKEN_STALE_GRACE_MS) {
      const [clerkDeleted3, sessionDeleted3] = await Promise.all([
        isClerkIdDeleted(cached.sub),
        isSessionDeleted(cached.sid),
      ]);
      if (!clerkDeleted3 && !sessionDeleted3) {
        logger.warn(
          {
            sub: cached.sub,
            expiredMinutes: Math.floor((Date.now() - cached.exp) / 60_000),
          },
          "Clerk-verifisering feilet med upstream-feil — godtar stale token midlertidig",
        );
        return cached.sub;
      }
    }
    return null;
  }
}
