/**
 * Express-rutere for Turnstile-verifisering på auth-flyter (sign-up, sign-in).
 * Setter en kortlevd cookie ved bestått verifisering så Clerk-flowen kan fortsette.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import {
  AUTH_TURNSTILE_ACTION,
  AuthTurnstileVerifyRequestSchema,
  AuthTurnstileVerifyResponseSchema,
  AUTH_TURNSTILE_COOKIE_NAME,
} from "common/auth";
import { validateAuthTurnstileCookieValue } from "common/auth-server";
import { rateLimitAuthTurnstile } from "../../middleware/rate-limit.js";
import { apiError, sendZodError } from "../../utils/apiError.js";
import { isProd, turnstileEnabled } from "../../utils/env.js";

/**
 * Wrapper rundt rateLimitAuthTurnstile som hopper over rate-limit-budsjettet
 * når Turnstile er globalt deaktivert. Uten dette vil 10/10min-grensen være
 * aktiv på endepunkter som umiddelbart returnerer success — typisk USN-nett
 * (NAT/VPN) brenner gjennom budsjettet på sign-up-flow med flere studenter
 * bak samme utgående IP, og brukeren får 429 før kontoen kan opprettes.
 */
function rateLimitAuthTurnstileSkippableNaarDeaktivert(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!turnstileEnabled) {
    next();
    return;
  }
  void rateLimitAuthTurnstile(req, res, next);
}
import { logger } from "../../utils/logger.js";
import { isTurnstileConfigured, verifyTurnstileToken } from "../../services/turnstile.service.js";
import {
  clearAuthTurnstileCookie,
  createAuthTurnstileCookieValue,
  getAuthTurnstileCookieOptions,
} from "../../utils/authTurnstileCookie.js";

const router = Router();

function getAuthTurnstileSecret(): string | undefined {
  return process.env.AUTH_TURNSTILE_SECRET_KEY?.trim();
}

function extractFrontendHostname(req: Request): string | null {
  const candidates = [req.get("origin"), req.get("referer")];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return new URL(candidate).hostname.trim().toLowerCase();
    } catch {
      // Ignorer ugyldige kandidatverdier og prøv neste fallback.
    }
  }

  return null;
}

router.post(
  "/verify",
  rateLimitAuthTurnstileSkippableNaarDeaktivert,
  async (req: Request, res: Response) => {
    // Turnstile globalt deaktivert: returner success umiddelbart uten å validere noe.
    // Frontend skal i utgangspunktet ikke kalle endepunktet i denne modusen, men hvis
    // en gammel klient gjør det får den et tomt OK-svar i stedet for en feilmelding.
    if (!turnstileEnabled) {
      return res.json(AuthTurnstileVerifyResponseSchema.parse({ success: true }));
    }

    const parseResult = AuthTurnstileVerifyRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      clearAuthTurnstileCookie(res);
      return sendZodError(res, parseResult.error, "Auth Turnstile");
    }

    const authTurnstileSecret = getAuthTurnstileSecret();
    if (!isTurnstileConfigured(authTurnstileSecret)) {
      logger.error("Auth Turnstile er ikke konfigurert");
      clearAuthTurnstileCookie(res);
      return apiError.serviceUnavailable(res, "Auth Turnstile");
    }

    const clientIp = req.ip || req.socket?.remoteAddress;
    const turnstileResult = await verifyTurnstileToken(
      parseResult.data.turnstileToken,
      clientIp,
      authTurnstileSecret,
    );

    if (!turnstileResult.success) {
      logger.info({ errorCodes: turnstileResult.errorCodes }, "Auth Turnstile-verifisering feilet");
      clearAuthTurnstileCookie(res);
      return apiError.badRequest(res, "Verifisering feilet. Prøv igjen.");
    }

    const expectedHostname = extractFrontendHostname(req);
    if (!expectedHostname) {
      logger.warn("Manglende frontend-host ved Auth Turnstile-verifisering");
      clearAuthTurnstileCookie(res);
      return apiError.badRequest(res, "Ugyldig verifiseringsforespørsel.");
    }

    if (!turnstileResult.hostname || turnstileResult.hostname.toLowerCase() !== expectedHostname) {
      logger.warn(
        {
          expectedHostname,
          receivedHostname: turnstileResult.hostname,
        },
        "Auth Turnstile hostname samsvarer ikke med frontend-host",
      );
      clearAuthTurnstileCookie(res);
      return apiError.badRequest(res, "Verifisering feilet. Prøv igjen.");
    }

    if (turnstileResult.action !== AUTH_TURNSTILE_ACTION) {
      logger.warn(
        {
          expectedAction: AUTH_TURNSTILE_ACTION,
          receivedAction: turnstileResult.action,
        },
        "Auth Turnstile action samsvarer ikke med forventet auth-handling",
      );
      clearAuthTurnstileCookie(res);
      return apiError.badRequest(res, "Verifisering feilet. Prøv igjen.");
    }

    res.cookie(AUTH_TURNSTILE_COOKIE_NAME, createAuthTurnstileCookieValue(), {
      ...getAuthTurnstileCookieOptions(),
      httpOnly: true,
      // Må være false på lokal http-dev, men alltid true i produksjon.
      secure: isProd,
    });

    return res.json(
      AuthTurnstileVerifyResponseSchema.parse({
        success: true,
      }),
    );
  },
);

/**
 * GET /gate — Pre-flight sjekk av Turnstile-cookie (HMAC + utløp).
 * Forbruker IKKE nonce — det gjøres først i requireAuth ved brukeropprettelse/sesjon.
 * Frontend kaller dette før sensitive klient-side auth-operasjoner (OAuth, forgot-password)
 * for å sikre at bruker har bestått human-check.
 */
router.get(
  "/gate",
  rateLimitAuthTurnstileSkippableNaarDeaktivert,
  async (req: Request, res: Response) => {
    // Turnstile globalt deaktivert: rapporter alltid "verified" så frontend OAuth/forgot-flows
    // kan fortsette uten å vise sikkerhetsverifisering-feil.
    if (!turnstileEnabled) {
      res.json({ verified: true });
      return;
    }

    const rawCookie = req.headers.cookie;
    let cookieValue: string | undefined;
    if (rawCookie) {
      const match = rawCookie
        .split(";")
        .find((c) => c.trim().startsWith(`${AUTH_TURNSTILE_COOKIE_NAME}=`));
      cookieValue = match
        ? decodeURIComponent(match.split("=").slice(1).join("=").trim())
        : undefined;
    }

    const secret = process.env.AUTH_TURNSTILE_GATE_SECRET?.trim();
    if (!secret || !(await validateAuthTurnstileCookieValue(cookieValue, secret))) {
      apiError.forbidden(res, "Sikkerhetsverifisering kreves. Fullfør Turnstile-sjekken først.");
      return;
    }

    res.json({ verified: true });
  },
);

export const authTurnstileRouter = router;
