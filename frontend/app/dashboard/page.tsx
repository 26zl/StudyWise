/*
 * Dashboard - Hovedsiden der "alt skjer"
 * Fungerer som en SPA (Single Page Application) container
 * URL-param ?view= styres av nuqs i DashboardView
 */
"use client";

import { Suspense } from "react";
import { DashboardView } from "../components/DashboardView";
import { LoadingSpinner } from "../components/LoadingSpinner";

export default function DashboardPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                    <LoadingSpinner />
                </div>
            }
        >
            <DashboardView />
        </Suspense>
    );
}
