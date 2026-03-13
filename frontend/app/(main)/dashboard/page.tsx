/*
 * Dashboard - Hovedsiden der "alt skjer"
 * Fungerer som en SPA (Single Page Application) container
 * URL-param ?view= styres av nuqs i DashboardView
 */
"use client";

import { Suspense } from "react";
import { DashboardView } from "@/app/components/dashboard/DashboardView";
import { LoadingSpinner } from "@/app/components/ui/LoadingSpinner";

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center bg-slate-50 p-8 dark:bg-slate-950">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner />
            <p className="text-sm text-slate-500 dark:text-slate-400">Laster dashboard...</p>
          </div>
        </div>
      }
    >
      <DashboardView />
    </Suspense>
  );
}
