import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { checkForStaleClerkCookies, cleanupStaleClerkCookies } from "@/app/lib/devClerkCookieCheck";

const TEST_COOKIE_NAMES = [
  "__session",
  "__session_ZRVfikYr",
  "__session_OLDsuffix",
  "__clerk_db_jwt",
  "__clerk_db_jwt_ZRVfikYr",
  "__clerk_db_jwt_OLDsuffix",
  "__client_uat",
  "__client_uat_ZRVfikYr",
  "__refresh",
  "__refresh_ZRVfikYr",
] as const;

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/`;
}

function clearKnownCookies(): void {
  for (const name of TEST_COOKIE_NAMES) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

describe("devClerkCookieCheck", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    clearKnownCookies();
    env.NODE_ENV = "development";
  });

  afterEach(() => {
    clearKnownCookies();
    env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it("varsler ikke for normal mirrored Clerk-state med ett suffix og like verdier", () => {
    setCookie("__session", "same-session");
    setCookie("__session_ZRVfikYr", "same-session");
    setCookie("__clerk_db_jwt", "same-db");
    setCookie("__clerk_db_jwt_ZRVfikYr", "same-db");
    setCookie("__client_uat", "same-uat");
    setCookie("__client_uat_ZRVfikYr", "same-uat");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(checkForStaleClerkCookies()).toBe(false);
    expect(cleanupStaleClerkCookies()).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("varsler når samme Clerk-cookiefamilie har ulike verdier", () => {
    setCookie("__session", "current-session");
    setCookie("__session_ZRVfikYr", "stale-session");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(checkForStaleClerkCookies()).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("varsler når flere ulike suffix finnes samtidig", () => {
    setCookie("__session", "same-session");
    setCookie("__session_ZRVfikYr", "same-session");
    setCookie("__session_OLDsuffix", "same-session");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(checkForStaleClerkCookies()).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
