/*
 * Felles app-shell: Providers (React Query, nuqs), Header, Toaster, CookieBanner, DatadogRum.
 * Brukes fra root layout slik at alle sider får samme chrome.
 * DatadogRum initialiseres direkte med build-time NEXT_PUBLIC_*; TelemetryConsent lazy-loades.
 */
"use client";

import { lazy, Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/layout/header";
import { Toaster } from "@/app/components/ui/Toaster";
import { CookieBanner } from "@/app/components/layout/CookieBanner";
import { DatadogRum } from "@/app/components/layout/DatadogRum";
import { ErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import { LandingBackdrop } from "@/app/components/layout/LandingBackdrop";
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
  nonce,
}: {
  children: React.ReactNode;
  clerkPublishableKey?: string | null;
  initialLanguage: Language;
  nonce?: string;
}) {
  useEffect(() => {
    console.log(
      "%c StudyWise ",
      "background: #2563eb; color: #fff; font-size: 18px; font-weight: bold; padding: 6px 16px; border-radius: 6px;",
    );
    console.log(
      "%cHei, konsoll-nerd! \u{1F44B}\nSer du etter noe spennende? Vi bygger StudyWise som bachelorprosjekt ved USN.\nFinn oss p\u00e5 GitHub: https://github.com/26zl/StudyWise",
      "color: #60a5fa; font-size: 13px;",
    );
  }, []);

  const pathname = usePathname();
  const usesSidebarShell =
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/oversikt" ||
    pathname === "/ai-breakdown" ||
    pathname === "/account" ||
    pathname.startsWith("/account/");

  return (
    <Providers clerkPublishableKey={clerkPublishableKey} initialLanguage={initialLanguage} nonce={nonce}>
      <LandingBackdrop />
      <div className={`relative z-10 flex flex-col ${usesSidebarShell ? "h-dvh overflow-hidden" : "min-h-dvh"}`}>
        <SkipToContentLink />
        <Header />
        <main
          id="main-content"
          tabIndex={-1}
          className={`flex-1 relative flex flex-col outline-none ${usesSidebarShell ? "min-h-0 overflow-hidden" : ""}`}
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
