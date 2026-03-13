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

const DEFAULT_ROLE: UserRole = "user";
const CLERK_PROFILE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

type ClerkProfile = {
  email: string;
  firstName?: string;
  lastName?: string;
};

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

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

function normalizeEmail(email: string | undefined): string | null {
  if (!email) {
    return null;
  }

  const normalized = email.toLowerCase().trim();
  return normalized.length > 0 ? normalized : null;
}

async function getClerkProfile(clerkUserId: string): Promise<ClerkProfile | null> {
  const clerk = getClerkBackendClient();
  if (!clerk) {
    return null;
  }

  const clerkUser = await clerk.users.getUser(clerkUserId);
  if (!clerkUser) {
    return null;
  }

  const primaryEmail = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId);
  const email = normalizeEmail(primaryEmail?.emailAddress);
  if (!email) {
    logger.warn({ clerkUserId }, "Clerk-bruker mangler primær e-postadresse og kan ikke synkroniseres");
    return null;
  }

  return {
    email,
    firstName: clerkUser.firstName ?? undefined,
    lastName: clerkUser.lastName ?? undefined,
  };
}

function shouldSyncExistingUserProfile(user: IUser): boolean {
  if (!user.clerkId) {
    return false;
  }

  if (!user.clerkProfileSyncedAt) {
    return true;
  }

  return Date.now() - user.clerkProfileSyncedAt.getTime() >= CLERK_PROFILE_SYNC_INTERVAL_MS;
}

function buildClerkProfileUpdate(profile: ClerkProfile, syncedAt: Date, includeEmail = true) {
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

async function syncExistingUserWithClerkProfile(
  existing: IUser,
  clerkUserId: string,
  profile: ClerkProfile,
): Promise<IUser> {
  const syncedAt = new Date();
  const emailChanged = existing.email !== profile.email;
  const firstNameChanged = (existing.firstName ?? undefined) !== profile.firstName;
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
 * Henter eller oppretter StudyWise-bruker for en Clerk user id.
 * Eksisterende brukere får lokal profil oppdatert fra Clerk med jevne mellomrom.
 */
export async function findOrCreateUserByClerkId(clerkUserId: string): Promise<IUser | null> {
  const existing = await User.findOne({ clerkId: clerkUserId });
  if (existing) {
    if (existing.deletedAt) {
      logger.warn({ clerkUserId, userId: existing._id }, "Avviser innlogging for slettet StudyWise-bruker");
      return null;
    }

    if (!shouldSyncExistingUserProfile(existing)) {
      return existing;
    }

    try {
      const profile = await getClerkProfile(clerkUserId);
      if (!profile) {
        return existing;
      }
      return await syncExistingUserWithClerkProfile(existing, clerkUserId, profile);
    } catch (err) {
      logger.warn({ err, clerkUserId, userId: existing._id }, "Kunne ikke synkronisere eksisterende Clerk-profil");
      return existing;
    }
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
          { clerkUserId, userId: existingByEmail._id, email, existingClerkId: existingByEmail.clerkId },
          "Kunne ikke linke Clerk-bruker fordi e-post allerede er knyttet til annen Clerk-konto",
        );
        return null;
      }

      const linkedUser = await User.findOneAndUpdate(
        {
          _id: existingByEmail._id,
          $or: [{ clerkId: { $exists: false } }, { clerkId: null }, { clerkId: clerkUserId }],
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
        logger.info({ userId: linkedUser._id, clerkUserId, email }, "Eksisterende bruker linket til Clerk");
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
      logger.info({ userId: user._id, clerkId: clerkUserId }, "Clerk-bruker opprettet i MongoDB");
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
          { clerkUserId, userId: concurrentUser._id, email, existingClerkId: concurrentUser.clerkId },
          "Duplicate-key recovery fant bruker knyttet til annen Clerk-konto; avviser",
        );
        return null;
      }

      if (concurrentUser) {
        logger.info({ userId: concurrentUser._id, clerkUserId, email }, "Gjenbruker bruker etter duplicate-key race");
        return concurrentUser;
      }

      throw error;
    }
  } catch (err) {
    logger.error({ err, clerkUserId }, "Kunne ikke synce Clerk-bruker til MongoDB");
    return null;
  }
}

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
 * Reduserer risiko for subdomain cookie-lekkasje.
 */
function getAuthorizedParties(): string[] | undefined {
  const list = getConfiguredWebOrigins();
  return list.length > 0 ? list : undefined;
}

/**
 * Verifiserer Clerk session-token og returnerer Clerk user id (sub) ved suksess.
 * Bruker authorizedParties når WEB_ORIGINS er satt.
 */
export async function getClerkUserIdFromToken(bearerToken: string): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    const authorizedParties = getAuthorizedParties();
    const payload = await verifyToken(bearerToken, {
      secretKey,
      ...(authorizedParties && authorizedParties.length > 0 ? { authorizedParties } : {}),
    });
    const sub = payload?.sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}
