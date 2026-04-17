/*
 * Bruker-API: Clerk-only auth. Ruter er beskyttet av global requireAuth.
 * GET /me, PUT /preferences, POST/DELETE /token, POST /logout.
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import { User, type IUser } from "../../database/models/User.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { decrypt, encrypt } from "../../utils/kryptering.js";
import { logger } from "../../utils/logger.js";
import { ZodError } from "zod";
import { hashSha256, timingSafeHexEqual } from "../../utils/cryptoUtils.js";
import { apiError, requireUserId, sendError, sendZodError, sendUnknownError } from "../../utils/apiError.js";
import { warmCanvasCache, fetchUserProfile } from "../canvas/canvasService.js";
import { invalidateCacheByPattern } from "../../cache/redis.js";
import {
  clearUserCanvasRuntimeState,
  invalidateUserCanvasCache,
  triggerInitialSync,
} from "../../services/canvas-sync.service.js";
import {
  CanvasTokenRequestSchema,
  CanvasTokenResponseSchema,
  CanvasContextPreferencesSchema,
  UIPreferencesSchema,
  PreferencesUpdateSchema,
  PreferencesResponseSchema,
  AccountDeletionResponseSchema,
  AuthBrukerSchema,
  MeResponseSchema,
  LogoutResponseSchema,
  SyncConflictRemovedResponseSchema,
  ProfileUpdateResponseSchema,
  ProfileUpdateWithUsernameSchema,
  UsernameCheckQuerySchema,
  UsernameCheckResponseSchema,
  SYNC_CONFLICT_TYPES,
  createDefaultCanvasContextPreferences,
  createDefaultManuellInnleveringState,
  createDefaultVarslerState,
  normalizeManuellInnleveringState,
  normalizeVarslerState,
  normalizeHiddenCourseIds,
} from "common/auth";
import { sanitizeUsername } from "../../database/models/User.js";
import {
  createDefaultBrowserPushPreferences,
  normalizeBrowserPushPreferences,
  DeleteWebPushSubscriptionRequestSchema,
  SaveWebPushSubscriptionRequestSchema,
  SendTestWebPushResponseSchema,
  WebPushClientConfigResponseSchema,
  WebPushSubscriptionResponseSchema,
} from "common/notifications";
import {
  rateLimitToken,
  rateLimitMe,
  rateLimitAccountDeletion,
  rateLimitUsernameCheck,
  createRateLimiter,
} from "../../middleware/rate-limit.js";
import { noCache } from "../../middleware/no-cache.js";
import { requireRecentAuth } from "../../middleware/auth.js";
import {
  audit,
  AUDIT_ACTIONS,
  anonymizeAuditTrailForDeletedUser,
  getDeletedAuditActorId,
} from "../../utils/auditLog.js";
import { deleteAccountData } from "./kontoSlett.js";
import type { CanvasApiError } from "../canvas/canvasErrors.js";
import {
  buildCanvasUserPayload,
  isMongoDuplicateKeyError,
} from "../../utils/canvasUserSync.js";
import {
  isWebPushConfigured,
  getWebPushClientConfig,
  sendTestWebPush,
  removeWebPushSubscription,
  upsertWebPushSubscription,
  WebPushSubscriptionConflictError,
  WebPushDeliveryUnavailableError,
} from "../../services/webPush.service.js";
import { clerkUserExistsInCurrentInstance } from "./clerkAuth.js";
import { getCurrentClerkEnv } from "./relinkGuard.js";
import { isProd } from "../../utils/env.js";

const router = Router();

// Strengere rate limit for force-relink av Canvas-konto (maks 3 per time per bruker)
const rateLimitForceRelink = createRateLimiter({
  points: 3,
  duration: 3600,
  keyPrefix: "rlflx:force-relink",
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "unknown",
});

type CanvasTokenConflictType = "token" | "account";

class CanvasTokenConflictError extends Error {
  conflictType: CanvasTokenConflictType;

  constructor(conflictType: CanvasTokenConflictType) {
    super(
      conflictType === "token"
        ? "Dette Canvas-tokenet er allerede koblet til en annen bruker. Hvis dette er din konto, kan du bruke 'Gjenopprett tilkobling' for å flytte den hit."
        : "Denne Canvas-kontoen er allerede koblet til en annen StudyWise-bruker. Hvis dette er din konto, kan du bruke 'Gjenopprett tilkobling' for å flytte den hit.",
    );
    this.name = "CanvasTokenConflictError";
    this.conflictType = conflictType;
  }
}

// Ikke cache auth-responser i browser eller mellomlagring
router.use(noCache);

// Hash funksjon for tokens — bruker delt utility fra cryptoUtils
const hashToken = hashSha256;

function handleCanvasVerificationError(res: Response, error: unknown) {
  const canvasError = error as Partial<CanvasApiError>;

  if (canvasError?.name === "CanvasApiError" && canvasError.code) {
    switch (canvasError.code) {
      case "token_invalid":
        return apiError.badRequest(
          res,
          "Ugyldig Canvas-token",
          "Canvas-tokenet ble avvist av den valgte institusjonen. Sjekk at tokenet er riktig og at du har valgt korrekt Canvas-instans.",
        );
      case "permission_denied":
        return apiError.badRequest(
          res,
          "Canvas-konto kunne ikke verifiseres",
          "Canvas-tokenet og institusjonen stemmer ikke overens, eller tokenet mangler nødvendig tilgang. Sjekk at URL og token hører sammen.",
        );
      case "timeout":
        return apiError.timeout(
          res,
          "Canvas-instansen brukte for lang tid på å svare. Sjekk at institusjonen er riktig og prøv igjen.",
        );
      case "network_error":
      case "server_error":
      case "unknown":
        return sendError(res, "service_unavailable", {
          melding:
            "Kunne ikke kontakte den valgte Canvas-instansen. Sjekk at institusjonen er riktig og prøv igjen.",
        });
      default:
        break;
    }
  }

  if (error instanceof Error) {
    const lowerMessage = error.message.toLowerCase();
    if (
      lowerMessage.includes("fetch") ||
      lowerMessage.includes("network") ||
      lowerMessage.includes("enotfound") ||
      lowerMessage.includes("getaddrinfo")
    ) {
      return sendError(res, "service_unavailable", {
        melding:
          "Kunne ikke kontakte den valgte Canvas-instansen. Sjekk at institusjonen er riktig og prøv igjen.",
      });
    }
    if (lowerMessage.includes("timeout")) {
      return apiError.timeout(
        res,
        "Canvas-instansen brukte for lang tid på å svare. Sjekk at institusjonen er riktig og prøv igjen.",
      );
    }
  }

  return apiError.badRequest(
    res,
    "Canvas-konto kunne ikke verifiseres",
    "Sjekk at du har valgt riktig Canvas-institusjon og at tokenet fortsatt er gyldig.",
  );
}

function sendCanvasConflictResponse(
  res: Response,
  conflictType: CanvasTokenConflictType,
) {
  const error = new CanvasTokenConflictError(conflictType);
  return res.status(409).json(
    CanvasTokenResponseSchema.parse({
      feil: "Canvas-konto konflikt",
      melding: error.message,
      canvasKonflikt: true,
    }),
  );
}

/** Invalider Redis Canvas-cache for et (kryptert) token. Brukes ved token-sletting eller -bytte. */
async function invalidateCanvasCacheForToken(
  encryptedToken: string | undefined,
): Promise<void> {
  if (!encryptedToken) return;
  try {
    const gammeltToken = decrypt(encryptedToken);
    const prefix = crypto
      .createHash("sha256")
      .update(gammeltToken)
      .digest("hex")
      .slice(0, 12);
    await invalidateCacheByPattern(`canvas:*:${prefix}:*`).catch((err) => {
      logger.debug({ err }, "Cache-invalidering feilet (ikke-kritisk)");
    });
  } catch {
    // Ignorer dekrypteringsfeil – tokenet kan være korrupt
  }
}

