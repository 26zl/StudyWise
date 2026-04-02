"use client";

import { useEffect } from "react";

type DatadogUser = {
    id: string;
    studywiseUserId?: string;
};

let pendingDatadogUser: DatadogUser | null = null;
let pendingClearUser = false;

// Lazy-referanse til datadogRum — settes ved første dynamiske import.
// Unngår at @datadog/browser-rum evalueres flere ganger av Turbopack/Strict Mode
// som forårsaker "SDK is loaded more than once"-advarsel.
let ddRum: typeof import("@datadog/browser-rum").datadogRum | null = null;
let ddReactPlugin: typeof import("@datadog/browser-rum-react").reactPlugin | null = null;
let ddImportPromise: Promise<void> | null = null;

async function loadDatadogModules() {
    if (ddRum) return;
    if (ddImportPromise) {
        await ddImportPromise;
        return;
    }
    ddImportPromise = (async () => {
        const [rumModule, reactModule] = await Promise.all([
            import("@datadog/browser-rum"),
            import("@datadog/browser-rum-react"),
        ]);
        ddRum = rumModule.datadogRum;
        ddReactPlugin = reactModule.reactPlugin;
    })();
    await ddImportPromise;
}

function flushPendingDatadogUser() {
    if (!ddRum?.getInitConfiguration()) return;

    if (pendingClearUser) {
        ddRum.clearUser();
        pendingClearUser = false;
        pendingDatadogUser = null;
        return;
    }

    if (pendingDatadogUser) {
        ddRum.setUser(pendingDatadogUser);
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
            return;
        }

        // Én init per window — unngår dobbel init i Strict Mode / Turbopack
        if (typeof window !== "undefined" && window.__DD_RUM_INIT_DONE__) {
            flushPendingDatadogUser();
            return;
        }

        void loadDatadogModules().then(() => {
            if (!ddRum || !ddReactPlugin) return;

            if (ddRum.getInitConfiguration()) {
                if (typeof window !== "undefined") window.__DD_RUM_INIT_DONE__ = true;
                flushPendingDatadogUser();
                return;
            }

            if (typeof window !== "undefined") window.__DD_RUM_INIT_DONE__ = true;
            try {
                ddRum.init({
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
                    plugins: [ddReactPlugin({ router: false }) as import("@datadog/browser-rum").RumPlugin],
                });
                flushPendingDatadogUser();
            } catch {
                if (typeof window !== "undefined") {
                    window.__DD_RUM_INIT_DONE__ = false;
                }
            }
        });
    }, []);

    return null;
}

/**
 * Setter bruker-ID i Datadog RUM for å koble sesjoner til brukere.
 * Kall denne etter innlogging (f.eks. i auth-provider eller dashboard).
 */
export function setDatadogUser(user: DatadogUser) {
    if (!ddRum?.getInitConfiguration()) {
        pendingDatadogUser = user;
        pendingClearUser = false;
        return;
    }
    ddRum.setUser(user);
}

/**
 * Fjerner bruker-ID fra Datadog RUM ved utlogging.
 */
export function clearDatadogUser() {
    if (!ddRum?.getInitConfiguration()) {
        pendingDatadogUser = null;
        pendingClearUser = true;
        return;
    }
    ddRum.clearUser();
}
