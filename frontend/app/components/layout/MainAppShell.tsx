/*
 * Felles app-shell: Providers (React Query, nuqs), Header, Toaster, CookieBanner, DatadogRum.
 * Brukes fra root layout slik at alle sider får samme chrome.
 * DatadogRum initialiseres direkte med build-time NEXT_PUBLIC_*; TelemetryConsent lazy-loades.
 *
 * Sidebar rendres her (ikke i sidekomponentene) slik at den forblir persistent
 * under navigering mellom /dashboard, /oversikt, /ai-breakdown og /account.
 */
"use client";

import { lazy, Suspense, useEffect, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { useAuth, useUser } from "@clerk/nextjs";
import { ShieldAlert, X } from "lucide-react";
import { Providers } from "@/app/providers";
import { Header } from "@/app/components/layout/header";
import { Toaster } from "@/app/components/ui/Toaster";
import { CookieBanner } from "@/app/components/layout/CookieBanner";
import { DatadogRum } from "@/app/components/layout/DatadogRum";
import { PostHogAnalytics } from "@/app/components/layout/PostHogAnalytics";
import { SystemAnnouncementBanner } from "@/app/components/layout/SystemAnnouncementBanner";
import { CanvasStatusBanner } from "@/app/components/layout/CanvasStatusBanner";
import { CriticalServiceBanner } from "@/app/components/layout/CriticalServiceBanner";
import { TermsReacceptModal } from "@/app/components/layout/TermsReacceptModal";
import { ErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import { LandingBackdrop } from "@/app/components/layout/LandingBackdrop";
import { Sidebar, type VisningType } from "@/app/components/dashboard/Sidebar";
import { Footer } from "@/app/components/layout/footer";
import { useMeg } from "@/app/auth/auth-api";
import { useCanvasUser } from "@/app/canvas/canvas-api";
import { useUIStore } from "@/app/store/uiStore";
import { useActivityTracker } from "@/app/hooks/useActivityTracker";
import type { ActivityType } from "common/activity";
import type { Language } from "@/app/i18n/types";
import { useLanguage } from "@/app/i18n";
import {
  checkForStaleClerkCookies,
  installDevClerkResetHelper,
} from "@/app/lib/devClerkCookieCheck";

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

function BackupCodesBanner() {
  const { t } = useLanguage();
  const pathname = usePathname();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const [dismissed, setDismissed] = useState(false);
  const [dismissChecked, setDismissChecked] = useState(false);

  useEffect(() => {
    if (!authLoaded) return;
    if (!userId) {
      setDismissChecked(true);
      setDismissed(false);
      return;
    }

    try {
      setDismissed(localStorage.getItem(`studywise:backup-codes-banner:${userId}`) === "dismissed");
    } catch {
      setDismissed(false);
    } finally {
      setDismissChecked(true);
    }
  }, [authLoaded, userId]);

  const relevantPath =
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/oversikt" ||
    pathname === "/ai-breakdown";

  if (
    !relevantPath ||
    !authLoaded ||
    !userLoaded ||
    !userId ||
    !dismissChecked ||
    dismissed ||
    !user?.totpEnabled ||
    user.backupCodeEnabled
  ) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(`studywise:backup-codes-banner:${userId}`, "dismissed");
    } catch {
      // Lokal lagring kan være blokkert; dismiss varer da kun for denne renderingen.
    }
  };

  return (
    <div className="border-b border-amber-200 bg-amber-50/95 px-4 py-3 text-amber-950 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/90 dark:text-amber-50">
      <div className="mx-auto flex max-w-7xl items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm leading-6">
          <span className="font-semibold">{t("security.backupCodesBanner.title")}</span>{" "}
          <span className="text-amber-900 dark:text-amber-100">
            {t("security.backupCodesBanner.description")}
          </span>{" "}
          <Link
            href="/account"
            prefetch={false}
            className="font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
          >
            {t("security.backupCodesBanner.action")}
          </Link>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-900/70 dark:hover:text-amber-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{t("security.backupCodesBanner.dismiss")}</span>
        </button>
      </div>
    </div>
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
 * Utleder ActivityType for studietid-sporing fra rute + aktiv visning.
 * Returnerer null på ruter/visninger vi bevisst ikke teller som studietid
 * (landingsside, auth, kontoinnstillinger, admin, varslinger).
 */
function deriveActivityType(pathname: string, aktivVisning: VisningType): ActivityType | null {
  if (pathname === "/account" || pathname.startsWith("/account/")) return null;
  if (pathname === "/oversikt") return "oversikt";
  if (pathname === "/ai-breakdown") return "arbeidsplan";
  if (pathname.startsWith("/dashboard/bokmerker")) return "bokmerker";
  if (pathname.startsWith("/dashboard/samtalehistorikk")) return "chat";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    switch (aktivVisning) {
      case "chat":
        return "chat";
      case "calendar":
        return "kalender";
      case "canvas-announcements":
      case "canvas-courses":
      case "canvas-assignments":
        return "canvas";
      case "quiz":
        return "quiz";
      case "flashcards":
        return "flashcards";
      case "settings":
      case "admin":
      case "varslinger":
        return null;
      default:
        return "annet";
    }
  }
  return null;
}

/**
 * Persistent sidebar-shell som forblir mountet under navigering mellom
 * /dashboard, /oversikt, /ai-breakdown og /account. Unngår flash/remount.
 */
function PersistentSidebarShell({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded: clerkLoaded, userId: clerkUserId } = useAuth();
  const { isLoaded: clerkUserLoaded, user: clerkUser } = useUser();
  const megQuery = useMeg({ enabled: clerkLoaded && !!clerkUserId });
  const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
  const userQuery = useCanvasUser(megQuery.isSuccess && harCanvasToken);
  const isLoggingOut = useUIStore((state) => state.isLoggingOut);
  const clerkFallbackNavn =
    clerkUser?.firstName ||
    clerkUser?.fullName?.split(" ")[0] ||
    clerkUser?.primaryEmailAddress?.emailAddress?.split("@")[0];

  const brukernavn =
    userQuery.data?.name?.split(" ")[0] ||
    megQuery.data?.user?.firstName ||
    megQuery.data?.user?.email?.split("@")[0] ||
    clerkFallbackNavn;
  const brukerRolle = megQuery.data?.user?.role;
  const avklarerBruker =
    !clerkLoaded ||
    (!!clerkUserId &&
      (!clerkUserLoaded || ((megQuery.isPending || megQuery.isFetching) && !megQuery.data)));

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

  // Studietid-sporing: send heartbeat hvert 60s mens bruker er aktiv. Type utledes
  // fra rute + aktiv visning slik at /study-stats/today kan vise per-seksjon breakdown
  // senere. Kun når bruker er bekreftet autentisert for å unngå 401-støy.
  const activityType = deriveActivityType(pathname, aktivVisning);
  const trackerEnabled = !!clerkUserId && !isLoggingOut && megQuery.isSuccess;
  useActivityTracker(activityType, trackerEnabled);

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
        avklarerBruker={avklarerBruker}
        kanLoggUt={!!clerkUserId}
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
      "%cHei, konsoll-nerd! \u{1F44B}\nSer du etter noe spennende? Vi bygger StudyWise som bachelorprosjekt ved USN.\nFinn oss på GitHub: https://github.com/26zl/StudyWise",
      "color: #60a5fa; font-size: 13px;",
    );
    // Dev-only Clerk cookie hygiene: varsle ved blandet cookie-state og installer
    // en manuell reset-helper. Ikke muter cookies automatisk ved app-boot; det kan
    // skape race conditions mot Clerk-init og første /api/user/me-kall.
    checkForStaleClerkCookies();
    installDevClerkResetHelper();
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
        <SystemAnnouncementBanner />
        <CriticalServiceBanner />
        <CanvasStatusBanner />
        <BackupCodesBanner />
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
      <PostHogAnalytics />
      <Suspense fallback={null}>
        <TelemetryConsent />
      </Suspense>
      <CookieBanner />
      <TermsReacceptModal />
    </Providers>
  );
}
