/*
 * Tester for refund-logikken i Auth Turnstile-routeren.
 *
 * Viktig regresjonsdekning: shouldRefundRateLimit avgjør om en mislykket
 * Turnstile-verifisering skal frigi tokenet i rate-limit-bøtten. Hvis denne
 * blir for liberal (refunderer alt), åpner vi for at angripere kan brute-force
 * /verify uten å treffe grensen. Hvis den blir for streng (refunderer aldri),
 * ryker legitime brukere bak NAT/VPN ut etter noen widget-feil (Cloudflare 600010
 * → "invalid-input-response" på server-siden).
 */

import { describe, it, expect, vi } from "vitest";

// Mock øvrige tunge avhengigheter slik at modulen kan lastes uten Express/Mongo/Redis.
vi.mock("../../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("../../../middleware/rate-limit.js", () => ({
  rateLimitAuthTurnstile: Object.assign(
    (_req: unknown, _res: unknown, next: () => void) => next(),
    { reward: vi.fn() },
  ),
}));
vi.mock("../../../cache/redis.js", () => ({
  isRedisReady: () => false,
}));
vi.mock("../../../services/turnstile.service.js", () => ({
  isTurnstileConfigured: () => true,
  verifyTurnstileToken: vi.fn(),
}));

import {
  shouldRefundRateLimit,
  TRANSIENT_TURNSTILE_ERROR_CODES,
} from "../../../rutere/auth/authTurnstile.js";

describe("shouldRefundRateLimit", () => {
  describe("ingen koder", () => {
    it("returnerer false for undefined", () => {
      expect(shouldRefundRateLimit(undefined)).toBe(false);
    });

    it("returnerer false for tom liste", () => {
      // Tom liste betyr at vi ikke har nok info — refunderer ikke for å være
      // konservative (anti brute-force).
      expect(shouldRefundRateLimit([])).toBe(false);
    });
  });

  describe("kun transient-koder", () => {
    it("refunderer for invalid-input-response (Cloudflare token utløpt/ugyldig)", () => {
      expect(shouldRefundRateLimit(["invalid-input-response"])).toBe(true);
    });

    it("refunderer for timeout-or-duplicate (token allerede brukt)", () => {
      expect(shouldRefundRateLimit(["timeout-or-duplicate"])).toBe(true);
    });

    it("refunderer når flere transient-koder er rapportert", () => {
      expect(
        shouldRefundRateLimit(["invalid-input-response", "timeout-or-duplicate"]),
      ).toBe(true);
    });
  });

  describe("ekte feilkoder — skal IKKE refunderes (anti brute-force)", () => {
    // Disse representerer enten serverfeil eller mistenkelig bruk.
    // Hvis vi refunderer dem, mister vi rate-limit-beskyttelsen.
    it("refunderer ikke bad-request", () => {
      expect(shouldRefundRateLimit(["bad-request"])).toBe(false);
    });

    it("refunderer ikke missing-input-secret (vår konfigfeil)", () => {
      expect(shouldRefundRateLimit(["missing-input-secret"])).toBe(false);
    });

    it("refunderer ikke missing-input-response (request uten token)", () => {
      expect(shouldRefundRateLimit(["missing-input-response"])).toBe(false);
    });

    it("refunderer ikke internal-error (Cloudflare-feil — vil oppdage)", () => {
      expect(shouldRefundRateLimit(["internal-error"])).toBe(false);
    });

    it("refunderer ikke ukjent kode", () => {
      expect(shouldRefundRateLimit(["some-future-cloudflare-code"])).toBe(false);
    });
  });

  describe("blandinger — én ekte feil ødelegger refund", () => {
    // every() betyr at hvis EN kode ikke er transient, refunderes ikke.
    // Dette hindrer at en angriper smuglerinn ekte feil sammen med
    // transient-koder for å omgå rate-limit.
    it("refunderer ikke når transient blandes med ekte feil", () => {
      expect(
        shouldRefundRateLimit(["invalid-input-response", "bad-request"]),
      ).toBe(false);
    });

    it("refunderer ikke når transient blandes med ukjent kode", () => {
      expect(
        shouldRefundRateLimit(["timeout-or-duplicate", "unknown-code"]),
      ).toBe(false);
    });
  });
});

describe("TRANSIENT_TURNSTILE_ERROR_CODES", () => {
  it("inneholder eksakt de to forventede kodene", () => {
    // Lås innholdet — endringer her bør være bevisste og diskuterte.
    // Hvis listen vokser, kan brute-force-overflaten øke.
    expect(TRANSIENT_TURNSTILE_ERROR_CODES.size).toBe(2);
    expect(TRANSIENT_TURNSTILE_ERROR_CODES.has("invalid-input-response")).toBe(true);
    expect(TRANSIENT_TURNSTILE_ERROR_CODES.has("timeout-or-duplicate")).toBe(true);
  });
});