async function invalidateStoredCanvasDataForUser(
  userId: string,
  encryptedToken?: string,
): Promise<void> {
  const invalidations: Array<Promise<unknown>> = [
    invalidateUserCanvasCache(userId),
  ];
  if (encryptedToken) {
    invalidations.push(invalidateCanvasCacheForToken(encryptedToken));
  }
  await Promise.allSettled(invalidations);
}

/**
 * Serialiserer en IUser til AuthBrukerSchema-format med riktige defaults.
 * Delt hjelpefunksjon for GET /me og PUT /profile.
 */
function serializeAuthBruker(bruker: IUser) {
  let harCanvasToken = false;
  if (bruker.canvasApiToken) {
    try {
      decrypt(bruker.canvasApiToken);
      harCanvasToken = true;
    } catch {
      // Token finnes men kan ikke dekrypteres (feil ENCRYPTION_KEY) — rapporter som manglende
      harCanvasToken = false;
    }
  }
  return AuthBrukerSchema.parse({
    id: bruker._id.toString(),
    email: bruker.email,
    username: bruker.username,
    firstName: bruker.firstName,
    lastName: bruker.lastName,
    hasCanvasToken: harCanvasToken,
    canvasBaseUrl: bruker.canvasBaseUrl ?? null,
    canvasContextPreferences:
      bruker.canvasContextPreferences || createDefaultCanvasContextPreferences(),
    varslerState: normalizeVarslerState(
      bruker.varslerState || createDefaultVarslerState(),
    ),
    manuellInnleveringState: normalizeManuellInnleveringState(
      bruker.manuellInnleveringState || createDefaultManuellInnleveringState(),
    ),
    browserPushPreferences: normalizeBrowserPushPreferences(
      bruker.browserPushPreferences ?? createDefaultBrowserPushPreferences(),
    ),
    uiPreferences: bruker.uiPreferences ?? undefined,
    hiddenCourseIds: bruker.hiddenCourseIds
      ? normalizeHiddenCourseIds(bruker.hiddenCourseIds)
      : undefined,
    role: bruker.role ?? "user",
    authProviders: bruker.authProviders ?? [],
    mfaEnabled: bruker.mfaEnabled ?? false,
    syncConflicts:
      bruker.syncConflicts && bruker.syncConflicts.length > 0
        ? bruker.syncConflicts
        : undefined,
  });
}

/**
 * Henter autentisert bruker fra DB. Returnerer bruker eller sender 401 og null.
 */
async function hentAutentisertBruker(
  userId: string | undefined,
  res: Response,
  selectFields?: string,
) {
  if (!userId) {
    apiError.unauthorized(res);
    return null;
  }
  const query = User.findOne({ _id: userId, deletedAt: { $exists: false } });
  if (selectFields) query.select(selectFields);
  const bruker = await query;
  if (!bruker) {
    apiError.unauthorized(res, "Bruker eksisterer ikke lenger.");
    return null;
  }
  return bruker;
}

