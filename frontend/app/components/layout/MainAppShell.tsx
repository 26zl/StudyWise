/*
 * Felles app-shell: Providers (React Query, nuqs), Header, Toaster, CookieBanner, DatadogRum.
 * Brukes fra root layout slik at alle sider får samme chrome.
 * DatadogRum initialiseres direkte med build-time NEXT_PUBLIC_*; TelemetryConsent lazy-loades.
 */
"use client";

import { lazy, Suspense } from "react";
import { usePathname } from "next/navigation";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/layout/header";
import { Toaster } from "@/app/components/ui/Toaster";
import { CookieBanner } from "@/app/components/layout/CookieBanner";
import { DatadogRum } from "@/app/components/layout/DatadogRum";
import { ErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import type { Language } from "@/app/i18n/types";
import { useLanguage } from "@/app/i18n";

const TelemetryConsent = lazy(() =>
  import("@/app/components/layout/TelemetryConsent").then((m) => ({ default: m.TelemetryConsent })));

function SkipToContentLink() {
  const { t } = useLanguage();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white dark:focus:bg-white dark:focus:text-slate-900"
    >
      {t("common.accessibility.skipToContent")}
    </a>
  );
}

export function MainAppShell({
  children,
  clerkPublishableKey,
  initialLanguage,
}: {
  children: React.ReactNode;
  clerkPublishableKey?: string | null;
  initialLanguage: Language;
}) {
  const pathname = usePathname();
  const usesSidebarShell =
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/oversikt" ||
    pathname === "/ai-breakdown";

  return (
    <Providers clerkPublishableKey={clerkPublishableKey} initialLanguage={initialLanguage}>
      <div className="flex flex-col min-h-screen">
        <SkipToContentLink />
        <Header />
        <main
          id="main-content"
          tabIndex={-1}
          className={`flex-1 min-h-0 relative flex flex-col outline-none ${usesSidebarShell ? "overflow-y-hidden" : "overflow-y-auto"}`}
        >
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
      </div>
      <Toaster />
      <DatadogRum />
      <Suspense fallback={null}>
        <TelemetryConsent />
      </Suspense>
      <CookieBanner />
    </Providers>
  );
}
