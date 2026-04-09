/**
 * Auth-sync mellom faner (Clerk).
 *
 * Bruker BroadcastChannel til å varsle andre faner om logout, og rydder klient-state
 * (React Query + zustand + Datadog) før eventuell redirect.
 */
import { useEffect, useRef } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { AUTH_CHANNEL_NAME } from "common/auth";
import { clearDatadogUser } from "@/app/components/layout/DatadogRum";
import { resetGjesteSamtykke } from "@/app/hooks/useCookieConsent";
import { useUIStore } from "../store/uiStore";

// Konstantverdier for BroadcastChannel (same-origin per spec )
const LOGOUT_MESSAGE = "logout";
const AUTH_PATH_PREFIXES = ["/dashboard", "/oversikt", "/ai-breakdown", "/account"] as const;

export function clearClientAuthState(queryClient: QueryClient): void {
    clearDatadogUser();
    void queryClient.cancelQueries();
    queryClient.clear();
    resetGjesteSamtykke();
    useUIStore.getState().reset();
}

function kreverAuthRedirect(pathname: string | null): boolean {
    if (!pathname) return false;
    return AUTH_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function clearAuthStateOgRedirectVedBehov(
    queryClient: QueryClient,
    pathname: string | null,
): void {
    clearClientAuthState(queryClient);
    if (kreverAuthRedirect(pathname)) {
        window.location.assign("/");
    }
}

/**
 * Varsle andre faner om utlogging.
 */
export function broadcastLogout() {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    try {
        const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
        channel.postMessage(LOGOUT_MESSAGE);
        channel.close();
    } catch {
        // BroadcastChannel ikke støttet eller feil - ignorer
    }
}

/**
 * Hook for å lytte etter utlogginger i andre faner.
 * Brukes i providers.tsx for å reagere på logout fra andre faner.
 */
export function useAuthSync() {
    const queryClient = useQueryClient();
    const clerk = useClerk();
    const { isLoaded, isSignedIn } = useAuth();
    const pathname = usePathname();
    const previousSignedInRef = useRef<boolean | null>(null);
    const externalLogoutInFlightRef = useRef(false);
    useEffect(() => {
        if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

        let channel: BroadcastChannel | null = null;
        try {
            channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
        } catch {
            return; // BroadcastChannel ikke støttet
        }
        channel.onmessage = (event) => {
            if (event.data === LOGOUT_MESSAGE) {
                if (externalLogoutInFlightRef.current) {
                    return;
                }

                externalLogoutInFlightRef.current = true;

                // En annen fane har logget ut - prøv å rydde Clerk-session også i denne fanen
                // før vi tømmer lokal state. Hvis Clerk feiler, rydder vi klient-state uansett.
                void clerk
                    .signOut()
                    .catch(() => {
                        // Ignorer — sesjonen kan allerede være ugyldig eller utilgjengelig.
                    })
                    .finally(() => {
                        externalLogoutInFlightRef.current = false;
                        clearAuthStateOgRedirectVedBehov(queryClient, window.location.pathname);
                    });
            }
        };
        return () => {
            channel?.close();
        };
    }, [clerk, queryClient]);

    useEffect(() => {
        if (!isLoaded) return;

        if (previousSignedInRef.current === null) {
            previousSignedInRef.current = isSignedIn;
            return;
        }

        if (previousSignedInRef.current && !isSignedIn) {
            if (!externalLogoutInFlightRef.current) {
                broadcastLogout();
            }
            clearAuthStateOgRedirectVedBehov(queryClient, pathname);
        }

        previousSignedInRef.current = isSignedIn;
    }, [isLoaded, isSignedIn, pathname, queryClient]);
}
