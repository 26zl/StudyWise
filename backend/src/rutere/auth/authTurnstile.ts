import { Router, type Request, type Response } from "express";
import {
  AUTH_TURNSTILE_ACTION,
  AuthTurnstileVerifyRequestSchema,
  AuthTurnstileVerifyResponseSchema,
  AUTH_TURNSTILE_COOKIE_NAME,
} from "common/auth";
import { rateLimitAuthTurnstile } from "../../middleware/rate-limit.js";
import { apiError, sendZodError } from "../../utils/apiError.js";
import { isProd } from "../../utils/env.js";
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
  const candidates = [
    req.get("origin"),
    req.get("referer"),
  ];

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

  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    return forwardedHost.split(":")[0]?.trim().toLowerCase() ?? null;
  }

  return null;
}

router.post("/verify", rateLimitAuthTurnstile, async (req: Request, res: Response) => {
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
    logger.info(
      { errorCodes: turnstileResult.errorCodes },
      "Auth Turnstile-verifisering feilet",
    );
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

  res.cookie(
    AUTH_TURNSTILE_COOKIE_NAME,
    createAuthTurnstileCookieValue(),
    {
      ...getAuthTurnstileCookieOptions(),
      httpOnly: true,
      // Må være false på lokal http-dev, men alltid true i produksjon.
      secure: isProd,
    },
  );

  return res.json(
    AuthTurnstileVerifyResponseSchema.parse({
      success: true,
    }),
  );
});

export const authTurnstileRouter = router;
