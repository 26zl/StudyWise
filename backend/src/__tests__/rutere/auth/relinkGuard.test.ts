/*
 * Tester for kryssmiljø re-link guard (relinkGuard.ts)
 * Dekker getCurrentClerkEnv, guardRelink: første relink, ping-pong cooldown,
 * dev-gate env mismatch, og prod-oppførsel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// In-memory mock for Redis-cache — holder state per test
const cacheStore = new Map<string, string>();

vi.mock("../../../cache/redis.js", () => ({
  getCache: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
  setCache: vi.fn(async (key: string, value: string) => {
    cacheStore.set(key, value);
  }),
}));

// Mutable isProd-flagg styres per test
const envMock = { isProd: false };
vi.mock("../../../utils/env.js", () => ({
  get isProd() {
    return envMock.isProd;
  },
}));

import {
  guardRelink,
  getCurrentClerkEnv,
  getRelinkState,
  RELINK_COOLDOWN_MS,
} from "../../../rutere/auth/relinkGuard.js";

const ORIGINAL_CLERK_KEY = process.env.CLERK_SECRET_KEY;

describe("getCurrentClerkEnv", () => {
  afterEach(() => {
    process.env.CLERK_SECRET_KEY = ORIGINAL_CLERK_KEY;
  });

  it("returnerer 'test' for sk_test_-nøkkel", () => {
    process.env.CLERK_SECRET_KEY = "sk_test_abc123";
    expect(getCurrentClerkEnv()).toBe("test");
  });

  it("returnerer 'live' for sk_live_-nøkkel", () => {
    process.env.CLERK_SECRET_KEY = "sk_live_xyz789";
    expect(getCurrentClerkEnv()).toBe("live");
  });

  it("returnerer 'unknown' når nøkkel mangler", () => {
    delete process.env.CLERK_SECRET_KEY;
    expect(getCurrentClerkEnv()).toBe("unknown");
  });

  it("returnerer 'unknown' for ugyldig prefiks", () => {
    process.env.CLERK_SECRET_KEY = "pk_test_noe";
    expect(getCurrentClerkEnv()).toBe("unknown");
  });
});

describe("guardRelink", () => {
  beforeEach(() => {
    cacheStore.clear();
    envMock.isProd = false;
    process.env.CLERK_SECRET_KEY = "sk_test_dev";
  });

  afterEach(() => {
    process.env.CLERK_SECRET_KEY = ORIGINAL_CLERK_KEY;
    vi.useRealTimers();
  });

  it("tillater første relink når forrige Clerk-miljø matcher nåværende miljø", async () => {
    const result = await guardRelink("user-1", "clerk-new", {
      previousClerkEnv: "test",
    });
    expect(result).toEqual({ blocked: false });

    const state = await getRelinkState("user-1");
    expect(state).not.toBeNull();
    expect(state?.clerkId).toBe("clerk-new");
    expect(state?.env).toBe("test");
    expect(state?.count).toBe(1);
  });

  it("blokkerer første relink i dev når forrige Clerk-miljø ikke kan verifiseres", async () => {
    const result = await guardRelink("user-ukjent", "clerk-new");

    expect(result).toEqual({
      blocked: true,
      reason: "dev_gate_env_mismatch",
      count: 1,
    });
  });

  it("blokkerer andre relink innen cooldown-vinduet (ping-pong)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    await guardRelink("user-2", "clerk-a", { previousClerkEnv: "test" });
    vi.advanceTimersByTime(RELINK_COOLDOWN_MS - 1000);
    const result = await guardRelink("user-2", "clerk-b", { previousClerkEnv: "test" });

    expect(result).toEqual({
      blocked: true,
      reason: "rate_limited_ping_pong",
      count: 2,
    });
  });

  it("tillater gjentatt relink til samme clerkId innen cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const first = await guardRelink("user-same", "clerk-same", {
      previousClerkEnv: "test",
    });
    vi.advanceTimersByTime(500);
    const second = await guardRelink("user-same", "clerk-same", {
      previousClerkEnv: "test",
    });

    expect(first).toEqual({ blocked: false });
    expect(second).toEqual({ blocked: false });

    const state = await getRelinkState("user-same");
    expect(state?.count).toBe(1);
    expect(state?.allowed).toBe(true);
  });

  it("tillater relink etter cooldown har utløpt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    await guardRelink("user-3", "clerk-a", { previousClerkEnv: "test" });
    vi.advanceTimersByTime(RELINK_COOLDOWN_MS + 1);
    const result = await guardRelink("user-3", "clerk-b", { previousClerkEnv: "test" });

    expect(result).toEqual({ blocked: false });
    const state = await getRelinkState("user-3");
    expect(state?.count).toBe(1); // teller resettes etter cooldown
  });

  it("blokkerer cross-env relink i dev selv når cooldown er utløpt (dev-gate)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    envMock.isProd = false;

    // Første relink i test-miljø
    process.env.CLERK_SECRET_KEY = "sk_test_dev";
    await guardRelink("user-4", "clerk-test", { previousClerkEnv: "test" });

    // Mer enn cooldown går — men nå bytter vi til live-miljø
    vi.advanceTimersByTime(RELINK_COOLDOWN_MS + 5_000);
    process.env.CLERK_SECRET_KEY = "sk_live_prod";
    const result = await guardRelink("user-4", "clerk-prod");

    expect(result).toMatchObject({
      blocked: true,
      reason: "dev_gate_env_mismatch",
    });
  });

  it("tillater cross-env relink i prod (dev-gate er inaktiv)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    envMock.isProd = true;

    process.env.CLERK_SECRET_KEY = "sk_test_dev";
    await guardRelink("user-5", "clerk-test", { previousClerkEnv: "test" });

    vi.advanceTimersByTime(RELINK_COOLDOWN_MS + 5_000);
    process.env.CLERK_SECRET_KEY = "sk_live_prod";
    const result = await guardRelink("user-5", "clerk-prod");

    expect(result).toEqual({ blocked: false });
  });

  it("teller øker ved gjentatte blokkerte forsøk innen cooldown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    await guardRelink("user-6", "clerk-a", { previousClerkEnv: "test" });
    vi.advanceTimersByTime(1000);
    const r2 = await guardRelink("user-6", "clerk-b", { previousClerkEnv: "test" });
    vi.advanceTimersByTime(1000);
    const r3 = await guardRelink("user-6", "clerk-c", { previousClerkEnv: "test" });

    expect(r2).toMatchObject({ blocked: true, count: 2 });
    expect(r3).toMatchObject({ blocked: true, count: 3 });
  });

  it("isolerer state per bruker", async () => {
    await guardRelink("user-a", "clerk-1", { previousClerkEnv: "test" });
    const result = await guardRelink("user-b", "clerk-2", { previousClerkEnv: "test" });
    expect(result).toEqual({ blocked: false });
  });

  it("håndterer korrupt JSON i Redis ved å behandle som 'ingen prior state'", async () => {
    cacheStore.set("auth:relink-state:user-corrupt", "{ikke gyldig json");
    const result = await guardRelink("user-corrupt", "clerk-new", {
      previousClerkEnv: "test",
    });
    expect(result).toEqual({ blocked: false });
  });

  it("tillater samme-env relink etter cooldown i dev", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    envMock.isProd = false;
    process.env.CLERK_SECRET_KEY = "sk_test_dev";

    await guardRelink("user-7", "clerk-a", { previousClerkEnv: "test" });
    vi.advanceTimersByTime(RELINK_COOLDOWN_MS + 1);
    const result = await guardRelink("user-7", "clerk-b", { previousClerkEnv: "test" });

    expect(result).toEqual({ blocked: false });
  });
});
