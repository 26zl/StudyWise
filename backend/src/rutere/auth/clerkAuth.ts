/**
 * Synkroniserer Clerk-brukere til MongoDB User.
 * Finner eller oppretter bruker på clerkId og oppdaterer lokal profil fra Clerk ved behov.
 */
import { createClerkClient, verifyToken } from "@clerk/backend";
import { hashSha256 } from "../../utils/cryptoUtils.js";
import { User } from "../../database/models/User.js";
import { DeletedUserTombstone } from "../../database/models/DeletedUserTombstone.js";
import { logger } from "../../utils/logger.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import {
  DEFAULT_ROLE,
  type AuthProvider,
  type OAuthAccount,
  type OAuthProvider,
  type SyncConflictType,
} from "common/auth";
import type { IUser } from "../../database/models/User.js";
import { getConfiguredWebOrigins } from "../../utils/webOrigins.js";
import { sanitizeUsername } from "../../database/models/User.js";

/** Minste intervall (ms) mellom profiloppdateringer fra Clerk for samme bruker (5 min). */
const CLERK_PROFILE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Holder styr på brukere som allerede har en synk i gang, for å unngå duplikat-kø. */
const existingUserProfileSyncs = new Set<string>();

/** Profilfelter hentet fra Clerk som synkroniseres til lokal User. */
type ClerkProfile = {
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  authProvider?: AuthProvider;
  /** OAuth-kontoer fra Clerk (provider + providerAccountId). */
  oauthAccounts: OAuthAccount[];
};

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

/** Sjekker om feilen er MongoDB duplicate key (E11000). */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
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
export function isOAuthAccountConflict(
  result:
    | IUser
    | AccountConflictResult
    | UserDeletedResult
    | OAuthAccountConflictResult
    | OAuthMetadataMissingResult
    | UsernameConflictResult
    | null,
): result is OAuthAccountConflictResult {
  return (
    result !== null &&
    typeof result === "object" &&
    "__oauthAccountConflict" in result
  );
}

/** Typevakt for OAuthMetadataMissingResult. */
export function isOAuthMetadataMissing(
  result:
    | IUser
    | AccountConflictResult
    | UserDeletedResult
    | OAuthAccountConflictResult
    | OAuthMetadataMissingResult
    | UsernameConflictResult
    | null,
): result is OAuthMetadataMissingResult {
  return (
    result !== null &&
    typeof result === "object" &&
    "__oauthMetadataMissing" in result
  );
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
          "Asynkron opprydding av stale OAuth-identiteter i tombstones fullfort",
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
          "Asynkron opprydding av stale brukernavn i tombstones fullfort",
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
  | { mode: "keep"; conflictingUserId: string };

async function resolveUsernameSyncAction(
  username: string | undefined,
  excludeUserId?: IUser["_id"] | null,
): Promise<UsernameSyncAction> {
  const sanitized = sanitizeUsername(username);
  if (!sanitized) {
    return { mode: "unset" };
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
  });
}

