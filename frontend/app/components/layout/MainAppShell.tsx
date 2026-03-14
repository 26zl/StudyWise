/*
 * Felles app-shell: Providers (React Query, nuqs), Header, Toaster, CookieBanner, DatadogRum.
 * Brukes fra root layout slik at alle sider får samme chrome.
 */
"use client";

import { Providers } from "@/app/providers";
import { Header } from "@/app/components/layout/header";
import { Toaster } from "@/app/components/ui/Toaster";
import { CookieBanner } from "@/app/components/layout/CookieBanner";
import { TelemetryConsent } from "@/app/components/layout/TelemetryConsent";
import { DatadogRum } from "@/app/components/layout/DatadogRum";

export function MainAppShell({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="flex flex-col min-h-screen">
        <Header />
        <div className="flex-1 min-h-0 overflow-y-auto relative flex flex-col">
          {children}
        </div>
      </div>
      <Toaster />
      <DatadogRum />
      <TelemetryConsent />
      <CookieBanner />
    </Providers>
  );
}
