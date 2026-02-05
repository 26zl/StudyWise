import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AUTH_CHANNEL_NAME } from "common/auth";

// Konstantverdier for BroadcastChannel
const LOGOUT_MESSAGE = "logout";
const LOGIN_MESSAGE = "login";

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
 * Varsle andre faner om innlogging.
 */
export function broadcastLogin() {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    try {
        const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
        channel.postMessage(LOGIN_MESSAGE);
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
    useEffect(() => {
        if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

        let channel: BroadcastChannel;
        try {
            channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
        } catch {
            return; // BroadcastChannel ikke støttet
        }
        channel.onmessage = (event) => {
            if (event.data === LOGOUT_MESSAGE) {
                // En annen fane har logget ut - rydd opp og redirect
                queryClient.clear();
                window.location.href = "/";
            } else if (event.data === LOGIN_MESSAGE) {
                // En annen fane har logget inn - oppdater queries og redirect til dashboard
                queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
                window.location.href = "/dashboard";
            }
        };
        return () => {
            channel.close();
        };
    }, [queryClient]);
}