// POST /username/check — Sjekk om brukernavn er tilgjengelig (public endpoint for sign-up).
// POST brukes for å unngå at e-post havner i URL/query-parametre, nettleserhistorikk og logger.
// Rate limited + konstant forsinkelse for å begrense enumeration- og timing-angrep.
const USERNAME_CHECK_MIN_DELAY_MS = 200;
router.post("/username/check", rateLimitUsernameCheck, async (req, res) => {
  const start = Date.now();
  try {
    const parsed = UsernameCheckQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      return sendZodError(res, parsed.error, "Brukernavnvalidering");
    }

    const { username, email } = parsed.data;
    const sanitized = sanitizeUsername(username);
    if (!sanitized) {
      const elapsed = Date.now() - start;
      if (elapsed < USERNAME_CHECK_MIN_DELAY_MS) {
        await new Promise((r) => setTimeout(r, USERNAME_CHECK_MIN_DELAY_MS - elapsed));
      }
      return res.json(
        UsernameCheckResponseSchema.parse({
          available: false,
          username,
        }),
      );
    }

    const normalizedEmail = email?.toLowerCase().trim() || null;
    const existingUser = await User.findOne({
      usernameNormalized: sanitized.usernameNormalized,
      deletedAt: { $exists: false },
    }).select("_id email clerkId clerkEnv oauthAccounts");

    let available = !existingUser;
    if (existingUser && normalizedEmail) {
      const currentClerkEnv = getCurrentClerkEnv();
      const envAllowsRelink =
        isProd ||
        process.env.RELINK_DEV_GATE_DISABLED === "true" ||
        (existingUser.clerkEnv === currentClerkEnv && currentClerkEnv !== "unknown");

      const knownEmails = new Set(
        [
          existingUser.email?.toLowerCase().trim(),
          ...(existingUser.oauthAccounts ?? [])
            .map((account) => account.email?.toLowerCase().trim())
            .filter(Boolean),
        ].filter(Boolean),
      );
      const sameKnownEmail = knownEmails.has(normalizedEmail);
      if (sameKnownEmail && envAllowsRelink && existingUser.clerkId) {
        const existsInCurrentClerk = await clerkUserExistsInCurrentInstance(existingUser.clerkId);
        if (!existsInCurrentClerk) {
          available = true;
        }
      }
    }

    // Konstant forsinkelse: sørg for at alle svar tar minst USERNAME_CHECK_MIN_DELAY_MS
    // for å forhindre timing-basert brukernavn-enumeration.
    const elapsed = Date.now() - start;
    if (elapsed < USERNAME_CHECK_MIN_DELAY_MS) {
      await new Promise((r) => setTimeout(r, USERNAME_CHECK_MIN_DELAY_MS - elapsed));
    }

    return res.json(
      UsernameCheckResponseSchema.parse({
        available,
        username,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "sjekk av brukernavn",
      melding: "Kunne ikke sjekke brukernavn. Prøv igjen.",
    });
  }
});

