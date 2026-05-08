/**
 * Clerk-only auth-middleware.
 * Verifiserer Bearer-token med Clerk, synkroniserer bruker til MongoDB, setter req.user og req.actorRole.
 */

import { Request, Response, NextFunction } from "express";
import { User } from "../database/models/User.js";
import { decrypt } from "../utils/kryptering.js";
import { logger } from "../utils/logger.js";
import { apiError } from "../utils/apiError.js";
import { normalizeCanvasBaseUrl, StoredCanvasBaseUrlSchema } from "common/auth";
import { APP_ROLES, DEFAULT_ROLE, type UserRole } from "common/auth";
import type { IUser } from "../database/models/User.js";
import {
  findOrCreateUserByClerkId,
  getClerkUserIdFromToken,
  getFactorVerificationAgeFromTokenCache,
  getClerkSessionCreatedAt,
  isAccountConflict,
  isTurnstileRequired,
  isOAuthAccountConflict,
  isOAuthMetadataMissing,
  isUserDeleted,
  isUserLocked,
  isUsernameConflict,
  getSessionIdFromTokenCache,
  markSessionTurnstileVerified,
  isSessionTurnstileVerified,
} from "../rutere/auth/clerkAuth.js";
import { enqueueClerkDeletionRetry } from "../queues/clerkDeletion.queue.js";
import { AUTH_TURNSTILE_COOKIE_NAME } from "common/auth";
import { clearAuthTurnstileCookie, isValidAuthTurnstileCookieValue } from "../utils/authTurnstileCookie.js";
import { isProd } from "../utils/env.js";
import { audit, AUDIT_ACTIONS } from "../utils/auditLog.js";
import { checkSecurityThresholds } from "../utils/securityAlert.js";

// Maks alder for sesjon ved sensitive operasjoner (kontosletting, admin-handlinger)
const SENSITIVE_OP_MAX_SESSION_AGE_SEC = 2700; // 45 minutter

const hentBearerToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
};

/** Henter en navngitt cookie fra rå Cookie-header (unngår cookie-parser-avhengighet). */
function getCookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  const match = raw.split(";").find((c) => c.trim().startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=").trim()) : undefined;
}


type AuthResolution =
  | { status: "authenticated"; clerkUserId: string; clearTurnstileCookie?: boolean }
  | { status: "missing_token" }
  | { status: "invalid_or_expired" }
  | { status: "account_conflict"; clerkUserId: string }
  | { status: "turnstile_required"; clerkUserId: string }
  | { status: "oauth_account_conflict"; clerkUserId: string; provider: string }
  | {
      status: "oauth_metadata_missing";
      clerkUserId: string;
      provider: "google" | "microsoft";
    }
  | { status: "username_conflict"; clerkUserId: string; username: string }
  | { status: "user_deleted"; clerkUserId: string }
  | { status: "user_locked"; clerkUserId: string; lockedReason?: string }
  | { status: "user_sync_failed"; clerkUserId: string };

function settAutentisertBrukerPåRequest(
  req: Request,
  user: IUser,
  context?: { clerkFactorVerificationAge?: [number, number] },
): void {
  const rawRole = user.role ?? DEFAULT_ROLE;
  const role: UserRole = (APP_ROLES as readonly string[]).includes(rawRole)
    ? (rawRole as UserRole)
    : DEFAULT_ROLE;
  req.user = { id: user._id.toString() };
  (req as Request & { actorRole: UserRole }).actorRole = role;
  (req as Request & { authenticatedUser?: IUser }).authenticatedUser = user;
  if (context?.clerkFactorVerificationAge) {
    req.clerkFactorVerificationAge = context.clerkFactorVerificationAge;
  }
}

