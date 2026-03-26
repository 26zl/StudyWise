/**
 * Clerk-only auth middleware.
 * Verifies Bearer token with Clerk, syncs user to MongoDB, sets req.user and req.actorRole.
 */

import { Request, Response, NextFunction } from "express";
import { User } from "../database/models/User.js";
import { decrypt } from "../utils/kryptering.js";
import { logger } from "../utils/logger.js";
import { apiError } from "../utils/apiError.js";
import { normalizeCanvasBaseUrl } from "common/auth";
import type { UserRole } from "common/auth";
import type { IUser } from "../database/models/User.js";
import { getClerkUserIdFromToken, findOrCreateUserByClerkId, isAccountConflict } from "../rutere/auth/clerkAuth.js";
import { audit, AUDIT_ACTIONS } from "../utils/auditLog.js";
import { checkSecurityThresholds } from "../utils/securityAlert.js";

const hentBearerToken = (req: Request): string | null => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const [type, token] = authHeader.split(" ");
  if (type !== "Bearer" || !token) return null;
  return token;
};

const hentClerkProxyToken = (req: Request): string | null => {
  const header = req.headers["x-clerk-auth-token"];
  if (typeof header === "string") {
    const token = header.trim();
    return token || null;
  }
  if (Array.isArray(header)) {
    const token = header.find((value) => typeof value === "string" && value.trim());
    return token?.trim() || null;
  }
  return null;
};

const hentAuthToken = (req: Request): string | null => {
  return hentBearerToken(req) ?? hentClerkProxyToken(req);
};

const DEFAULT_ROLE: UserRole = "user";

export interface CanvasTilkobling {
  canvasToken?: string;
  canvasBaseUrl?: string;
}

/**
 * Henter (og dekrypterer) Canvas-tilkobling for en bruker.
 *
 * Returnerer token + base URL hvis brukeren har lagret token; ellers null/undefined felter.
 */
export async function hentCanvasTilkoblingForBruker(
  userId: string,
): Promise<CanvasTilkobling | null> {
  const user = await User.findById(userId).select("+canvasApiToken");
  if (!user) {
    return null;
  }

  return {
    canvasToken: user.canvasApiToken ? decrypt(user.canvasApiToken) : undefined,
    canvasBaseUrl: user.canvasBaseUrl
      ? normalizeCanvasBaseUrl(user.canvasBaseUrl)
      : undefined,
  };
}

/**
 * Clerk-only auth: requires Authorization: Bearer <clerk_session_token>.
 * Verifies token, finds or creates user by clerkId, sets req.user and req.actorRole.
 * On failure: audits token_verification_failure and returns 401.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const token = hentAuthToken(req);
  if (!token) {
    apiError.unauthorized(res, "Mangler autentiseringstoken");
    return;
  }

  try {
    const t0 = Date.now();
    const clerkUserId = await getClerkUserIdFromToken(token);
    const tClerk = Date.now();
    if (!clerkUserId) {
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

    const userResult = await findOrCreateUserByClerkId(clerkUserId);
    const tDb = Date.now();

    if (isAccountConflict(userResult)) {
      // Konto-konflikt: bruker er autentisert med Clerk, men re-linking til eksisterende
      // app-bruker feilet. Dette er IKKE en auth-feil — returner 409 slik at frontend
      // ikke looper mellom /auth og /dashboard.
      logger.warn(
        { clerkUserId, email: userResult.email },
        "Konto-konflikt: kunne ikke re-linke Clerk-bruker til eksisterende app-bruker",
      );
      await audit({
        actorUserId: clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: { reason: "account_conflict", email: userResult.email },
        req,
      });
      apiError.conflict(res,
        "Det finnes allerede en konto med denne e-postadressen koblet til en annen innloggingsmetode. " +
        "Prøv å logge inn med den opprinnelige metoden (f.eks. Microsoft eller Google), eller kontakt support.",
      );
      return;
    }

    if (!userResult) {
      await audit({
        actorUserId: clerkUserId,
        action: AUDIT_ACTIONS.TOKEN_VERIFICATION_FAILURE,
        category: "auth",
        outcome: "failure",
        metadata: { reason: "user_sync_failed" },
        req,
      });
      apiError.unauthorized(res, "Kunne ikke verifisere bruker");
      return;
    }

    const user = userResult;

    logger.debug(
      { clerkMs: tClerk - t0, dbMs: tDb - tClerk, totalAuthMs: tDb - t0, url: req.originalUrl },
      "auth-timing",
    );

    const role = (user.role ?? DEFAULT_ROLE) as UserRole;
    req.user = { id: user._id.toString() };
    (req as Request & { actorRole: UserRole }).actorRole = role;
    (req as Request & { authenticatedUser?: IUser }).authenticatedUser = user;
    next();
  } catch (err) {
    logger.warn({ err, requestId: (req as Request & { id?: string }).id }, "requireAuth error");
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