// POST /token (Beskyttet av global requireAuth)
// Lagre brukerens personlige Canvas API Token sikkert.
// Query params:
//   - force=true: Tving re-kobling av Canvas-konto fra annen bruker
router.post("/token", rateLimitToken, async (req, res) => {
  try {
    const parsed = CanvasTokenRequestSchema.parse(req.body);
    const { token, canvasBaseUrl } = parsed;
    const userId = req.user?.id;
    const forceRelink = req.query.force === "true";
    const usersToInvalidate = new Set<string>();

    // Strengere rate limit for force-relink (3 per time per bruker)
    if (forceRelink) {
      await new Promise<void>((resolve, reject) => {
        // Hvis middleware avviser og sender respons direkte uten å kalle next,
        // resolver vi på "finish"-eventet slik at Promise ikke henger.
        res.once("finish", () => resolve());
        void rateLimitForceRelink(req, res, (err?: unknown) => {
          if (err) reject(err);
          else resolve();
        });
      });
      if (res.headersSent) return;
    }

    if (!token) {
      return apiError.badRequest(res, "Token mangler");
    }
    // Fjern "Bearer " hvis det ligger i tokenet
    const cleanToken = token.replace(/^Bearer\s+/i, "").trim();
    if (!userId) {
      return apiError.unauthorized(res);
    }
    if (!canvasBaseUrl) {
      return apiError.badRequest(res, "Canvas-institusjon mangler");
    }
    const bruker = await hentAutentisertBruker(
      userId,
      res,
      "+canvasApiToken +canvasTokenHash",
    );
    if (!bruker) return;
    const nyTokenHash = hashToken(cleanToken);
    // Sjekk om tokenet er i bruk av en ANNEN bruker (samme token-hash = samme Canvas-konto)
    const eksisterendeTokenBruker = await User.findOne({
      canvasBaseUrl,
      canvasTokenHash: nyTokenHash,
      _id: { $ne: userId },
      deletedAt: { $exists: false },
    });
    if (eksisterendeTokenBruker) {
      logger.warn(
        { userId, existingUserId: eksisterendeTokenBruker._id },
        "Forsøk på å bruke eksisterende Canvas token",
      );
      if (!forceRelink) {
        return sendCanvasConflictResponse(res, "token");
      }
    }
    // Sjekk hash først (timing-safe for SAMME bruker)
    if (
      bruker.canvasBaseUrl === canvasBaseUrl &&
      timingSafeHexEqual(bruker.canvasTokenHash, nyTokenHash)
    ) {
      // Hash-treff er ikke nok — verifiser at lagret token faktisk kan dekrypteres
      // og at Canvas fortsatt godkjenner det. Hvis ikke, fall gjennom til full re-lagring
      // slik at korrupt/utdatert kryptert verdi blir reparert.
      let lagretTokenLeselig = false;
      try {
        const decrypted = bruker.canvasApiToken ? decrypt(bruker.canvasApiToken) : null;
        lagretTokenLeselig = decrypted != null && decrypted.length === cleanToken.length &&
          crypto.timingSafeEqual(Buffer.from(decrypted), Buffer.from(cleanToken));
      } catch {
        lagretTokenLeselig = false;
      }

      if (lagretTokenLeselig) {
        try {
          await fetchUserProfile(cleanToken, canvasBaseUrl);
          // Token er uendret og fortsatt gyldig — ingen invalidering
          warmCanvasCache(cleanToken, canvasBaseUrl).catch((err) => {
            logger.debug({ err }, "Bakgrunns cache-warming feilet (ikke-kritisk)");
          });
          logger.info(
            { userId },
            "Canvas token identisk (hash match + Canvas verifisert) — ingen invalidering",
          );
          return res.json(
            CanvasTokenResponseSchema.parse({
              melding: "Token er allerede lagret",
              success: true,
            }),
          );
        } catch (verifyErr) {
          logger.warn(
            { err: verifyErr, userId },
            "Hash matchet men Canvas avviste tokenet — re-lagrer for å oppdatere status",
          );
          // Fall gjennom til full verifisering/lagring nedenfor
        }
      } else {
        logger.warn(
          { userId },
          "Hash matchet men lagret kryptert token er uleselig — re-lagrer for å reparere",
        );
        // Fall gjennom til full lagring nedenfor (re-krypterer med gjeldende nøkkel)
      }
    }
    // Verifiser Canvas-konto eierskap FØR lagring
    let canvasProfile:
      | Awaited<ReturnType<typeof fetchUserProfile>>["data"]
      | null = null;
    try {
      const { data } = await fetchUserProfile(cleanToken, canvasBaseUrl);
      canvasProfile = data;

      // Sjekk om denne Canvas-kontoen allerede er koblet til en ANNEN StudyWise-bruker
      const eksisterendeKobling = await CanvasUser.findOne({
        canvasId: canvasProfile.id,
        canvasBaseUrl: canvasBaseUrl,
      });

      if (
        eksisterendeKobling &&
        eksisterendeKobling.localUser.toString() !== userId.toString()
      ) {
        if (forceRelink) {
          logger.info(
            {
              userId,
              oldUserId: eksisterendeKobling.localUser,
              canvasId: canvasProfile.id,
              canvasBaseUrl: canvasBaseUrl,
            },
            "Canvas-konto vil re-kobles til ny bruker (force relink) i transaksjon",
          );
        } else {
          // Avvis uten force-flagg - dette er en sikkerhetsrisiko
          logger.warn(
            {
              userId,
              existingUserId: eksisterendeKobling.localUser,
              canvasId: canvasProfile.id,
              canvasBaseUrl: canvasBaseUrl,
            },
            "Canvas-konto tilhører allerede en annen bruker - avvist",
          );
          return sendCanvasConflictResponse(res, "account");
        }
      }
    } catch (canvasError) {
      logger.warn(
        { err: canvasError, userId },
        "Kunne ikke verifisere Canvas-token",
      );
      return handleCanvasVerificationError(res, canvasError);
    }
    const kryptertToken = encrypt(cleanToken);
    let gammeltKryptertToken: string | undefined;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!canvasProfile) {
          throw new Error("Canvas-profil mangler etter verifisering");
        }
        const brukerTx = await User.findOne({ _id: userId, deletedAt: { $exists: false } })
          .select("+canvasApiToken +canvasTokenHash")
          .session(session);
        if (!brukerTx) {
          throw new Error("Bruker ble ikke funnet under token-transaksjon");
        }

        gammeltKryptertToken = brukerTx.canvasApiToken;
        const brukerTxId = brukerTx._id.toString();
        const disconnectedUserIds = new Set<string>();

        const disconnectCanvasForUser = async (targetUserId: string) => {
          if (
            targetUserId === brukerTxId ||
            disconnectedUserIds.has(targetUserId)
          ) {
            return;
          }
          disconnectedUserIds.add(targetUserId);
          usersToInvalidate.add(targetUserId);
          await Promise.all([
            User.updateOne(
              { _id: targetUserId },
              {
                $unset: {
                  canvasApiToken: 1,
                  canvasTokenHash: 1,
                  canvasUser: 1,
                  canvasBaseUrl: 1,
                },
              },
              { session },
            ),
            CanvasUser.deleteMany({ localUser: targetUserId }, { session }),
          ]);
        };

        const freshTokenBruker = await User.findOne({
          canvasBaseUrl,
          canvasTokenHash: nyTokenHash,
          _id: { $ne: brukerTx._id },
          deletedAt: { $exists: false },
        }).session(session);
        if (freshTokenBruker) {
          if (!forceRelink) {
            throw new CanvasTokenConflictError("token");
          }
          await disconnectCanvasForUser(freshTokenBruker._id.toString());
        }

        const freshKobling = await CanvasUser.findOne({
          canvasId: canvasProfile.id,
          canvasBaseUrl,
        }).session(session);
        if (freshKobling && freshKobling.localUser.toString() !== brukerTxId) {
          if (!forceRelink) {
            throw new CanvasTokenConflictError("account");
          }
          await disconnectCanvasForUser(freshKobling.localUser.toString());
        }

        await CanvasUser.deleteMany({ localUser: brukerTx._id }, { session });
        const nyCanvasBruker = new CanvasUser(
          buildCanvasUserPayload(canvasProfile, canvasBaseUrl, brukerTx._id),
        );
        await nyCanvasBruker.save({ session });

        brukerTx.canvasApiToken = kryptertToken;
        brukerTx.canvasTokenHash = nyTokenHash;
        brukerTx.canvasBaseUrl = canvasBaseUrl;
        brukerTx.canvasUser = nyCanvasBruker._id;
        await brukerTx.save({ session });
      });
    } catch (error) {
      if (error instanceof CanvasTokenConflictError) {
        logger.warn(
          { userId, conflictType: error.conflictType },
          "Canvas-token lagring stoppet på konflikt i transaksjon",
        );
        return sendCanvasConflictResponse(res, error.conflictType);
      }
      if (isMongoDuplicateKeyError(error)) {
        logger.warn(
          { userId, canvasBaseUrl },
          "Canvas-token lagring traff unikhetskonflikt i transaksjon",
        );
        return sendCanvasConflictResponse(res, "account");
      }
      throw error;
    } finally {
      await session.endSession();
    }

    logger.info({ userId }, "Canvas token lagret for bruker");
    await audit({
      actorUserId: userId,
      action: gammeltKryptertToken
        ? AUDIT_ACTIONS.CANVAS_TOKEN_UPDATED
        : AUDIT_ACTIONS.CANVAS_TOKEN_CREATED,
      category: "integration",
      outcome: "success",
      role: req.actorRole,
      req,
    });

    // Invalider cache ETTER lagring — slik at nytt token allerede er persistert
    await invalidateStoredCanvasDataForUser(
      userId.toString(),
      gammeltKryptertToken,
    );

    usersToInvalidate.delete(userId.toString());
    await Promise.allSettled(
      [...usersToInvalidate].map((targetUserId) =>
        invalidateStoredCanvasDataForUser(targetUserId),
      ),
    );

    warmCanvasCache(cleanToken, canvasBaseUrl).catch((err) => {
      logger.warn(
        { err, userId },
        "Cache warming feilet etter token-lagring (ikke kritisk)",
      );
    });

    // Kjør full bakgrunns-sync for å (re-)fylle MongoDB permanent.
    // Kjøres alltid: invalidering over sletter CanvasStructure, og vi vil ha fersk data uansett.
    triggerInitialSync(userId.toString(), cleanToken, canvasBaseUrl);

    return res.json(
      CanvasTokenResponseSchema.parse({
        melding: "Token lagret og kryptert",
        success: true,
      }),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return sendZodError(res, error, "Token-lagring");
    }
    return sendUnknownError(res, error, {
      kontekst: "token-lagring",
      melding: "Kunne ikke lagre Canvas-token. Prøv igjen.",
    });
  }
});