// Eksportert for unit-testing — kalles internt fra requireAuth-middlewaren
export async function resolveAuthentication(req: Request): Promise<AuthResolution> {
  const token = hentBearerToken(req);
  if (!token) {
    return { status: "missing_token" };
  }

  // Les valgfri debug flow-korrelasjons-ID (kun dev)
  const flowId =
    !isProd && typeof req.headers["x-debug-flow-id"] === "string"
      ? req.headers["x-debug-flow-id"].slice(0, 64)
      : undefined;

  const t0 = Date.now();
  const clerkUserId = await getClerkUserIdFromToken(token);
  const tClerk = Date.now();
  if (!clerkUserId) {
    return { status: "invalid_or_expired" };
  }

  const forceSync = req.query.forceSync === "true";
  const authTurnstileCookie = getCookieValue(req, AUTH_TURNSTILE_COOKIE_NAME);
  const sessionId = getSessionIdFromTokenCache(token) ?? undefined;
  const clerkFactorVerificationAge = getFactorVerificationAgeFromTokenCache(token);
  // Spor om Turnstile-cookie ble brukt slik at den kan slettes etter autentisering (engangsbruk)
  const hadTurnstileCookie = !!authTurnstileCookie;
  const userResult = await findOrCreateUserByClerkId(clerkUserId, {
    flowId,
    forceSync,
    authTurnstileCookie,
    sessionId,
    req,
  });
  const tDb = Date.now();

  if (isAccountConflict(userResult)) {
    return { status: "account_conflict", clerkUserId };
  }

  if (isTurnstileRequired(userResult)) {
    return { status: "turnstile_required", clerkUserId };
  }

  if (isOAuthAccountConflict(userResult)) {
    return {
      status: "oauth_account_conflict",
      clerkUserId,
      provider: userResult.provider,
    };
  }

  if (isOAuthMetadataMissing(userResult)) {
    return {
      status: "oauth_metadata_missing",
      clerkUserId,
      provider: userResult.provider,
    };
  }

  if (isUsernameConflict(userResult)) {
    return {
      status: "username_conflict",
      clerkUserId,
      username: userResult.username,
    };
  }

  if (isUserDeleted(userResult)) {
    return { status: "user_deleted", clerkUserId };
  }

  if (isUserLocked(userResult)) {
    return {
      status: "user_locked",
      clerkUserId,
      lockedReason: userResult.lockedReason,
    };
  }

  if (!userResult) {
    return { status: "user_sync_failed", clerkUserId };
  }

  // Sjekk om brukeren har blitt låst etter at sesjonen ble opprettet — skjer
  // når admin låser en innlogget bruker. Vi avviser hvert request inntil
  // unlock, slik at brukeren blir effektivt sparket ut umiddelbart.
  if (userResult.lockedAt) {
    return {
      status: "user_locked",
      clerkUserId,
      lockedReason: userResult.lockedReason ?? undefined,
    };
  }

  logger.debug(
    {
      clerkMs: tClerk - t0,
      dbMs: tDb - tClerk,
      totalAuthMs: tDb - t0,
      url: req.originalUrl,
      flowId,
      clerkUserId,
      localUserId: userResult?._id?.toString(),
    },
    "auth-timing",
  );

  // Sikkerhetsnett: marker sesjonen som Turnstile-verifisert hvis den ikke allerede er det.
  // Dekker re-link-flyt og andre auth-stier som returnerer bruker uten egen Turnstile-sjekk.
  if (isProd && sessionId && hadTurnstileCookie && !(await isSessionTurnstileVerified(sessionId))) {
    if (await isValidAuthTurnstileCookieValue(authTurnstileCookie)) {
      await markSessionTurnstileVerified(sessionId);
    }
  }

  settAutentisertBrukerPåRequest(req, userResult, { clerkFactorVerificationAge });
  // Slett cookie etter konsumering — én cookie = én sesjon.
  // Andre sesjoner håndteres av TurnstileReChallenge (Cloudflare auto-pass).
  return { status: "authenticated", clerkUserId, clearTurnstileCookie: hadTurnstileCookie };
}

export interface CanvasTilkobling {
  canvasToken?: string;
  canvasBaseUrl?: string;
  /** Settes hvis brukeren har et lagret token, men dekryptering feilet (f.eks. nøkkelrotasjon). */
  decryptFailed?: boolean;
}

/**
 * Henter (og dekrypterer) Canvas-tilkobling for en bruker.
 *
 * Returnerer token + base URL hvis brukeren har lagret token; ellers null/undefined felter.
 */