/** Henter e-post og navn fra Clerk Backend API for en bruker. Returnerer null ved feil eller manglende primær e-post. */
async function getClerkProfile(
  clerkUserId: string,
): Promise<ClerkProfile | null> {
  const clerk = getClerkBackendClient();
  if (!clerk) {
    return null;
  }

  const clerkUser = await clerk.users.getUser(clerkUserId);
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

  // Bestem innloggingsmetode og samle OAuth-kontoer fra Clerk external accounts
  let authProvider: AuthProvider | undefined;
  const oauthAccounts: OAuthAccount[] = [];
  const externalAccounts = clerkUser.externalAccounts ?? [];

  for (const account of externalAccounts) {
    const rawProvider = account.provider?.toLowerCase() ?? "";
    let mappedProvider: OAuthProvider | null = null;

    if (rawProvider.includes("google") || rawProvider === "oauth_google") {
      mappedProvider = "google";
      if (!authProvider) authProvider = "google";
    } else if (
      rawProvider.includes("microsoft") ||
      rawProvider === "oauth_microsoft"
    ) {
      mappedProvider = "microsoft";
      if (!authProvider) authProvider = "microsoft";
    }

    // Lagre OAuth-konto med providerAccountId og e-post for å forhindre at samme konto brukes på flere brukere
    if (mappedProvider && account.providerUserId) {
      const oauthEmail = (account as unknown as Record<string, unknown>).emailAddress;
      const hasValidEmail = typeof oauthEmail === "string" && oauthEmail.includes("@");
      if (!hasValidEmail) {
        logger.warn(
          { provider: mappedProvider, clerkUserId },
          "OAuth-konto fra Clerk mangler e-postadresse — kryssvalidering av e-post vil ikke fungere for denne kontoen",
        );
      }
      oauthAccounts.push({
        provider: mappedProvider,
        providerAccountId: account.providerUserId,
        ...(hasValidEmail
          ? { email: (oauthEmail as string).toLowerCase().trim() }
          : {}),
      });
    }
  }

  if (!authProvider) {
    authProvider = "email";
  }

  return {
    email,
    username: clerkUser.username ?? undefined,
    firstName: clerkUser.firstName ?? undefined,
    lastName: clerkUser.lastName ?? undefined,
    authProvider,
    oauthAccounts,
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
    usernameAction: UsernameSyncAction;
  },
) {
  const { includeEmail = true, usernameAction } = options;
  const setFields: Record<string, unknown> = {
    clerkProfileSyncedAt: syncedAt,
  };
  const unsetFields: Record<string, 1> = {};

  if (includeEmail) {
    setFields.email = profile.email;
  }

  if (profile.authProvider) {
    setFields.authProvider = profile.authProvider;
  }

  if (profile.oauthAccounts.length > 0) {
    setFields.oauthAccounts = profile.oauthAccounts;
  } else {
    unsetFields.oauthAccounts = 1;
  }

  if (usernameAction.mode === "set") {
    setFields.username = usernameAction.username;
    setFields.usernameNormalized = usernameAction.usernameNormalized;
  } else if (usernameAction.mode === "unset") {
    unsetFields.username = 1;
    unsetFields.usernameNormalized = 1;
  }

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

  // Atomisk: fjern eksisterende konflikt av samme type og legg til ny i én operasjon
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
  );

  logger.warn(
    {
      userId,
      conflictType: conflict.type,
      clerkVerdi: conflict.clerkVerdi,
      lokalVerdi: conflict.lokalVerdi,
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
    logger.info(
      {
        clerkUserId,
        userId: existing._id,
        conflictingUserId: usernameAction.conflictingUserId,
      },
      "Droppet Clerk-brukernavn fordi det allerede er i bruk",
    );
  }

  if (
    !emailChanged &&
    !usernameChanged &&
    !firstNameChanged &&
    !lastNameChanged &&
    !oauthAccountsChanged
  ) {
    const updated = await User.findByIdAndUpdate(
      existing._id,
      { $set: { clerkProfileSyncedAt: syncedAt } },
      { returnDocument: "after" },
    );
    return updated ?? existing;
  }

  if (emailChanged) {
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

      const updatedWithoutEmail = await User.findByIdAndUpdate(
        existing._id,
        buildClerkProfileUpdate(profile, syncedAt, {
          includeEmail: false,
          usernameAction,
        }),
        { returnDocument: "after" },
      );
      return updatedWithoutEmail ?? existing;
    }
  }

  try {
    const updated = await User.findOneAndUpdate(
      { _id: existing._id, clerkId: clerkUserId },
      buildClerkProfileUpdate(profile, syncedAt, {
        usernameAction,
      }),
      { returnDocument: "after" },
    );

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
            ...profile,
            oauthAccounts: existing.oauthAccounts ?? [],
          };
          const retryUpdate = buildClerkProfileUpdate(
            profileWithoutOauth,
            syncedAt,
            {
              usernameAction,
            },
          );
          const retried = await User.findOneAndUpdate(
            { _id: existing._id, clerkId: clerkUserId },
            retryUpdate,
            { returnDocument: "after" },
          );
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
      const latest = await User.findOne({ clerkId: clerkUserId, deletedAt: { $exists: false } });
      return latest ?? existing;
    }

    throw error;
  }
}

/**
 * Køer asynkron profiloppdatering for eksisterende bruker. Hvis synk allerede pågår for denne brukeren, hoppes den over.
 */
