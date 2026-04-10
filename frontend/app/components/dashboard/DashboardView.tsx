/*
 * DashboardView - Presentasjonskomponent for dashboardet
 * Inneholder all tilstand og logikk for visning av dashboardet
 * Bruker nuqs for URL-synkronisert view-state (?view=).
 */
"use client";

import { useEffect, useRef, useState, Suspense, lazy, useCallback } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { useQueryClient } from "@tanstack/react-query";
import { LoadingView } from "@/app/components/ui/Loading";
import { FeilMelding } from "@/app/components/ui/FeilMelding";
import { type VisningType } from "@/app/components/dashboard/Sidebar";
import { SectionErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import { useAuth } from "@clerk/nextjs";
import { useCanvasUser } from "@/app/canvas/canvas-api";
import { useMeg } from "@/app/auth/auth-api";
import {
  useAuthRedirect,
  skalRedirecteTilAuth,
  useFatalAuthSignOut,
} from "@/app/auth/authUtils";
import { getBrukerdataFeilmelding } from "@/app/lib/errorUtils";
import { prefetchCanvasData } from "@/app/canvas/canvas-api";
import { useUIStore } from "@/app/store/uiStore";
import { useVarslerPopups, useVarslerStateSync } from "@/app/hooks/useVarsler";
import { useChatHistoryPrefetch } from "@/app/hooks/useChatHistory";
import {
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { useLanguage } from "@/app/i18n";
import type { MessageKey } from "@/app/i18n";
import { OnboardingModal } from "@/app/components/onboarding/OnboardingModal";
import { useOppdaterUIPreferanser } from "@/app/auth/auth-api";

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

// Lazy load tunge komponenter for raskere initial page load
const ChatSection = lazy(() => import("@/app/components/chat/ChatSection").then(m => ({ default: m.ChatSection })));
const CanvasSection = lazy(() => import("@/app/components/canvas/canvasSection").then(m => ({ default: m.CanvasSection })));
const SettingsSection = lazy(() => import("@/app/components/dashboard/SettingsSection").then(m => ({ default: m.SettingsSection })));
const CalendarSection = lazy(() => import("@/app/calendar/CalendarSection").then(m => ({ default: m.CalendarSection })));
const VarslingerSection = lazy(() => import("@/app/components/dashboard/VarslingerSection").then(m => ({ default: m.VarslingerSection })));
const QuizView = lazy(() => import("@/app/components/ki/QuizView").then(m => ({ default: m.QuizView })));
const AdminSection = lazy(() => import("@/app/components/admin/AdminSection").then(m => ({ default: m.AdminSection })));
const ONBOARDING_STORAGE_KEY_PREFIX = "studywise-onboarding-vist";

function getOnboardingStorageKey(userId: string): string {
    return `${ONBOARDING_STORAGE_KEY_PREFIX}:${userId}`;
}

function SectionLoader({
  text,
  translationKey = "common.loading.generic",
}: {
  text?: string;
  translationKey?: MessageKey;
}) {
  return <LoadingView text={text} translationKey={translationKey} fullPage={false} />;
}

/** Redirect-komponent: sender ikke-admin-brukere fra ?view=admin tilbake til chat. */
function AdminRedirectToChat({ settAktivVisning }: { settAktivVisning: (v: VisningType) => void }) {
    useEffect(() => {
        settAktivVisning("chat");
    }, [settAktivVisning]);
    return null;
}

// Hovedkomponent for dashboard-visningen
export function DashboardView() {
    const queryClient = useQueryClient();
    const { t } = useLanguage();

    const [aktivVisning, setView] = useQueryState(
        "view",
        parseAsStringLiteral(GYLDIGE_VISNINGER).withDefault("chat").withOptions({ scroll: false }),
    );
    const settAktivVisning = useCallback(
        (nyVisning: VisningType) => {
            setView(nyVisning === "chat" ? null : nyVisning);
        },
        [setView],
    );

    // Flytt fokus til hovedinnhold ved visningsbytte (WCAG 2.4.3)
    const harMountet = useRef(false);
    useEffect(() => {
        if (!harMountet.current) {
            harMountet.current = true;
            return;
        }
        const main = document.getElementById("main-content");
        main?.focus({ preventScroll: true });
    }, [aktivVisning]);

    // Hent brukerdata og Canvas-token status – vent til Clerk er klar for å unngå 401 race
    const { isLoaded: clerkLoaded, userId: clerkUserId } = useAuth();
    const megQuery = useMeg({ enabled: clerkLoaded && !!clerkUserId });
    const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
    const brukerQueryAktiv = megQuery.isSuccess && harCanvasToken;
    const userQuery = useCanvasUser(brukerQueryAktiv);
    const setCanvasContextSelection = useUIStore((state) => state.setCanvasContextSelection);
    const isLoggingOut = useUIStore((state) => state.isLoggingOut);

    useVarslerStateSync(megQuery.isSuccess, megQuery.data?.user?.varslerState);

    // Popup-varsler: én toast for nye uleste varsler, integrert med varslinger-siden
    useVarslerPopups(harCanvasToken, {
        onGåTilVarslinger: () => settAktivVisning("varslinger"),
    });

    // Synkroniser Canvas-kontekst preferanser fra backend til global state
    useEffect(() => {
        const prefs = megQuery.data?.user?.canvasContextPreferences;
        if (prefs) {
            setCanvasContextSelection(prefs);
        }
    }, [megQuery.data?.user?.canvasContextPreferences, setCanvasContextSelection]);

    useAuthRedirect(megQuery);
    // Prefetch Canvas og chat parallelt så snart /me er ferdig
    const { prefetchChatHistory } = useChatHistoryPrefetch();
    useEffect(() => {
        if (!megQuery.isSuccess) return;
        prefetchChatHistory(queryClient);
        if (harCanvasToken) {
            prefetchCanvasData(queryClient);
        }
    }, [megQuery.isSuccess, harCanvasToken, queryClient, prefetchChatHistory]);

    // Hent fornavn fra Canvas brukerdata
    const brukernavn =
        userQuery.data?.name?.split(" ")[0] ||
        megQuery.data?.user?.firstName ||
        megQuery.data?.user?.email?.split("@")?.[0];
    const brukerRolle = megQuery.data?.user?.role;

    // Hjelpefunksjon for å bestemme hvilken Canvas-visning som skal vises
    const hentCanvasVisning = () => {
        if (aktivVisning === "canvas-announcements") return "announcements";
        if (aktivVisning === "canvas-courses") return "courses";
        if (aktivVisning === "canvas-assignments") return "assignments";
        return "announcements";
    };
    // Onboarding-guide for nye brukere (konto + localStorage-fallback)
    const harSettOnboardingBackend = megQuery.data?.user?.uiPreferences?.hasSeenOnboarding === true;
    const lokalOnboardingNokkel = megQuery.data?.user?.id
        ? getOnboardingStorageKey(megQuery.data.user.id)
        : null;
    const [visOnboarding, settVisOnboarding] = useState(false);
    const oppdaterUI = useOppdaterUIPreferanser();
    useEffect(() => {
        if (!megQuery.isSuccess) return;
        const harSettLokalt =
            typeof window !== "undefined" &&
            lokalOnboardingNokkel !== null &&
            localStorage.getItem(lokalOnboardingNokkel) === "true";
        if (!harSettOnboardingBackend && !harSettLokalt) {
            settVisOnboarding(true);
        }
    }, [megQuery.isSuccess, harSettOnboardingBackend, lokalOnboardingNokkel]);

    const lukkOnboarding = useCallback(() => {
        settVisOnboarding(false);
        try {
            if (lokalOnboardingNokkel) {
                localStorage.setItem(lokalOnboardingNokkel, "true");
            }
        } catch {
            /* privat modus */
        }
        oppdaterUI.mutate({ hasSeenOnboarding: true });
    }, [lokalOnboardingNokkel, oppdaterUI]);

    const brukerdataFeilmelding = getBrukerdataFeilmelding(megQuery.error, t);

    // Fatale auth-feil (OAuth-konflikt, slettet konto): logg ut automatisk uten å vise feilmelding
    const erFatalAuthFeil = useFatalAuthSignOut(megQuery);

    // Auth-/brukerhåndteringsfeil: vis ren lastespinner UTEN dashboard-innhold (sidebar, meny osv.)
    // Brukeren skal aldri se dashboard-rammen ved auth-feil.
    if (isLoggingOut || skalRedirecteTilAuth(megQuery) || erFatalAuthFeil) {
        const label = skalRedirecteTilAuth(megQuery)
            ? t("common.loading.redirectingToSignIn")
            : t("common.loading.generic");
        return <LoadingView text={label} />;
    }

    // Feil uten brukerdata (f.eks. nettverksfeil, 429 rate limit): vis feilmelding og retry uten dashboard-ramme
    if (megQuery.isError && !megQuery.data?.user) {
        return (
            <div className="flex min-h-dvh flex-col items-center justify-center gap-5 p-4">
                <FeilMelding melding={brukerdataFeilmelding} />
                <button
                    type="button"
                    onClick={() => { void megQuery.refetch(); }}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
                >
                    {t("common.actions.retry")}
                </button>
            </div>
        );
    }
    // Vent på brukerdata før dashboard-skallet vises — forhindrer flash av dashboard ved auth-feil
    if (!megQuery.isSuccess) {
        return <LoadingView text={t("common.loading.userData")} />;
    }
    return (
        <SidebarAppShell
            aktivVisning={aktivVisning}
            byttVisning={settAktivVisning}
            brukernavn={brukernavn}
            brukerRolle={brukerRolle}
        >
            {(
            <>
            {visOnboarding && (
                <OnboardingModal onLukk={lukkOnboarding} />
            )}
            {aktivVisning === "chat" && (
                <SectionErrorBoundary sectionName={t("dashboard.sections.aiChat")}>
                    <Suspense fallback={<SectionLoader translationKey="common.loading.aiChat" />}>
                        <ChatSection />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {aktivVisning === "calendar" && (
                <SectionErrorBoundary sectionName={t("dashboard.sections.calendar")}>
                    <Suspense fallback={<SectionLoader translationKey="common.loading.calendar" />}>
                        <CalendarSection harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {(aktivVisning === "canvas-announcements" ||
                aktivVisning === "canvas-courses" ||
                aktivVisning === "canvas-assignments") && (
                <SectionErrorBoundary sectionName={t("dashboard.sections.canvas")}>
                    <Suspense fallback={<SectionLoader translationKey="common.loading.canvas" />}>
                        <CanvasSection startVisning={hentCanvasVisning()} harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}

            {aktivVisning === "varslinger" && (
                <SectionErrorBoundary sectionName={t("dashboard.sections.notifications")}>
                    <Suspense fallback={<SectionLoader translationKey="common.loading.notifications" />}>
                        <VarslingerSection harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {aktivVisning === "settings" && (
                <SectionErrorBoundary sectionName={t("dashboard.sections.settings")}>
                    <Suspense fallback={<SectionLoader translationKey="common.loading.settings" />}>
                        <SettingsSection
                            harCanvasToken={harCanvasToken}
                            lokalBrukerEpost={megQuery.data?.user?.email}
                            canvasBaseUrl={megQuery.data?.user?.canvasBaseUrl ?? undefined}
                            fornavn={megQuery.data?.user?.firstName ?? undefined}
                            etternavn={megQuery.data?.user?.lastName ?? undefined}
                            username={megQuery.data?.user?.username ?? undefined}
                            brukerRolle={brukerRolle}
                            browserPushPreferences={megQuery.data?.user?.browserPushPreferences}
                        />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {(aktivVisning === "quiz" || aktivVisning === "flashcards") && (
                <SectionErrorBoundary sectionName={t("dashboard.sections.quiz")}>
                    <Suspense fallback={<SectionLoader translationKey="common.loading.quiz" />}>
                        <QuizView harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {aktivVisning === "admin" && (
                megQuery.data?.user?.role === "admin" ? (
                <SectionErrorBoundary sectionName={t("dashboard.sections.admin")}>
                    <Suspense fallback={<SectionLoader text={t("admin.loading")} />}>
                        <AdminSection />
                    </Suspense>
                </SectionErrorBoundary>
                ) : (
                <AdminRedirectToChat settAktivVisning={settAktivVisning} />
                )
            )}
            </>
            )}
        </SidebarAppShell>
    );
}