export async function hentCanvasTilkoblingForBruker(
  userId: string,
): Promise<CanvasTilkobling | null> {
  const user = await User.findOne({ _id: userId, deletedAt: { $exists: false } }).select("+canvasApiToken");
  if (!user) {
    return null;
  }

  const normalizedBaseUrl = user.canvasBaseUrl
    ? normalizeCanvasBaseUrl(user.canvasBaseUrl)
    : undefined;
  const validatedBaseUrl =
    normalizedBaseUrl &&
    StoredCanvasBaseUrlSchema.safeParse(normalizedBaseUrl).success
      ? normalizedBaseUrl
      : undefined;

  if (normalizedBaseUrl && !validatedBaseUrl) {
    logger.warn(
      { userId, canvasBaseUrl: normalizedBaseUrl },
      "Ugyldig/ikke-tillatt canvasBaseUrl i brukerprofil — ignorerer verdien",
    );
  }

  let canvasToken: string | undefined;
  let decryptFailed = false;
  if (user.canvasApiToken) {
    try {
      canvasToken = decrypt(user.canvasApiToken);
    } catch (err) {
      decryptFailed = true;
      logger.error(
        { userId, error: err instanceof Error ? err.message : "unknown" },
        "Kunne ikke dekryptere Canvas API-token — sannsynligvis ENCRYPTION_KEY-mismatch",
      );
    }
  }

  return {
    canvasToken,
    canvasBaseUrl: validatedBaseUrl,
    decryptFailed,
  };
}

