/**
 * Cloudflare Turnstile verifiseringstjeneste
 * Server-side validering av Turnstile-tokens
 */

import { logger } from "../utils/logger.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 5000;

interface TurnstileVerifyResponse {
  success: boolean;
  "error-codes"?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

export interface TurnstileResult {
  success: boolean;
  errorCodes?: string[];
}

/**
 * Sjekker om Turnstile er konfigurert
 */
export function isTurnstileConfigured(): boolean {
  return !!process.env.TURNSTILE_SECRET_KEY?.trim();
}

/**
 * Verifiserer et Turnstile-token mot Cloudflare API
 *
 * @param token - Turnstile-tokenet fra klienten
 * @param remoteIp - Valgfri IP-adresse for ekstra validering
 * @returns TurnstileResult med suksess-status og eventuelle feilkoder
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string,
): Promise<TurnstileResult> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;

  if (!secretKey) {
    logger.warn("Turnstile secret key ikke konfigurert");
    return { success: false, errorCodes: ["missing-secret-key"] };
  }

  if (!token || token.trim().length === 0) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);

    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
      formData.append("remoteip", remoteIp);
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.error(
        { status: response.status },
        "Turnstile API feilet",
      );
      return { success: false, errorCodes: ["api-error"] };
    }

    const result = (await response.json()) as TurnstileVerifyResponse;

    if (!result.success) {
      logger.info(
        { errorCodes: result["error-codes"] },
        "Turnstile-verifisering feilet",
      );
    }

    return {
      success: result.success,
      errorCodes: result["error-codes"],
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logger.error("Turnstile-verifisering timet ut");
      return { success: false, errorCodes: ["timeout"] };
    }

    logger.error({ err: error }, "Turnstile-verifisering feilet");
    return { success: false, errorCodes: ["internal-error"] };
  }
}
