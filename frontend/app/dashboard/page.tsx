/*
 * Dashboard - Hovedsiden der "alt skjer"
 * Fungerer som en SPA (Single Page Application) container
 * URL-param ?view= styres av nuqs i DashboardView
 */
"use client";

import { Suspense } from "react";
import { DashboardView } from "@/app/components/dashboard/DashboardView";
import { LoadingView } from "@/app/components/ui/Loading";

export default function DashboardPage() {
  return (
    <Suspense fallback={<LoadingView text="Laster dashboard..." />}>
      <DashboardView />
    </Suspense>
  );
}