// DELETE /token (slett Canvas token)
router.delete("/token", rateLimitToken, async (req, res) => {
  try {
    const bruker = await hentAutentisertBruker(
      req.user?.id,
      res,
      "+canvasApiToken +canvasTokenHash",
    );
    if (!bruker) return;
    const userId = bruker._id.toString();
    // Sjekk om bruker har et Canvas token
    if (!bruker.canvasApiToken) {
      return apiError.badRequest(res, "Ingen Canvas-token å slette");
    }
    await invalidateStoredCanvasDataForUser(userId, bruker.canvasApiToken);
    // Slett koblingene i databasen atomisk — sikrer at CanvasUser og User-feltene
    // enten begge slettes eller begge beholdes ved feil
    let deletedCanvasUsers = 0;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const canvasRes = await CanvasUser.deleteMany(
          { localUser: bruker._id },
          { session },
        );
        deletedCanvasUsers = canvasRes.deletedCount;
        // $unset fjerner Canvas-feltene atomisk — unngår setter-krasj på canvasBaseUrl (normalizeCanvasBaseUrl)
        // allow-deleted-users: bruker er allerede validert via User.findOne med deletedAt-filter ovenfor
        await User.updateOne(
          { _id: bruker._id },
          {
            $unset: {
              canvasApiToken: 1,
              canvasTokenHash: 1,
              canvasUser: 1,
              canvasBaseUrl: 1,
            },
          },
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    logger.info(
      { userId, deletedCount: deletedCanvasUsers },
      "Slettet CanvasUser-dokumenter fra database",
    );

    logger.info(
      { userId },
      "Canvas token slettet og bruker frakoblet fullstendig",
    );
    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.CANVAS_TOKEN_DELETED,
      category: "integration",
      outcome: "success",
      role: req.actorRole,
      req,
    });
    return res.json(
      CanvasTokenResponseSchema.parse({
        melding:
          "Canvas-koblingen er slettet. Du må koble til på nytt for å hente data.",
        success: true,
      }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "token-sletting",
      melding: "Kunne ikke slette Canvas-token. Prøv igjen.",
    });
  }
});

// GET /me (Beskyttet av global requireAuth)
// Hent informasjon om den autentiserte brukeren. Gjenbruker req.authenticatedUser fra requireAuth for å unngå dobbel MongoDB-henting.
router.get("/me", rateLimitMe, async (req, res) => {
  try {
    const userId = req.user?.id;
    const flowId =
      typeof req.headers["x-debug-flow-id"] === "string"
        ? req.headers["x-debug-flow-id"].slice(0, 64)
        : undefined;
    const authenticatedUser = (req as Request & { authenticatedUser?: IUser })
      .authenticatedUser;
    const bruker =
      authenticatedUser ??
      (await hentAutentisertBruker(userId, res, "+canvasApiToken"));
    if (!bruker) return;

    if (flowId) {
      logger.info(
        {
          flowId,
          userId: bruker._id,
          email: bruker.email,
          username: bruker.username,
        },
        "authFlow: /me responding with user data",
      );
    }
    if (bruker.canvasApiToken && !bruker.canvasBaseUrl) {
      logger.warn(
        { userId: bruker._id },
        "Bruker har Canvas-token uten canvasBaseUrl (gammel konto – må velge institusjon ved neste token-oppdatering)",
      );
    }
    return res.json(
      MeResponseSchema.parse({ user: serializeAuthBruker(bruker) }),
    );
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "henting av brukerprofil",
      melding: "Kunne ikke laste brukerdata. Prøv igjen.",
    });
  }
});

// POST /sync-conflicts/dismiss — avvis/bekreft en synkroniseringskonflikt (brukeren har sett den).
router.post("/sync-conflicts/dismiss", rateLimitMe, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const { type } = req.body ?? {};
    if (!type || typeof type !== "string" || !(SYNC_CONFLICT_TYPES as readonly string[]).includes(type)) {
      return apiError.badRequest(res, "Ugyldig eller manglende konflikttype");
    }

    await User.updateOne(
      { _id: userId, deletedAt: { $exists: false } },
      { $pull: { syncConflicts: { type } } },
    );

    logger.info(
      { userId, conflictType: type },
      "Synkroniseringskonflikt avvist av bruker",
    );
    return res.json(SyncConflictRemovedResponseSchema.parse({ melding: "Konflikt fjernet" }));
  } catch (error) {
    return sendUnknownError(res, error, {
      kontekst: "fjerning av synkroniseringskonflikt",
      melding: "Kunne ikke fjerne konflikten. Prøv igjen.",
    });
  }
});

