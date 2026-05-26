/*
 * Tester for CircuitBreaker
 * Verifiserer tilstandsoverganger, feilhåndtering og timeout-logikk
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker, CircuitBreakerError } from "../../utils/circuitBreaker.js";

// Mock logger for å unngå konsollutskrift under tester
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Initiell tilstand ---

  it("starter i CLOSED tilstand", () => {
    const cb = new CircuitBreaker("test");
    expect(cb.getState()).toBe("CLOSED");
  });

  // --- CLOSED tilstand ---

  it("forblir CLOSED etter vellykkede kall", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 });
    await cb.execute(() => Promise.resolve("ok"));
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("CLOSED");
  });

  it("returnerer resultatet fra vellykkede kall", async () => {
    const cb = new CircuitBreaker("test");
    const resultat = await cb.execute(() => Promise.resolve(42));
    expect(resultat).toBe(42);
  });

  it("videresender feil fra kallet uten å åpne circuit under terskel", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 });

    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow("feil");
    expect(cb.getState()).toBe("CLOSED");
  });

  // --- Overgang til OPEN ---

  it("åpner etter failureThreshold feil (standard: 5)", async () => {
    const cb = new CircuitBreaker("test");
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    }
    expect(cb.getState()).toBe("OPEN");
  });

  it("åpner etter egendefinert failureThreshold", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 2 });
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    expect(cb.getState()).toBe("CLOSED");
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");
  });

  it("teller bare feil som matcher isFailure-filteret", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 2,
      // Bare 5xx-feil teller
      isFailure: (error) => (error as { status?: number }).status === 500,
    });

    // 400-feil teller ikke
    const err400 = Object.assign(new Error("bad request"), { status: 400 });
    await expect(cb.execute(() => Promise.reject(err400))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(err400))).rejects.toThrow();
    expect(cb.getState()).toBe("CLOSED");

    // 500-feil teller
    const err500 = Object.assign(new Error("server error"), { status: 500 });
    await expect(cb.execute(() => Promise.reject(err500))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(err500))).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");
  });

  // --- OPEN tilstand ---

  it("avviser kall umiddelbart i OPEN tilstand med CircuitBreakerError", async () => {
    const cb = new CircuitBreaker("test-tjeneste", { failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow(CircuitBreakerError);
  });

  it("CircuitBreakerError inneholder circuit-navn", async () => {
    const cb = new CircuitBreaker("min-tjeneste", { failureThreshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();

    try {
      await cb.execute(() => Promise.resolve("ok"));
      expect.fail("Burde ha kastet feil");
    } catch (error) {
      expect(error).toBeInstanceOf(CircuitBreakerError);
      expect((error as CircuitBreakerError).circuit).toBe("min-tjeneste");
    }
  });

  it("CircuitBreakerError har korrekt name-egenskap", () => {
    const error = new CircuitBreakerError("test", "melding", 30);
    expect(error.name).toBe("CircuitBreakerError");
    expect(error.message).toBe("melding");
    expect(error.circuit).toBe("test");
    expect(error.retryAfterSeconds).toBe(30);
  });

  // --- Overgang OPEN → HALF_OPEN ---

  it("går til HALF_OPEN etter resetTimeout utløper", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 5000,
    });

    // Åpne circuit
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    // Spol fram tid forbi resetTimeout
    vi.advanceTimersByTime(5000);

    // Neste kall bør slippe gjennom (HALF_OPEN)
    const resultat = await cb.execute(() => Promise.resolve("ok"));
    expect(resultat).toBe("ok");
    expect(cb.getState()).toBe("CLOSED");
  });

  it("forblir OPEN før resetTimeout utløper", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 5000,
    });

    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();

    // Spol fram kun halvparten av timeout
    vi.advanceTimersByTime(2500);

    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow(CircuitBreakerError);
  });

  // --- HALF_OPEN tilstand ---

  it("vellykket kall i HALF_OPEN lukker circuit", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    });

    // Åpne circuit
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    // Spol fram til HALF_OPEN
    vi.advanceTimersByTime(1000);

    // Vellykket kall lukker circuit
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("CLOSED");
  });

  it("feilet kall i HALF_OPEN åpner circuit igjen", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    });

    // Åpne circuit
    await expect(cb.execute(() => Promise.reject(new Error("feil 1")))).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    // Spol fram til HALF_OPEN
    vi.advanceTimersByTime(1000);

    // Feilet kall åpner igjen
    await expect(cb.execute(() => Promise.reject(new Error("feil 2")))).rejects.toThrow("feil 2");
    expect(cb.getState()).toBe("OPEN");
  });

  // --- Nullstilling av feil-teller ---

  it("nullstiller feil-teller etter vellykket kall", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 3 });

    // 2 feil (under terskel)
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();

    // Vellykket kall nullstiller telleren
    await cb.execute(() => Promise.resolve("ok"));

    // 2 nye feil bør ikke åpne (teller starter fra 0 igjen)
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    expect(cb.getState()).toBe("CLOSED");
  });

  // --- Standard resetTimeout ---

  it("bruker standard resetTimeout på 30 sekunder", async () => {
    const cb = new CircuitBreaker("test", { failureThreshold: 1 });

    await expect(cb.execute(() => Promise.reject(new Error("feil")))).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    // 29 sekunder — fortsatt OPEN
    vi.advanceTimersByTime(29_000);
    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow(CircuitBreakerError);

    // 30 sekunder — bør gå til HALF_OPEN
    vi.advanceTimersByTime(1_000);
    const resultat = await cb.execute(() => Promise.resolve("tilbake"));
    expect(resultat).toBe("tilbake");
    expect(cb.getState()).toBe("CLOSED");
  });

  // --- Dynamisk Retry-After fra upstream-feil ---

  it("forlenger OPEN-vinduet til upstream Retry-After når feilen bærer en", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
    });

    // Feil med upstream Retry-After=600s (10 min) — skal honoreres
    await expect(
      cb.execute(() =>
        Promise.reject(Object.assign(new Error("vedlikehold"), { retryAfter: 600 })),
      ),
    ).rejects.toThrow();
    expect(cb.getState()).toBe("OPEN");

    // 30s (default reset) — fortsatt OPEN fordi upstream sa 600s
    vi.advanceTimersByTime(30_000);
    const e = await cb.execute(() => Promise.resolve("ok")).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(CircuitBreakerError);
    expect((e as CircuitBreakerError).retryAfterSeconds).toBeGreaterThan(500);

    // 600s totalt — nå skal breakeren prøve igjen
    vi.advanceTimersByTime(570_000);
    const resultat = await cb.execute(() => Promise.resolve("tilbake"));
    expect(resultat).toBe("tilbake");
  });

  it("capper dynamisk reset til maxDynamicResetMs", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
      maxDynamicResetMs: 60_000, // cap til 1 min
    });

    // Upstream sier 1 time, men cap'en gjør at vi prøver igjen etter 1 min
    await expect(
      cb.execute(() => Promise.reject(Object.assign(new Error("dos"), { retryAfter: 3600 }))),
    ).rejects.toThrow();

    vi.advanceTimersByTime(60_000);
    const resultat = await cb.execute(() => Promise.resolve("ok"));
    expect(resultat).toBe("ok");
  });

  it("nullstiller dynamisk reset etter suksess (HALF_OPEN → CLOSED)", async () => {
    const cb = new CircuitBreaker("test", {
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
    });

    // Åpne med upstream Retry-After=120
    await expect(
      cb.execute(() => Promise.reject(Object.assign(new Error("ned"), { retryAfter: 120 }))),
    ).rejects.toThrow();

    // Vent til half-open og bli oppe igjen
    vi.advanceTimersByTime(120_000);
    await cb.execute(() => Promise.resolve("ok"));
    expect(cb.getState()).toBe("CLOSED");

    // Neste utfall uten retryAfter — skal bruke default resetTimeoutMs (30s), ikke 120s
    await expect(cb.execute(() => Promise.reject(new Error("ny feil")))).rejects.toThrow();
    vi.advanceTimersByTime(30_000);
    const resultat = await cb.execute(() => Promise.resolve("oppe"));
    expect(resultat).toBe("oppe");
  });
});
