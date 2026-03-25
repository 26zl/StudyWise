/*
 * Felles app-shell: Providers (React Query, nuqs), Header, Toaster, CookieBanner, DatadogRum.
 * Brukes fra root layout slik at alle sider får samme chrome.
 * DatadogRum og TelemetryConsent lazy-loades for å redusere initial bundle.
 */
"use client";

import { lazy, Suspense } from "react";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/layout/header";
import { Toaster } from "@/app/components/ui/Toaster";
import { CookieBanner } from "@/app/components/layout/CookieBanner";
import type { Language } from "@/app/i18n/types";

const DatadogRum = lazy(() =>
  import("@/app/components/layout/DatadogRum").then((m) => ({ default: m.DatadogRum })));
const TelemetryConsent = lazy(() =>
  import("@/app/components/layout/TelemetryConsent").then((m) => ({ default: m.TelemetryConsent })));

export function MainAppShell({
  children,
  clerkPublishableKey,
  initialLanguage,
}: {
  children: React.ReactNode;
  clerkPublishableKey?: string | null;
  initialLanguage: Language;
}) {
  return (
    <Providers clerkPublishableKey={clerkPublishableKey} initialLanguage={initialLanguage}>
      <div className="flex flex-col min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white dark:focus:bg-white dark:focus:text-slate-900"
        >
          Hopp til innhold
        </a>
        <Header />
        <main id="main-content" tabIndex={-1} className="flex-1 min-h-0 overflow-y-auto relative flex flex-col outline-none">
          {children}
        </main>
      </div>
      <Toaster />
      <Suspense fallback={null}>
        <DatadogRum />
        <TelemetryConsent />
      </Suspense>
      <CookieBanner />
    </Providers>
  );
}