// PUT /profile — oppdater brukerprofil (fornavn, etternavn, brukernavn). Synker til Clerk.
router.put("/profile", rateLimitMe, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const parsed = ProfileUpdateWithUsernameSchema.parse(req.body);
    const bruker = await hentAutentisertBruker(userId, res, "+canvasApiToken");
    if (!bruker) return;

    // Oppdater i MongoDB
    const updateFields: Record<string, unknown> = {};
    const unsetFields: Record<string, 1> = {};

    if (parsed.firstName !== undefined) {
      if (parsed.firstName === "") {
        unsetFields.firstName = 1;
      } else {
        updateFields.firstName = parsed.firstName;
      }
    }
    if (parsed.lastName !== undefined) {
      if (parsed.lastName === "") {
        unsetFields.lastName = 1;
      } else {
        updateFields.lastName = parsed.lastName;
      }
    }
    let usernameConflictPayload: { username: string } | null = null;
    if (parsed.username !== undefined) {
      const sanitizedUsername = sanitizeUsername(parsed.username);
      if (sanitizedUsername) {
        updateFields.username = sanitizedUsername.username;
        updateFields.usernameNormalized = sanitizedUsername.usernameNormalized;
        usernameConflictPayload = { username: parsed.username };
      } else {
        return apiError.badRequest(res, "Ugyldig brukernavn", {
          felt: "username",
        });
      }
    }

    const mongoUpdate: Record<string, unknown> = {};
    if (Object.keys(updateFields).length > 0) mongoUpdate.$set = updateFields;
    if (Object.keys(unsetFields).length > 0) mongoUpdate.$unset = unsetFields;

    let oppdatertBruker;
    try {
      oppdatertBruker = await User.findOneAndUpdate(
        { _id: userId, deletedAt: { $exists: false } },
        mongoUpdate,
        { returnDocument: "after" },
      ).select("+canvasApiToken");
    } catch (error) {
      if (isMongoDuplicateKeyError(error) && usernameConflictPayload) {
        return res.status(409).json({
          error: "username_conflict",
          melding:
            `Brukernavnet "${usernameConflictPayload.username}" er allerede tatt. ` +
            "Velg et annet brukernavn og prøv igjen.",
          username: usernameConflictPayload.username,
        });
      }
      throw error;
    }
    if (!oppdatertBruker) {
      return apiError.notFound(res, "Bruker");
    }

    // Synkroniser til Clerk hvis brukeren har clerkId.
    // Klientstyrt "skip sync" er fjernet for å unngå varig drift mellom Clerk og MongoDB.
    if (oppdatertBruker.clerkId) {
      const { updateClerkUserProfile } = await import("./clerkAuth.js");
      const clerkUpdates: {
        firstName?: string;
        lastName?: string;
        username?: string;
      } = {};
      if (parsed.firstName !== undefined)
        clerkUpdates.firstName = parsed.firstName ?? "";
      if (parsed.lastName !== undefined)
        clerkUpdates.lastName = parsed.lastName ?? "";
      if (parsed.username !== undefined)
        clerkUpdates.username = parsed.username ?? "";
      const clerkSuccess = await updateClerkUserProfile(
        oppdatertBruker.clerkId,
        clerkUpdates,
      );
      if (!clerkSuccess) {
        logger.warn(
          { userId },
          "Profiloppdatering synket til MongoDB men ikke til Clerk",
        );
      }
    }

    logger.info({ userId }, "Brukerprofil oppdatert");
    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.PROFILE_UPDATED,
      category: "profile",
      outcome: "success",
      metadata: { fields: Object.keys(parsed) },
      role: req.actorRole,
      req,
    });

    return res.json(
      ProfileUpdateResponseSchema.parse({
        melding: "Profil oppdatert",
        user: serializeAuthBruker(oppdatertBruker),
      }),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return sendZodError(res, error, "Profiloppdatering");
    }
    return sendUnknownError(res, error, {
      kontekst: "profiloppdatering",
      melding: "Kunne ikke oppdatere profil. Prøv igjen.",
    });
  }
});

// PUT /preferences
router.put("/preferences", rateLimitMe, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return apiError.unauthorized(res);
    }

    const bruker = await hentAutentisertBruker(userId, res);
    if (!bruker) return;

    const {
      canvasContextPreferences,
      varslerState,
      manuellInnleveringState,
      browserPushPreferences,
      uiPreferences,
      hiddenCourseIds,
    } = PreferencesUpdateSchema.parse(req.body);
    const updateFields: Record<string, unknown> = {};
    if (canvasContextPreferences !== undefined) {
      updateFields.canvasContextPreferences =
        CanvasContextPreferencesSchema.parse(canvasContextPreferences);
    }
    if (varslerState !== undefined) {
      updateFields.varslerState = normalizeVarslerState(varslerState);
    }
    if (manuellInnleveringState !== undefined) {
      updateFields.manuellInnleveringState = normalizeManuellInnleveringState(
        manuellInnleveringState,
      );
    }
    if (browserPushPreferences !== undefined) {
      updateFields.browserPushPreferences = normalizeBrowserPushPreferences(
        browserPushPreferences,
      );
    }
    if (uiPreferences !== undefined) {
      UIPreferencesSchema.parse({
        ...(bruker.uiPreferences ?? {}),
        ...uiPreferences,
      });

      // Oppdater kun feltene som faktisk kom inn i requesten, slik at samtidige
      // preferansekall ikke overskriver hverandre ved race conditions.
      for (const [key, value] of Object.entries(uiPreferences)) {
        if (value !== undefined) {
          updateFields[`uiPreferences.${key}`] = value;
        }
      }
    }
    if (hiddenCourseIds !== undefined) {
      updateFields.hiddenCourseIds = normalizeHiddenCourseIds(hiddenCourseIds);
    }

    const oppdatertBruker = await User.findOneAndUpdate(
      { _id: userId, deletedAt: { $exists: false } },
      { $set: updateFields },
      { returnDocument: "after" },
    );

    if (!oppdatertBruker) {
      return apiError.notFound(res, "Bruker");
    }

    logger.info({ userId }, "Brukerpreferanser oppdatert");
    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.PREFERENCES_UPDATED,
      category: "profile",
      outcome: "success",
      role: req.actorRole,
      req,
    });

    return res.json(
      PreferencesResponseSchema.parse({
        melding: "Preferanser oppdatert",
        canvasContextPreferences:
          oppdatertBruker.canvasContextPreferences ||
          createDefaultCanvasContextPreferences(),
        varslerState: normalizeVarslerState(
          oppdatertBruker.varslerState || createDefaultVarslerState(),
        ),
        manuellInnleveringState: normalizeManuellInnleveringState(
          oppdatertBruker.manuellInnleveringState ||
            createDefaultManuellInnleveringState(),
        ),
        browserPushPreferences: normalizeBrowserPushPreferences(
          oppdatertBruker.browserPushPreferences ??
            createDefaultBrowserPushPreferences(),
        ),
        uiPreferences: oppdatertBruker.uiPreferences ?? undefined,
        hiddenCourseIds: oppdatertBruker.hiddenCourseIds
          ? normalizeHiddenCourseIds(oppdatertBruker.hiddenCourseIds)
          : undefined,
      }),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return sendZodError(res, error, "Preferanser");
    }
    return sendUnknownError(res, error, {
      kontekst: "oppdatering av preferanser",
      melding: "Kunne ikke lagre preferanser. Prøv igjen.",
    });
  }
});

