import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { AUTH_CHANNEL_NAME } from "common/auth";
import { clearDatadogUser } from "../components/DatadogRum";
import { useUIStore } from "../store/uiStore";

// Konstantverdier for BroadcastChannel (same-origin per spec )
const LOGOUT_MESSAGE = "logout";

export function clearClientAuthState(queryClient: QueryClient): void {
    clearDatadogUser();
    queryClient.clear();
    useUIStore.getState().reset();
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
    const { isLoaded, isSignedIn } = useAuth();
    const previousSignedInRef = useRef<boolean | null>(null);
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
                // En annen fane har logget ut - rydd opp og redirect
                clearClientAuthState(queryClient);
                window.location.assign("/");
            }
        };
        return () => {
            channel?.close();
        };
    }, [queryClient]);

    useEffect(() => {
        if (!isLoaded) return;

        if (previousSignedInRef.current === null) {
            previousSignedInRef.current = isSignedIn;
            return;
        }

        if (previousSignedInRef.current && !isSignedIn) {
            broadcastLogout();
            clearClientAuthState(queryClient);
            window.location.assign("/");
        }

        previousSignedInRef.current = isSignedIn;
    }, [isLoaded, isSignedIn, queryClient]);
}
