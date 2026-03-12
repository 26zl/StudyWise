"use client";

import { useEffect } from "react";
import { datadogRum } from "@datadog/browser-rum";
import { reactPlugin } from "@datadog/browser-rum-react";

/**
 * Initialiserer Datadog RUM (Real User Monitoring) for frontend.
 * Bruker React-pluginen for feilsporing; Next.js App Router brukes (ikke React Router).
 * Aktiveres kun når NEXT_PUBLIC_DD_RUM_APPLICATION_ID og NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN er satt.
 */
export function DatadogRum() {
    useEffect(() => {
        const applicationId = process.env.NEXT_PUBLIC_DD_RUM_APPLICATION_ID;
        const clientToken = process.env.NEXT_PUBLIC_DD_RUM_CLIENT_TOKEN;
        if (!applicationId || !clientToken) return;

        try {
            datadogRum.init({
                applicationId,
                clientToken,
                site: process.env.NEXT_PUBLIC_DD_SITE ?? "us5.datadoghq.com",
                service: "studywise-frontend",
                env: process.env.NODE_ENV ?? "development",
                version: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "0.0.0",
                sessionSampleRate: 100,
                sessionReplaySampleRate: 20,
                defaultPrivacyLevel: "mask-user-input",
                trackUserInteractions: true,
                trackResources: true,
                trackLongTasks: true,
                plugins: [reactPlugin({ router: false })],
            });
        } catch (err) {
            console.error("Datadog RUM init feilet — RUM deaktivert", err);
        }
    }, []);

    return null;
}