router.post("/push-subscriptions", rateLimitMe, async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    if (!isWebPushConfigured()) {
      return apiError.serviceUnavailable(res, "Nettleservarsler");
    }

    const parsed = SaveWebPushSubscriptionRequestSchema.parse(req.body);
    await upsertWebPushSubscription(
      userId,
      parsed.subscription,
      req.get("user-agent") ?? undefined,
    );

    return res.json(
      WebPushSubscriptionResponseSchema.parse({
        success: true,
        subscribed: true,
      }),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return sendZodError(res, error, "Web-push abonnement");
    }
    if (error instanceof WebPushSubscriptionConflictError) {
      return apiError.conflict(res, error.message);
    }
    return sendUnknownError(res, error, {
      kontekst: "lagring av web-push abonnement",
      melding: "Kunne ikke aktivere nettleservarsler. Prøv igjen.",
    });
  }
});

router.get("/push-client-config", rateLimitMe, async (_req, res) => {
  const payload = WebPushClientConfigResponseSchema.parse(
    getWebPushClientConfig(),
  );
  return res.json(payload);
});

router.delete("/push-subscriptions", rateLimitMe, async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const parsed = DeleteWebPushSubscriptionRequestSchema.parse(req.body);
    await removeWebPushSubscription(userId, parsed.endpoint);

    return res.json(
      WebPushSubscriptionResponseSchema.parse({
        success: true,
        subscribed: false,
      }),
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return sendZodError(res, error, "Sletting av web-push abonnement");
    }
    return sendUnknownError(res, error, {
      kontekst: "sletting av web-push abonnement",
      melding: "Kunne ikke deaktivere nettleservarsler. Prøv igjen.",
    });
  }
});

router.post("/push-subscriptions/test", rateLimitMe, async (req, res) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    if (!isWebPushConfigured()) {
      return apiError.serviceUnavailable(res, "Nettleservarsler");
    }

    const delivered = await sendTestWebPush(userId);
    return res.json(
      SendTestWebPushResponseSchema.parse({
        success: true,
        delivered,
      }),
    );
  } catch (error) {
    // Leveringstjenesten (BullMQ/Redis) er nede — returner 503 så brukeren ser
    // "tjenesten er midlertidig utilgjengelig" i stedet for at endepunktet
    // later som alt gikk bra ved å bare logge og returnere delivered: false.
    if (error instanceof WebPushDeliveryUnavailableError) {
      return apiError.serviceUnavailable(res, "Nettleservarsler");
    }
    return sendUnknownError(res, error, {
      kontekst: "test av web-push",
      melding: "Kunne ikke sende testvarsel. Prøv igjen.",
    });
  }
});

// POST /logout (Clerk session cleared on frontend; backend clears Canvas runtime cache + token cache)
router.post("/logout", rateLimitMe, async (req, res) => {
  const userId = req.user?.id;
  try {
    if (userId) {
      await clearUserCanvasRuntimeState(userId);

      // Invalider Bearer-token-cache for gjeldende sesjon slik at cached tokens ikke kan gjenbrukes etter logout.
      // Bruker per-sesjon invalidering for å unngå at andre faner/enheter mister sesjonen.
      const authenticatedUser = (req as Request & { authenticatedUser?: IUser }).authenticatedUser;
      const clerkId = authenticatedUser?.clerkId;
      if (clerkId) {
        const { invalidateTokenCacheBySession, getSessionIdFromTokenCache } = await import("./clerkAuth.js");
        const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
        const sessionId = token ? getSessionIdFromTokenCache(token) : undefined;
        invalidateTokenCacheBySession(clerkId, sessionId);
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Feil under logout-opprydding");
  }
  if (userId) {
    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.SIGN_OUT,
      category: "auth",
      outcome: "success",
      role: req.actorRole,
      req,
    });
  }
  return res.json(LogoutResponseSchema.parse({ melding: "Logget ut" }));
});

// DELETE /account — slett egen konto og all tilknyttet data (GDPR).
// Krever auth + nylig sesjon (step-up) for å forhindre misbruk ved stjålet session.
router.delete("/account", requireRecentAuth, rateLimitAccountDeletion, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    return apiError.unauthorized(res);
  }
  try {
    const deletionResult = await deleteAccountData(userId);
    const deletedAuditActorId = getDeletedAuditActorId(userId);
    await audit({
      actorUserId: deletedAuditActorId,
      action: AUDIT_ACTIONS.ACCOUNT_DELETED,
      category: "privacy",
      outcome: "success",
      role: req.actorRole,
      metadata: {
        deleted: deletionResult.deleted,
        providerAccountDeleted: deletionResult.providerAccountDeleted,
        vectorCleanupSucceeded: deletionResult.vectorCleanupSucceeded,
      },
      req,
    });
    try {
      await anonymizeAuditTrailForDeletedUser(userId);
    } catch (auditError) {
      logger.warn(
        { err: auditError, userId },
        "Klarte ikke å anonymisere revisjonsspor etter kontosletting",
      );
    }
    return res.json(AccountDeletionResponseSchema.parse({
      melding: deletionResult.providerAccountDeleted && deletionResult.vectorCleanupSucceeded
        ? "Konto og tilknyttet data er slettet"
        : "StudyWise-kontoen er slettet, men ekstern opprydding kunne ikke fullfores automatisk.",
      deleted: deletionResult.deleted,
      providerAccountDeleted: deletionResult.providerAccountDeleted,
      vectorCleanupSucceeded: deletionResult.vectorCleanupSucceeded,
    }));
  } catch (err) {
    // Refunder rate-limit-tokenet siden selve sletteoperasjonen feilet —
    // brukeren skal ikke låses ute i 24 timer for en transient feil de ikke forårsaket.
    // Best-effort: feiler stille og maskerer ikke den opprinnelige feilen.
    await rateLimitAccountDeletion.reward(req);

    await audit({
      actorUserId: userId,
      action: AUDIT_ACTIONS.ACCOUNT_DELETED,
      category: "privacy",
      outcome: "failure",
      role: req.actorRole,
      metadata: { error: err instanceof Error ? err.message : String(err) },
      req,
    });
    const requestId = (req as Request & { id?: string }).id;
    logger.error({ err, requestId, path: req.path }, "Account deletion failed");
    return sendUnknownError(res, err, {
      kontekst: "sletting av konto",
      melding: "Kunne ikke slette kontoen. Prøv igjen eller kontakt support.",
    });
  }
});

