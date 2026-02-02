/*
 * Dashboard - Hovedsiden der "alt skjer"
 * Fungerer som en SPA (Single Page Application) container
 * URL-param ?view= brukes for å bevare visning ved refresh
 */
"use client";

import { Suspense } from "react";
import { DashboardView } from "../components/DashboardView";

// Loading fallback for Suspense (kreves av useSearchParams)
function DashboardLoader() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
    );
}

// Dashboard side komponent
export default function DashboardPage() {
    return (
        <Suspense fallback={<DashboardLoader />}>
            <DashboardView />
        </Suspense>
    );
}
