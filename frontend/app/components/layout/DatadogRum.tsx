"use client";

import { useEffect } from "react";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

type DatadogUser = {
    id: string;
    studywiseUserId?: string;
};

let pendingDatadogUser: DatadogUser | null = null;
let pendingClearUser = false;
let hasWarnedMissingConfig = false;

function flushPendingDatadogUser() {
    if (!datadogRum.getInitConfiguration()) return;

    if (pendingClearUser) {
        datadogRum.clearUser();
        pendingClearUser = false;
        pendingDatadogUser = null;
        return;
    }

    if (pendingDatadogUser) {
        datadogRum.setUser(pendingDatadogUser);
        pendingDatadogUser = null;
    }
}

/**
 * Initialiserer Datadog RUM (Real User Monitoring) for frontend.
 * Bruker React-pluginen for feilsporing; Next.js App Router brukes (ikke React Router).
 * Aktiveres kun når NEXT_PUBLIC_DD_RUM_APPLICATION_ID og NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN er satt.
 */
declare global {
    interface Window {
        __DD_RUM_INIT_DONE__?: boolean;
    }
}

export function DatadogRum() {
    useEffect(() => {
        const applicationId = process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
        const clientToken = process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;
        const site = process.env.NEXT_PUBLIC_DD_SITE ?? "us5.datadoghq.com";
        if (!applicationId || !clientToken) {
            if (!hasWarnedMissingConfig) {
                hasWarnedMissingConfig = true;
                console.warn("Datadog RUM er deaktivert fordi applicationId/clientToken mangler i denne deployen.");
            }
            return;
        }

        // Én init per window – unngår "SDK is loaded more than once" (Strict Mode / dobbel mount / Turbopack)
        if (typeof window !== "undefined" && window.__DD_RUM_INIT_DONE__) {
            flushPendingDatadogUser();
            return;
        }
        if (datadogRum.getInitConfiguration()) {
            if (typeof window !== "undefined") window.__DD_RUM_INIT_DONE__ = true;
            flushPendingDatadogUser();
            return;
        }

        if (typeof window !== "undefined") window.__DD_RUM_INIT_DONE__ = true;
        try {
            datadogRum.init({
                applicationId,
                clientToken,
                site,
                service: "studywise-frontend",
                env: process.env.NODE_ENV ?? "development",
                version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "0.0.0",
                sessionSampleRate: 100,
                sessionReplaySampleRate: 50,
                defaultPrivacyLevel: "mask-user-input",
                trackUserInteractions: true,
                trackResources: true,
                trackLongTasks: true,
                // Distribuert tracing: kobler frontend RUM-traces til backend APM-traces
                allowedTracingUrls: [
                    { match: /\/api\//, propagatorTypes: ["tracecontext"] },
                ],
                plugins: [reactPlugin({ router: false })],
            });
            flushPendingDatadogUser();
        } catch (err) {
            console.error("Datadog RUM init feilet — RUM deaktivert", err);
        }
    }, []);

    return null;
}

/**
 * Setter bruker-ID i Datadog RUM for å koble sesjoner til brukere.
 * Kall denne etter innlogging (f.eks. i auth-provider eller dashboard).
 */
export function setDatadogUser(user: DatadogUser) {
    if (!datadogRum.getInitConfiguration()) {
        pendingDatadogUser = user;
        pendingClearUser = false;
        return;
    }
    datadogRum.setUser(user);
}

/**
 * Fjerner bruker-ID fra Datadog RUM ved utlogging.
 */
export function clearDatadogUser() {
    if (!datadogRum.getInitConfiguration()) {
        pendingDatadogUser = null;
        pendingClearUser = true;
        return;
    }
    datadogRum.clearUser();
}