// ─── Studiestatistikk ───────────────────────────────────────────────

/**
 * GET /api/user/study-stats/today
 * Aggregerer dagens studieaktivitet fra ChatHistory, TaskBreakdown, Arbeidsplan og StudyContext.
 */
router.get("/study-stats/today", rateLimitMe, async (req: Request, res: Response) => {
  try {
    const userId = requireUserId(req, res);
    if (!userId) return;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const { ChatHistory } = await import("../../database/models/ChatHistory.js");
    const { Arbeidsplan } = await import("../../database/models/arbeidsplan.js");
    const { TaskBreakdown } = await import("../../database/models/TaskBreakdown.js");
    const { StudyContext } = await import("../../database/models/StudyContext.js");
    const { getIsoWeekInfo, parseTimerStreng } = await import("common/dateUtils");

    // Kjør alle queries parallelt for best ytelse
    const [chatCount, chatActivityTimestamps, taskResult, studyContextResult, arbeidsplan] = await Promise.all([
      // Antall KI-samtaler opprettet eller oppdatert i dag
      ChatHistory.countDocuments({
        user: new mongoose.Types.ObjectId(userId),
        updatedAt: { $gte: todayStart },
      }),

      // Tidsstempler for chat-aktivitet i dag — brukes til å estimere faktisk tid brukt
      // (createdAt + updatedAt fanger både opprettelse og siste oppdatering)
      ChatHistory.find(
        {
          user: new mongoose.Types.ObjectId(userId),
          $or: [
            { updatedAt: { $gte: todayStart } },
            { createdAt: { $gte: todayStart } },
          ],
        },
        { createdAt: 1, updatedAt: 1 },
      ).lean(),

      // Antall subtasks fullført i dag (basert på per-subtask completedAt)
      TaskBreakdown.aggregate([
        { $match: { userId: new mongoose.Types.ObjectId(userId) } },
        { $unwind: "$subtasks" },
        {
          $match: {
            "subtasks.completed": true,
            "subtasks.completedAt": { $gte: todayStart },
          },
        },
        { $count: "total" },
      ]),

      // Antall unike emner med topics oppdatert i dag
      StudyContext.aggregate([
        { $match: { userId } },
        { $unwind: "$topics" },
        { $match: { "topics.lastAskedAt": { $gte: todayStart } } },
        { $count: "total" },
      ]),

      // Denne ukens arbeidsplan for studieblokker
      (async () => {
        const { weekNumber, weekYear } = getIsoWeekInfo(now);
        return Arbeidsplan.findOne({ userId, year: weekYear, weekNumber });
      })(),
    ]);

    // Beregn fullførte studieblokker og timer i dag
    let studyBlocksCompleted = 0;
    let studyHoursCompleted = 0;
    if (arbeidsplan) {
      const todayBlocks = arbeidsplan.blocks.filter(
        (b) => b.completed && b.completedAt && b.completedAt >= todayStart,
      );
      studyBlocksCompleted = todayBlocks.length;
      studyHoursCompleted =
        todayBlocks.reduce((sum, b) => sum + parseTimerStreng(b.duration), 0);
    }

    // Estimer aktiv tid brukt på KI-chat i dag basert på createdAt/updatedAt-spor.
    // Behandler hvert chat-dokument som en aktivitetsperiode mellom createdAt og updatedAt
    // (klippet til dagens start), og slår sammen overlappende perioder for å unngå dobbelttelling.
    // Et minimum på 2 minutter per chat sikrer at korte samtaler også teller.
    interface AktivitetsPeriode { start: number; slutt: number; }
    const perioder: AktivitetsPeriode[] = [];
    for (const c of chatActivityTimestamps as Array<{ createdAt?: Date; updatedAt?: Date }>) {
      const created = c.createdAt ? new Date(c.createdAt).getTime() : null;
      const updated = c.updatedAt ? new Date(c.updatedAt).getTime() : null;
      if (!updated) continue;
      const sluttTs = updated;
      const startTs = Math.max(
        created ?? sluttTs - 2 * 60_000,
        todayStart.getTime(),
      );
      if (sluttTs <= startTs) {
        perioder.push({ start: sluttTs - 2 * 60_000, slutt: sluttTs });
      } else {
        perioder.push({ start: startTs, slutt: sluttTs });
      }
    }
    // Slå sammen overlappende perioder
    perioder.sort((a, b) => a.start - b.start);
    const slatt: AktivitetsPeriode[] = [];
    for (const p of perioder) {
      const sist = slatt[slatt.length - 1];
      if (sist && p.start <= sist.slutt) {
        sist.slutt = Math.max(sist.slutt, p.slutt);
      } else {
        slatt.push({ ...p });
      }
    }
    const chatTimer = slatt.reduce((sum, p) => sum + (p.slutt - p.start) / 3_600_000, 0);
    studyHoursCompleted = Math.round((studyHoursCompleted + chatTimer) * 10) / 10;

    return res.json({
      chatSessions: chatCount,
      tasksCompleted: taskResult[0]?.total ?? 0,
      studyBlocksCompleted,
      studyHoursCompleted,
      topicsStudied: studyContextResult[0]?.total ?? 0,
    });
  } catch (error) {
    sendUnknownError(res, error, { kontekst: "studiestatistikk" });
  }
});

export default router;
