"use client";

import { useEffect } from "react";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

/**
 * Initialiserer Datadog RUM (Real User Monitoring) for frontend.
 * Bruker React-pluginen for feilsporing; Next.js App Router brukes (ikke React Router).
 * Aktiveres kun når NEXT_PUBLIC_DD_RUM_APPLICATION_ID og NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN er satt.
 */
declare global {
    interface Window {
        __DD_RUM_CONFIG__?: { applicationId: string; clientToken: string; site: string };
    }
}

export function DatadogRum() {
    useEffect(() => {
        // Først fra server-injisert config (Vercel runtime), deretter fra build-time NEXT_PUBLIC_*
        const fromWindow = typeof window !== "undefined" ? window.__DD_RUM_CONFIG__ : undefined;
        const applicationId = fromWindow?.applicationId ?? process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
        const clientToken = fromWindow?.clientToken ?? process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;
        const site = fromWindow?.site ?? process.env.NEXT_PUBLIC_DD_SITE ?? "us5.datadoghq.com";
        if (!applicationId || !clientToken) return;

        // Guard mot dobbel init (React Strict Mode kjører useEffect to ganger i dev)
        if (datadogRum.getInitConfiguration()) return;

        try {
            datadogRum.init({
                applicationId,
                clientToken,
                site,
                service: "studywise-frontend",
                env: process.env.NODE_ENV ?? "development",
                version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "0.0.0",
                sessionSampleRate: 100,
                sessionReplaySampleRate: 20,
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
        } catch (err) {
            console.error("Datadog RUM init feilet — RUM deaktivert", err);
        }
    }, []);

    return null;
}

type DatadogUser = {
    id: string;
    studywiseUserId?: string;
};

/**
 * Setter bruker-ID i Datadog RUM for å koble sesjoner til brukere.
 * Kall denne etter innlogging (f.eks. i auth-provider eller dashboard).
 */
export function setDatadogUser(user: DatadogUser) {
    if (!datadogRum.getInitConfiguration()) return;
    datadogRum.setUser(user);
}

/**
 * Fjerner bruker-ID fra Datadog RUM ved utlogging.
 */
export function clearDatadogUser() {
    if (!datadogRum.getInitConfiguration()) return;
    datadogRum.clearUser();
}