/**
 * Clerk-only auth: krever Authorization: Bearer <clerk_session_token>.
 * Verifiserer token, finner eller oppretter bruker via clerkId, setter req.user og req.actorRole.
 * Ved feil: loggfører token_verification_failure og returnerer 401.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  try {
    const result = await resolveAuthentication(req);

    if (result.status === "authenticated") {
      if (result.clearTurnstileCookie) {
        clearAuthTurnstileCookie(res);
      }
      next();
      return;
    }

    if (result.status === "missing_token") {
      apiError.unauthorized(res, "Mangler autentiseringstoken");
      return;
    }

    if (result.status === "invalid_or_expired") {
      await audit({
        actorUserId: "anonymous",
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: { reason: "invalid_or_expired" },
        req,
      });
      void checkSecurityThresholds({
        type: "brute_force",
        key: req.ip ?? req.socket?.remoteAddress ?? "unknown",
        ip: req.ip ?? req.socket?.remoteAddress,
      });
      apiError.unauthorized(res, "Ugyldig eller utløpt token");
      return;
    }

    if (result.status === "account_conflict") {
      // Konto-konflikt: bruker er autentisert med Clerk, men re-linking til eksisterende
      // app-bruker feilet. Dette er IKKE en auth-feil — returner 409 slik at frontend
      // ikke looper mellom /auth og /dashboard.
      logger.warn(
        { clerkUserId: result.clerkUserId },
        "Konto-konflikt: kunne ikke re-linke Clerk-bruker til eksisterende app-bruker",
      );
      await audit({
        actorUserId: result.clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: { reason: "account_conflict" },
        req,
      });
      res.status(409).json({
        error: "account_conflict",
        kode: "account_conflict",
        melding:
          "Det finnes allerede en konto med denne e-postadressen koblet til en annen innloggingsmetode. " +
          "Prøv å logge inn med den opprinnelige metoden (f.eks. Microsoft eller Google), eller kontakt support.",
      });
      return;
    }

    if (result.status === "turnstile_required") {
      // Manglende Turnstile-verifisering: bruker har gyldig Clerk-sesjon men har ikke bestått
      // human-check. Returner 403 med eksplisitt feiltype slik at frontend kan vise Turnstile.
      logger.warn(
        { clerkUserId: result.clerkUserId },
        "Turnstile-verifisering mangler for ny/fersk sesjon",
      );
      res.status(403).json({
        error: "turnstile_required",
        kode: "turnstile_required",
        melding: "Sikkerhetsverifisering kreves. Gå tilbake til innloggingssiden og prøv igjen.",
      });
      return;
    }

    if (result.status === "oauth_account_conflict") {
      // OAuth-konto-konflikt: samme Google/Microsoft-konto er allerede koblet til en annen bruker.
      // Dette er en sikkerhetsfeil — avvis registrering.
      logger.warn(
        { clerkUserId: result.clerkUserId, provider: result.provider },
        "OAuth-konto-konflikt: samme OAuth-konto er allerede koblet til en annen bruker",
      );
      await audit({
        actorUserId: result.clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: {
          reason: "oauth_account_conflict",
          provider: result.provider,
        },
        req,
      });

      // Enqueue sletting i retry-køen (dedup via jobId=clerk_<id>) for å bryte
      // innloggingsloopen uten race window mellom 409-respons og faktisk sletting.
      // Brukeren har ingen lokal data (registreringen ble avvist), så det er trygt.
      try {
        await enqueueClerkDeletionRetry({ clerkId: result.clerkUserId });
      } catch (err) {
        logger.error(
          { err, clerkUserId: result.clerkUserId },
          "Kunne ikke enqueue Clerk-sletting etter OAuth-konflikt",
        );
      }

      const providerName =
        result.provider === "google" ? "Google" : "Microsoft";
      res.status(409).json({
        error: "oauth_account_conflict",
        kode: "oauth_account_conflict",
        melding:
          `Denne ${providerName}-kontoen er allerede koblet til en annen StudyWise-bruker. ` +
          "Den eksisterende kontoen må slettes først før denne kontoen kan brukes. " +
          "Logg inn med den eksisterende kontoen og slett den, eller bruk en annen innloggingsmetode.",
        provider: result.provider,
      });
      return;
    }

    if (result.status === "oauth_metadata_missing") {
      logger.warn(
        { clerkUserId: result.clerkUserId, provider: result.provider },
        "OAuth-innlogging manglet stabil identifikator fra Clerk",
      );
      await audit({
        actorUserId: result.clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: {
          reason: "oauth_metadata_missing",
          provider: result.provider,
        },
        req,
      });
      res.status(409).json({
        error: "oauth_metadata_missing",
        kode: "oauth_metadata_missing",
        melding:
          "Innloggingskonflikt: vi mangler verifiserbar OAuth-identifikator fra innloggingsleverandoren. Prov igjen, eller kontakt support hvis problemet fortsetter.",
        provider: result.provider,
      });
      return;
    }

    if (result.status === "username_conflict") {
      // Brukernavn-konflikt: brukernavnet er allerede tatt av en annen bruker.
      logger.warn(
        { clerkUserId: result.clerkUserId, username: result.username },
        "Brukernavn-konflikt: brukernavnet er allerede tatt",
      );
      await audit({
        actorUserId: result.clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: { reason: "username_conflict", username: result.username },
        req,
      });
      res.status(409).json({
        error: "username_conflict",
        kode: "username_conflict",
        melding:
          `Brukernavnet "${result.username}" er allerede tatt. ` +
          "Gå tilbake til innloggingssiden og velg et annet brukernavn.",
        username: result.username,
      });
      return;
    }

    if (result.status === "user_deleted") {
      logger.info(
        { clerkUserId: result.clerkUserId },
        "Slettet bruker forsøkte å logge inn",
      );
      await audit({
        actorUserId: result.clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: { reason: "user_deleted" },
        req,
      });
      res.status(403).json({
        error: "user_deleted",
        kode: "user_deleted",
        melding:
          "Denne kontoen er slettet. Opprett en ny konto for å fortsette.",
      });
      return;
    }

    if (result.status === "user_locked") {
      logger.info(
        { clerkUserId: result.clerkUserId },
        "Låst bruker forsøkte å logge inn",
      );
      await audit({
        actorUserId: result.clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "security",
        outcome: "failure",
        metadata: { reason: "user_locked", begrunnelse: result.lockedReason ?? null },
        req,
      });
      // Generisk melding til brukeren — admin-begrunnelse er intern og skal
      // ikke eksponeres i URL, browserhistorikk eller referrer-header.
      const melding =
        "Kontoen din er midlertidig låst av en administrator. Kontakt support hvis du tror dette er en feil.";
      res.status(403).json({
        error: "user_locked",
        kode: "user_locked",
        melding,
      });
      return;
    }

    if (result.status === "user_sync_failed") {
      await audit({
        actorUserId: result.clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: { reason: "user_sync_failed" },
        req,
      });
      apiError.unauthorized(res, "Kunne ikke verifisere bruker");
      return;
    }
  } catch (err) {
    logger.warn(
      { err, requestId: (req as Request & { id?: string }).id },
      "requireAuth error",
    );
    await audit({
      actorUserId: "anonymous",
      action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
      category: "auth",
      outcome: "failure",
      metadata: { reason: "exception" },
      req,
    });
    apiError.unauthorized(res, "Autentisering feilet");
  }
}

export async function tryAuthenticateRequest(req: Request): Promise<boolean> {
  if (req.user?.id) {
    return true;
  }

  if (req.method === "OPTIONS") {
    return false;
  }

  try {
    const result = await resolveAuthentication(req);
    return result.status === "authenticated";
  } catch (error) {
    logger.warn(
      { err: error, requestId: (req as Request & { id?: string }).id },
      "tryAuthenticateRequest feilet",
    );
    return false;
  }
}

// Middleware for å knytte Canvas API-token til request
export const knyttCanvasToken = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
        return apiError.unauthorized(res);
    }
    try {
        const canvasTilkobling = await hentCanvasTilkoblingForBruker(req.user.id);
        if (!canvasTilkobling) {
            return apiError.unauthorized(res, "Ugyldig bruker");
        }

        if (!canvasTilkobling.canvasToken) {
            if (canvasTilkobling.decryptFailed) {
                res.status(401).json({
                    error: "canvas_token_invalid",
                    kode: "canvas_token_invalid",
                    melding:
                        "Canvas-tokenet ditt kunne ikke leses (sannsynligvis fordi krypteringsnøkkelen er endret). " +
                        "Gå til Innstillinger og lagre tokenet på nytt.",
                });
                return;
            }
            return apiError.unauthorized(res, "Brukeren har ikke tilknyttet et Canvas-token.");
        }

        req.canvasToken = canvasTilkobling.canvasToken;
        req.canvasBaseUrl = canvasTilkobling.canvasBaseUrl;
    } catch (error) {
        logger.error({ err: error, userId: req.user.id }, "Feil ved henting av Canvas token for bruker");
        return next(error);
    }
    next();
};

// Valgfri variant for ruter som kan bruke Canvas-kontekst, men skal fungere uten token.
export const knyttCanvasTokenValgfritt = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.id) {
        return apiError.unauthorized(res);
    }

    req.canvasToken = undefined;
    req.canvasBaseUrl = undefined;

    try {
        const canvasTilkobling = await hentCanvasTilkoblingForBruker(req.user.id);
        if (!canvasTilkobling) {
            return apiError.unauthorized(res, "Ugyldig bruker");
        }

        req.canvasToken = canvasTilkobling.canvasToken;
        req.canvasBaseUrl = canvasTilkobling.canvasBaseUrl;
    } catch (error) {
        logger.warn(
            { err: error, userId: req.user.id },
            "Kunne ikke hente Canvas token for valgfri KI-kontekst - fortsetter uten Canvas-data",
        );
    }

    next();
};

/**
 * Middleware som krever at Clerk-sesjonen ble opprettet nylig (siste 10 min).
 * Brukes for irreversible operasjoner (kontosletting) som step-up-sikkerhet.
 * Må monteres ETTER requireAuth.
 */
export async function requireRecentAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = hentBearerToken(req);
  if (!token) {
    apiError.forbidden(res, "Sesjonen er ugyldig. Logg inn på nytt.");
    return;
  }

  const sessionCreatedAt = await getClerkSessionCreatedAt(token);
  if (sessionCreatedAt === null) {
    apiError.forbidden(res, "Sesjonen er ugyldig. Logg inn på nytt.");
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - sessionCreatedAt > SENSITIVE_OP_MAX_SESSION_AGE_SEC) {
    res.status(403).json({
      error: "session_too_old",
      kode: "session_too_old",
      melding: "Du må logge inn på nytt før du kan utføre denne handlingen.",
      maxAgeSec: SENSITIVE_OP_MAX_SESSION_AGE_SEC,
    });
    return;
  }

  next();
}
