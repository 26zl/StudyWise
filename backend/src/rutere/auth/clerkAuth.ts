/**
 * Synkroniserer Clerk-brukere til MongoDB User.
 * Finner eller oppretter bruker på clerkId og oppdaterer lokal profil fra Clerk ved behov.
 */
import { createClerkClient, verifyToken } from "@clerk/backend";
import { User } from "../../database/models/User.js";
import { logger } from "../../utils/logger.js";
import { audit, AUDIT_ACTIONS } from "../../utils/auditLog.js";
import type { UserRole } from "common/auth";
import type { IUser } from "../../database/models/User.js";
import { getConfiguredWebOrigins } from "../../utils/webOrigins.js";

/** Standard rolle for nye brukere. */
const DEFAULT_ROLE: UserRole = "user";

/** Minste intervall (ms) mellom profiloppdateringer fra Clerk for samme bruker (5 min). */
const CLERK_PROFILE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** Holder styr på brukere som allerede har en synk i gang, for å unngå duplikat-kø. */
const existingUserProfileSyncs = new Set<string>();

/** Profilfelter hentet fra Clerk som synkroniseres til lokal User. */
type ClerkProfile = {
  email: string;
  firstName?: string;
  lastName?: string;
};

// Clerk backend client brukes for å hente brukerinfo og sjekke helse, ikke for auth-verifisering – det gjøres med verifyToken() direkte i getClerkUserIdFromToken() for å unngå overhead ved å opprette klient i auth-flow.
function getClerkBackendClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    logger.warn("CLERK_SECRET_KEY mangler – kan ikke bruke Clerk Backend API");
    return null;
  }
  return createClerkClient({ secretKey });
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

