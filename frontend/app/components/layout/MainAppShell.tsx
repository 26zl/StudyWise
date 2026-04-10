/*
 * Felles app-shell: Providers (React Query, nuqs), Header, Toaster, CookieBanner, DatadogRum.
 * Brukes fra root layout slik at alle sider får samme chrome.
 * DatadogRum initialiseres direkte med build-time NEXT_PUBLIC_*; TelemetryConsent lazy-loades.
 *
 * Sidebar rendres her (ikke i sidekomponentene) slik at den forblir persistent
 * under navigering mellom /dashboard, /oversikt, /ai-breakdown og /account.
 */
"use client";

import { lazy, Suspense, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { useAuth } from "@clerk/nextjs";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/layout/header";
import { Toaster } from "@/app/components/ui/Toaster";
import { CookieBanner } from "@/app/components/layout/CookieBanner";
import { DatadogRum } from "@/app/components/layout/DatadogRum";
import { ErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import { LandingBackdrop } from "@/app/components/layout/LandingBackdrop";
import { Sidebar, type VisningType } from "@/app/components/dashboard/Sidebar";
import { Footer } from "@/app/components/layout/footer";
import { useMeg } from "@/app/auth/auth-api";
import { useCanvasUser } from "@/app/canvas/canvas-api";
import { useUIStore } from "@/app/store/uiStore";
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

const GYLDIGE_VISNINGER = [
  "chat",
  "canvas-announcements",
  "calendar",
  "canvas-courses",
  "canvas-assignments",
  "varslinger",
  "settings",
  "quiz",
  "flashcards",
  "admin",
] as const satisfies readonly VisningType[];

/**
 * Persistent sidebar-shell som forblir mountet under navigering mellom
 * /dashboard, /oversikt, /ai-breakdown og /account. Unngår flash/remount.
 */
function PersistentSidebarShell({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded: clerkLoaded, userId: clerkUserId } = useAuth();
  const megQuery = useMeg({ enabled: clerkLoaded && !!clerkUserId });
  const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
  const userQuery = useCanvasUser(megQuery.isSuccess && harCanvasToken);
  const isLoggingOut = useUIStore((state) => state.isLoggingOut);

  const brukernavn =
    userQuery.data?.name?.split(" ")[0] ||
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")[0];
  const brukerRolle = megQuery.data?.user?.role;

  // Leser dashboard sin aktive visning fra URL-param (?view=chat).
  // På andre ruter (oversikt, ai-breakdown, account) er view-param ikke i URL,
  // og defaulter til "chat" — sidebar bruker pathname for å markere riktig nav-element.
  const [viewParam] = useQueryState(
    "view",
    parseAsStringLiteral(GYLDIGE_VISNINGER).withDefault("chat").withOptions({ scroll: false }),
  );
  const aktivVisning: VisningType = pathname === "/dashboard" ? viewParam : "chat";

  const byttVisning = useCallback(
    (visning: VisningType) => {
      const url = visning === "chat" ? "/dashboard" : `/dashboard?view=${visning}`;
      router.push(url, { scroll: false });
    },
    [router],
  );

  // Ved utlogging: vis full-screen lastespinner uten sidebar
  if (isLoggingOut) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-full min-h-full min-w-0 flex-col text-slate-900 dark:text-slate-100 md:flex-row">
      <Sidebar
        aktivVisning={aktivVisning}
        byttVisning={byttVisning}
        brukernavn={brukernavn}
        brukerRolle={brukerRolle}
      />
      <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t("chat.appContentLabel")}>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
        <Footer />
      </section>
    </div>
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
            {usesSidebarShell ? (
              <PersistentSidebarShell>{children}</PersistentSidebarShell>
            ) : (
              children
            )}
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
