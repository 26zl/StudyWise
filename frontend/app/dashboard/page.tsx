/*
 * Dashboard - Hovedsiden der "alt skjer"
 * Fungerer som en SPA (Single Page Application) container
 * URL-param ?view= styres av nuqs i DashboardView
 */
"use client";

import { Suspense } from "react";
import { DashboardView } from "@/app/components/dashboard/DashboardView";
import { LoadingView } from "@/app/components/ui/Loading";
import { useLanguage } from "@/app/i18n";

function DashboardFallback() {
  const { t } = useLanguage();
  return <LoadingView text={t("dashboard.loading")} />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardView />
    </Suspense>
  );
}