/** Normaliserer e-post til lowercase og trim; returnerer null ved tom/manglende. */
function normalizeEmail(email: string | undefined): string | null {
  if (!email) {
    return null;
  }

  const normalized = email.toLowerCase().trim();
  return normalized.length > 0 ? normalized : null;
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

  return {
    email,
    firstName: clerkUser.firstName ?? undefined,
    lastName: clerkUser.lastName ?? undefined,
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

  return (
    Date.now() - user.clerkProfileSyncedAt.getTime() >=
    CLERK_PROFILE_SYNC_INTERVAL_MS
  );
}

/** Bygger MongoDB $set/$unset-objekt for å oppdatere User med Clerk-profil; includeEmail=false brukes ved e-postkonflikt. */
function buildClerkProfileUpdate(
  profile: ClerkProfile,
  syncedAt: Date,
  includeEmail = true,
) {
  const setFields: Record<string, unknown> = {
    clerkProfileSyncedAt: syncedAt,
  };
  const unsetFields: Record<string, 1> = {};

  if (includeEmail) {
    setFields.email = profile.email;
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
 * Oppdaterer eksisterende User med Clerk-profil. Ved e-postkonflikt (annen bruker har samme e-post) oppdateres ikke e-post.
 * Ved duplicate key (race) returneres siste lagrede bruker.
 */
async function syncExistingUserWithClerkProfile(
  existing: IUser,
  clerkUserId: string,
  profile: ClerkProfile,
): Promise<IUser> {
  const syncedAt = new Date();
  const emailChanged = existing.email !== profile.email;
  const firstNameChanged =
    (existing.firstName ?? undefined) !== profile.firstName;
  const lastNameChanged = (existing.lastName ?? undefined) !== profile.lastName;

  if (!emailChanged && !firstNameChanged && !lastNameChanged) {
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
    });

    if (conflictingUser) {
      logger.warn(
        {
          clerkUserId,
          userId: existing._id,
          conflictingUserId: conflictingUser._id,
          currentEmail: existing.email,
          requestedEmail: profile.email,
        },
        "Kunne ikke oppdatere lokal e-post fra Clerk fordi adressen allerede er i bruk",
      );

      const updatedWithoutEmail = await User.findByIdAndUpdate(
        existing._id,
        buildClerkProfileUpdate(profile, syncedAt, false),
        { returnDocument: "after" },
      );
      return updatedWithoutEmail ?? existing;
    }
  }

  try {
    const updated = await User.findOneAndUpdate(
      { _id: existing._id, clerkId: clerkUserId },
      buildClerkProfileUpdate(profile, syncedAt),
      { returnDocument: "after" },
    );

    if (updated) {
      logger.info(
        {
          userId: updated._id,
          clerkUserId,
          emailChanged,
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
      logger.warn(
        { err: error, clerkUserId, userId: existing._id, email: profile.email },
        "Duplicate-key under Clerk-profilsynk; beholder eksisterende lokal profil",
      );
      const latest = await User.findOne({ clerkId: clerkUserId });
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
    try {
      const profile = await getClerkProfile(clerkUserId);
      if (!profile) {
        return;
      }

      await syncExistingUserWithClerkProfile(existing, clerkUserId, profile);
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

/**
 * Henter eller oppretter StudyWise-bruker for en Clerk user id.
 * Eksisterende brukere får lokal profil oppdatert fra Clerk med jevne mellomrom i bakgrunnen.
 */
export async function findOrCreateUserByClerkId(
  clerkUserId: string,
): Promise<IUser | null> {
  // +canvasApiToken slik at GET /me kan gjenbruke bruker uten ekstra DB-kall
  const existing = await User.findOne({ clerkId: clerkUserId }).select("+canvasApiToken");
  if (existing) {
    if (existing.deletedAt) {
      logger.warn(
        { clerkUserId, userId: existing._id },
        "Avviser innlogging for slettet StudyWise-bruker",
      );
      return null;
    }

    if (!shouldSyncExistingUserProfile(existing)) {
      return existing;
    }

    queueExistingUserProfileSync(existing, clerkUserId);
    return existing;
  }

  try {
    const profile = await getClerkProfile(clerkUserId);
    if (!profile) return null;

    const { email, firstName, lastName } = profile;
    const clerkProfileSyncedAt = new Date();

    const existingByEmail = await User.findOne({ email });
    if (existingByEmail) {
      if (existingByEmail.deletedAt) {
        logger.warn(
          { clerkUserId, userId: existingByEmail._id, email },
          "Avviser innlogging fordi e-post tilhører slettet StudyWise-bruker",
        );
        return null;
      }

      if (existingByEmail.clerkId && existingByEmail.clerkId !== clerkUserId) {
        logger.warn(
          {
            clerkUserId,
            userId: existingByEmail._id,
            email,
            existingClerkId: existingByEmail.clerkId,
          },
          "Kunne ikke linke Clerk-bruker fordi e-post allerede er knyttet til annen Clerk-konto",
        );
        return null;
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
          },
        },
        { returnDocument: "after" },
      );

      if (linkedUser?.deletedAt) {
        logger.warn(
          { clerkUserId, userId: linkedUser._id, email },
          "Linket bruker er slettet og kan ikke gjenopprettes automatisk",
        );
        return null;
      }

      if (linkedUser) {
        logger.info(
          { userId: linkedUser._id, clerkUserId, email },
          "Eksisterende bruker linket til Clerk",
        );
        return linkedUser;
      }
    }

    try {
      const user = await User.create({
        email,
        clerkId: clerkUserId,
        clerkProfileSyncedAt,
        role: DEFAULT_ROLE,
        firstName,
        lastName,
      });
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
      return user;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const concurrentUser = await User.findOne({
        $or: [{ clerkId: clerkUserId }, { email }],
      });

      if (concurrentUser?.deletedAt) {
        logger.warn(
          { clerkUserId, userId: concurrentUser._id, email },
          "Race-condition traff slettet bruker; avviser automatisk gjenoppretting",
        );
        return null;
      }

      if (concurrentUser?.clerkId && concurrentUser.clerkId !== clerkUserId) {
        logger.warn(
          {
            clerkUserId,
            userId: concurrentUser._id,
            email,
            existingClerkId: concurrentUser.clerkId,
          },
          "Duplicate-key recovery fant bruker knyttet til annen Clerk-konto; avviser",
        );
        return null;
      }

      if (concurrentUser) {
        logger.info(
          { userId: concurrentUser._id, clerkUserId, email },
          "Gjenbruker bruker etter duplicate-key race",
        );
        return concurrentUser;
      }

      throw error;
    }
  } catch (err) {
    logger.error(
      { err, clerkUserId },
      "Kunne ikke synce Clerk-bruker til MongoDB",
    );
    return null;
  }
}

/**
 * Sletter bruker i Clerk. Returnerer true ved suksess eller hvis bruker allerede er borte (404).
 */
export async function deleteClerkUserById(clerkUserId: string): Promise<boolean> {
  const clerk = getClerkBackendClient();
  if (!clerk) {
    return false;
  }

  try {
    await clerk.users.deleteUser(clerkUserId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
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
 */
const TOKEN_CACHE_TTL_MS = 30_000;
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, { sub: string; exp: number }>();

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
 * Verifiserer Clerk session-token og returnerer Clerk user id (sub) ved suksess.
 * Bruker authorizedParties når WEB_ORIGINS er satt.
 * Cacher resultatet i minnet i 30 sekunder for å unngå gjentatte JWKS-kall.
 */
export async function getClerkUserIdFromToken(bearerToken: string): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  // Sjekk cache først
  const cached = tokenCache.get(bearerToken);
  if (cached) {
    if (cached.exp > Date.now()) return cached.sub;
    tokenCache.delete(bearerToken);
  }

  try {
    const authorizedParties = getAuthorizedParties();
    const payload = await verifyToken(bearerToken, {
      secretKey,
      ...(authorizedParties && authorizedParties.length > 0 ? { authorizedParties } : {}),
    });
    const sub = payload?.sub;
    if (typeof sub !== "string") return null;

    // Cache verifisert token
    tokenCache.set(bearerToken, { sub, exp: Date.now() + TOKEN_CACHE_TTL_MS });
    pruneTokenCache();

    return sub;
  } catch {
    return null;
  }
}
