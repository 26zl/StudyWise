/*
 * Tester for use-auth-sync modulen.
 * Fokus på eksporterte hjelpefunksjoner: broadcastLogout og clearClientAuthState.
 * useAuthSync-hooken selv testes ikke her siden den krever ClerkProvider +
 * QueryClientProvider + Next.js-routing-kontekst.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// Mock eksterne avhengigheter
const clearDatadogUserMock = vi.fn();
vi.mock("@/app/components/layout/DatadogRum", () => ({
  clearDatadogUser: () => clearDatadogUserMock(),
  DatadogRum: () => null,
}));

const uiStoreResetMock = vi.fn();
vi.mock("../../store/uiStore", () => ({
  useUIStore: {
    getState: () => ({ reset: uiStoreResetMock }),
  },
}));

// Clerk useAuth mock — brukes av useAuthSync, ikke direkte i testene her
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: false, isSignedIn: false }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { broadcastLogout, clearClientAuthState } from "@/app/hooks/use-auth-sync";
import { AUTH_CHANNEL_NAME } from "common/auth";

describe("clearClientAuthState", () => {
  beforeEach(() => {
    clearDatadogUserMock.mockClear();
    uiStoreResetMock.mockClear();
  });

  it("rydder Datadog, UIStore og react-query-cache uten a slette gjeste-samtykke", () => {
    const queryClient = new QueryClient();
    // Legg inn noe state så vi kan se at det forsvinner
    queryClient.setQueryData(["foo"], { bar: 1 });
    expect(queryClient.getQueryData(["foo"])).toEqual({ bar: 1 });

    clearClientAuthState(queryClient);

    expect(clearDatadogUserMock).toHaveBeenCalledTimes(1);
    expect(uiStoreResetMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["foo"])).toBeUndefined();
  });
});

describe("broadcastLogout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sender 'logout' på BroadcastChannel og lukker kanalen", () => {
    const postMessageMock = vi.fn();
    const closeMock = vi.fn();
    const originalBC = globalThis.BroadcastChannel;

    // Mock BroadcastChannel som en enkel klasse
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      vi.fn().mockImplementation((name: string) => {
        expect(name).toBe(AUTH_CHANNEL_NAME);
        return { postMessage: postMessageMock, close: closeMock };
      });

    broadcastLogout();

    expect(postMessageMock).toHaveBeenCalledWith("logout");
    expect(closeMock).toHaveBeenCalledTimes(1);

    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      originalBC;
  });

  it("feiler stille hvis BroadcastChannel-konstruktøren kaster", () => {
    const originalBC = globalThis.BroadcastChannel;
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      vi.fn().mockImplementation(() => {
        throw new Error("not supported");
      });

    expect(() => broadcastLogout()).not.toThrow();

    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      originalBC;
  });

  it("er no-op når BroadcastChannel ikke finnes", () => {
    const originalBC = globalThis.BroadcastChannel;
    delete (globalThis as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;

    expect(() => broadcastLogout()).not.toThrow();

    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
      originalBC;
  });
});