function queueExistingUserProfileSync(
  existing: IUser,
  clerkUserId: string,
): void {
  const syncKey = existing._id.toString();
  if (existingUserProfileSyncs.has(syncKey)) {
    return;
  }

  existingUserProfileSyncs.add(syncKey);

  void (async () => {
    const PROFILE_SYNC_TIMEOUT_MS = 15_000;
    try {
      const result = await Promise.race([
        (async () => {
          const profile = await getClerkProfile(clerkUserId);
          if (!profile) return;
          await syncExistingUserWithClerkProfile(existing, clerkUserId, profile);
        })(),
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
    } finally {
      existingUserProfileSyncs.delete(syncKey);
    }
  })();
}

/** Spesialresultat for kontokonflikt som ikke er en auth-feil. */
export interface AccountConflictResult {
  __accountConflict: true;
}

/** Spesialresultat for slettet bruker som prøver å logge inn. */
export interface UserDeletedResult {
  __userDeleted: true;
}

/** Resultattype for brukernavn-konflikt. */
export type UsernameConflictResult = {
  __usernameConflict: true;
  username: string;
};

/** Typevakt for AccountConflictResult. */
export function isAccountConflict(
  result:
    | IUser
    | AccountConflictResult
    | UserDeletedResult
    | OAuthAccountConflictResult
    | OAuthMetadataMissingResult
    | UsernameConflictResult
    | null,
): result is AccountConflictResult {
  return (
    result !== null &&
    typeof result === "object" &&
    "__accountConflict" in result
  );
}

/** Typevakt for UserDeletedResult. */
export function isUserDeleted(
  result:
    | IUser
    | AccountConflictResult
    | UserDeletedResult
    | OAuthAccountConflictResult
    | OAuthMetadataMissingResult
    | UsernameConflictResult
    | null,
): result is UserDeletedResult {
  return (
    result !== null && typeof result === "object" && "__userDeleted" in result
  );
}

/** Typevakt for UsernameConflictResult. */
export function isUsernameConflict(
  result:
    | IUser
    | AccountConflictResult
    | UserDeletedResult
    | OAuthAccountConflictResult
    | OAuthMetadataMissingResult
    | UsernameConflictResult
    | null,
): result is UsernameConflictResult {
  return (
    result !== null &&
    typeof result === "object" &&
    "__usernameConflict" in result
  );
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
  options?: { flowId?: string; forceSync?: boolean },
): Promise<
  | IUser
  | AccountConflictResult
  | UserDeletedResult
  | OAuthAccountConflictResult
  | OAuthMetadataMissingResult
  | UsernameConflictResult
  | null
> {
  const fid = options?.flowId;
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

    logger.info(
      {
        clerkUserId,
        userId: existing._id,
        flowId: fid,
      },
      "authFlow: found existing user by clerkId — returning existing",
    );

    if (!options?.forceSync && !shouldSyncExistingUserProfile(existing)) {
      return existing;
    }

    queueExistingUserProfileSync(existing, clerkUserId);
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
        authProvider: profile.authProvider,
        oauthAccountCount: oauthAccounts.length,
        usernameAction: usernameAction.mode,
        flowId: fid,
      },
      "authFlow: Clerk profile fetched — proceeding with conflict checks",
    );

    if (
      (profile.authProvider === "google" ||
        profile.authProvider === "microsoft") &&
      oauthAccounts.length === 0
    ) {
      logger.warn(
        { clerkUserId, authProvider: profile.authProvider },
        "OAuth-innlogging mangler providerAccountId fra Clerk; avviser for å unngå duplikatkonto",
      );
      return {
        __oauthMetadataMissing: true,
        provider: profile.authProvider,
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
    }).select("_id clerkId");
    if (
      existingByOAuthEmail &&
      existingByOAuthEmail.clerkId !== clerkUserId
    ) {
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
      }).select("_id clerkId");
      if (
        existingByPrimaryEmail &&
        existingByPrimaryEmail.clerkId !== clerkUserId
      ) {
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
      }).select("_id clerkId");
      if (existingByOAuthEmailArray) {
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
    // Frontend viser en resolver-dialog der brukeren velger nytt brukernavn i Clerk,
    // deretter re-henter /me som kjører findOrCreateUserByClerkId på nytt.
    if (usernameAction.mode === "keep" && profile.username) {
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
        const anonymizedEmail = `deleted-${existingByEmail._id.toString()}-${Date.now()}@studywise.invalid`;
        const anonymized = await User.findOneAndUpdate(
          { _id: existingByEmail._id, deletedAt: { $exists: true } },
          {
            $set: { email: anonymizedEmail },
            $unset: {
              clerkId: 1,
              oauthAccounts: 1,
              authProvider: 1,
              username: 1,
              usernameNormalized: 1,
              firstName: 1,
              lastName: 1,
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
          // Samme e-post, annen Clerk-konto. Automatisk re-linking er fjernet
          // fordi det er en usikker antakelse at "samme verifiserte e-post = samme person".
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

        const linkedUser = await User.findOneAndUpdate(
          {
            _id: existingByEmail._id,
            $or: [
              { clerkId: { $exists: false } },
              { clerkId: null },
              { clerkId: clerkUserId },
            ],
          },
          {
            $set: {
              clerkId: clerkUserId,
              firstName: firstName ?? existingByEmail.firstName,
              lastName: lastName ?? existingByEmail.lastName,
              clerkProfileSyncedAt,
              authProvider: profile.authProvider,
              ...(oauthAccounts.length > 0 ? { oauthAccounts } : {}),
            },
            ...(oauthAccounts.length === 0
              ? { $unset: { oauthAccounts: 1 } }
              : {}),
          },
          { returnDocument: "after" },
        ).select("+canvasApiToken");

        if (linkedUser?.deletedAt) {
          // Linket bruker ble slettet mellom findOne og findOneAndUpdate — rydd opp og opprett ny
          const anonymizedEmail = `deleted-${linkedUser._id.toString()}-${Date.now()}@studywise.invalid`;
          const anonymizeResult = await User.updateOne(
            { _id: linkedUser._id, deletedAt: { $exists: true } },
            { $set: { email: anonymizedEmail }, $unset: { clerkId: 1 } },
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

    const buildCreateUserPayload = (includeUsername: boolean) => ({
      email,
      clerkId: clerkUserId,
      clerkProfileSyncedAt,
      role: DEFAULT_ROLE,
      firstName,
      lastName,
      authProvider: profile.authProvider,
      oauthAccounts: oauthAccounts.length > 0 ? oauthAccounts : undefined,
      ...(includeUsername && usernameAction.mode === "set"
        ? {
            username: usernameAction.username,
            usernameNormalized: usernameAction.usernameNormalized,
          }
        : {}),
    });

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
      await recordUserCreated(user, clerkUserId);
      return user;
    } catch (error) {
      let duplicateError = error;
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

      if (concurrentUser) {
        logger.info(
          { userId: concurrentUser._id, clerkUserId, flowId: fid },
          "authFlow: reusing user after duplicate-key race",
        );
        return concurrentUser;
      }

      throw duplicateError;
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
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : String(error).toLowerCase();
    if (message.includes("404") || message.includes("not found")) {
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
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, { sub: string; exp: number }>();

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
  // Håndhev maks-grense: fjern eldste entries til vi er innenfor grensen
  if (tokenCache.size > TOKEN_CACHE_MAX) {
    const keysToDelete = tokenCache.size - TOKEN_CACHE_MAX;
    let deleted = 0;
    for (const key of tokenCache.keys()) {
      if (deleted >= keysToDelete) break;
      tokenCache.delete(key);
      deleted++;
    }
  }
}

/**
 * Fjerner alle cached tokens for en gitt clerkId.
 * Kalles ved kontosletting slik at slettede brukere ikke kan bruke cached tokens i opptil 30s.
 * Nøklene er nå token-hashes, men vi itererer på entry.sub som fortsatt er clerkId.
 */
export function invalidateTokenCacheByClerkId(clerkId: string): void {
  for (const [tokenHash, entry] of tokenCache) {
    if (entry.sub === clerkId) tokenCache.delete(tokenHash);
  }
}

/**
 * Verifiserer Clerk session-token og returnerer Clerk user id (sub) ved suksess.
 * Bruker authorizedParties når WEB_ORIGINS er satt.
 * Cacher resultatet i minnet i 30 sekunder for å unngå gjentatte JWKS-kall.
 */
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
    if (cached.exp >= Date.now()) return cached.sub;
    tokenCache.delete(tokenHash);
  }

  try {
    const authorizedParties = getAuthorizedParties();
    const payload = await verifyToken(bearerToken, {
      secretKey,
      ...(authorizedParties && authorizedParties.length > 0
        ? { authorizedParties }
        : {}),
    });
    const sub = payload?.sub;
    if (typeof sub !== "string") return null;

    // Cache aldri lengre enn tokenets faktiske utløpstid.
    tokenCache.set(tokenHash, {
      sub,
      exp: resolveTokenCacheExpiry(payload),
    });
    pruneTokenCache();

    return sub;
  } catch {
    return null;
  }
}
