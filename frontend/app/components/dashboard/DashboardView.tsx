/*
 * DashboardView - Presentasjonskomponent for dashboardet
 * Inneholder all tilstand og logikk for visning av dashboardet
 * Bruker nuqs for URL-synkronisert view-state (?view=).
 */
"use client";

import { useEffect, Suspense, lazy, useCallback } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { useQueryClient } from "@tanstack/react-query";
import { LoadingView } from "@/app/components/ui/Loading";
import { type VisningType } from "@/app/components/dashboard/Sidebar";
import { SectionErrorBoundary } from "@/app/components/ui/ErrorBoundary";
import { useAuth } from "@clerk/nextjs";
import { useCanvasUser } from "@/app/canvas/canvas-api";
import { useMeg } from "@/app/auth/auth-api";
import { useAuthRedirect, skalRedirecteTilAuth } from "@/app/auth/authUtils";
import { getBrukerdataFeilmelding } from "@/app/lib/errorUtils";
import { prefetchCanvasData } from "@/app/canvas/canvas-api";
import { useUIStore } from "@/app/store/uiStore";
import { useVarslerPopups, useVarslerStateSync } from "@/app/hooks/useVarsler";
import { useChatHistoryPrefetch } from "@/app/hooks/useChatHistory";
import {
  SidebarAppErrorState,
  SidebarAppLoadingState,
  SidebarAppShell,
} from "@/app/components/layout/SidebarAppShell";
import { useLanguage } from "@/app/i18n";

const GYLDIGE_VISNINGER = [
  "chat",
  "canvas-announcements",
  "calendar",
  "canvas-courses",
  "canvas-assignments",
  "varslinger",
  "settings",
  "quiz",
] as const satisfies readonly VisningType[];

// Lazy load tunge komponenter for raskere initial page load
const ChatSection = lazy(() => import("@/app/components/chat/ChatSection").then(m => ({ default: m.ChatSection })));
const CanvasSection = lazy(() => import("@/app/components/canvas/canvasSection").then(m => ({ default: m.CanvasSection })));
const SettingsSection = lazy(() => import("@/app/components/dashboard/SettingsSection").then(m => ({ default: m.SettingsSection })));
const CalendarSection = lazy(() => import("@/app/calendar/CalendarSection").then(m => ({ default: m.CalendarSection })));
const VarslingerSection = lazy(() => import("@/app/components/dashboard/VarslingerSection").then(m => ({ default: m.VarslingerSection })));
const QuizView = lazy(() => import("@/app/components/ki/QuizView").then(m => ({ default: m.QuizView })));

function SectionLoader({ text }: { text?: string }) {
  const { t } = useLanguage();
  return <LoadingView text={text ?? t("common.loading")} fullPage={false} />;
}

// Hovedkomponent for dashboard-visningen
export function DashboardView() {
    const queryClient = useQueryClient();
    const { t } = useLanguage();

    const [aktivVisning, setView] = useQueryState(
        "view",
        parseAsStringLiteral(GYLDIGE_VISNINGER).withDefault("chat"),
    );
    const settAktivVisning = useCallback(
        (nyVisning: VisningType) => {
            setView(nyVisning === "chat" ? null : nyVisning);
        },
        [setView],
    );

    // Hent brukerdata og Canvas-token status – vent til Clerk er klar for å unngå 401 race
    const { isLoaded: clerkLoaded } = useAuth();
    const megQuery = useMeg({ enabled: clerkLoaded });
    const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
    const brukerQueryAktiv = megQuery.isSuccess && harCanvasToken;
    const userQuery = useCanvasUser(brukerQueryAktiv);
    const setCanvasContextSelection = useUIStore((state) => state.setCanvasContextSelection);

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

    // Hjelpefunksjon for å bestemme hvilken Canvas-visning som skal vises
    const hentCanvasVisning = () => {
        if (aktivVisning === "canvas-announcements") return "announcements";
        if (aktivVisning === "canvas-courses") return "courses";
        if (aktivVisning === "canvas-assignments") return "assignments";
        return "announcements";
    };
    // Skal redirecte til innlogging: vis spinner i stedet for feilmelding så bruker ikke ser rød boks i et splitt sekund
    if (skalRedirecteTilAuth(megQuery)) {
        return (
            <SidebarAppLoadingState
                aktivVisning={aktivVisning}
                byttVisning={settAktivVisning}
                label={t("dashboard.redirectingToLogin")}
            />
        );
    }
    // Feil uten brukerdata (f.eks. nettverksfeil, 429 rate limit): vis feilmelding og retry – useAuthRedirect håndterer auth-feil
    if (megQuery.isError && !megQuery.data?.user) {
        const feilmelding = getBrukerdataFeilmelding(megQuery.error);
        return (
            <SidebarAppErrorState
                aktivVisning={aktivVisning}
                byttVisning={settAktivVisning}
                message={feilmelding}
                onRetry={() => {
                    void megQuery.refetch();
                }}
            />
        );
    }
    // Én shell: sidebar + faner vises alltid; innhold = loader mens /me laster, deretter seksjoner (redirect/feil håndteres over)
    const visInnhold = !megQuery.isLoading;
    return (
        <SidebarAppShell
            aktivVisning={aktivVisning}
            byttVisning={settAktivVisning}
            brukernavn={megQuery.isLoading ? "..." : brukernavn}
        >
            {!visInnhold ? (
                <SectionLoader text={megQuery.isLoading ? t("dashboard.loadingUserData") : t("common.loading")} />
            ) : (
            <>
            {aktivVisning === "chat" && (
                <SectionErrorBoundary sectionName="KI-chat">
                    <Suspense fallback={<SectionLoader text={t("dashboard.loadingChat")} />}>
                        <ChatSection />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {aktivVisning === "calendar" && (
                <SectionErrorBoundary sectionName="kalender">
                    <Suspense fallback={<SectionLoader text={t("dashboard.loadingCalendar")} />}>
                        <CalendarSection harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {(aktivVisning === "canvas-announcements" ||
                aktivVisning === "canvas-courses" ||
                aktivVisning === "canvas-assignments") && (
                <SectionErrorBoundary sectionName="Canvas">
                    <Suspense fallback={<SectionLoader text={t("dashboard.loadingCanvas")} />}>
                        <CanvasSection startVisning={hentCanvasVisning()} harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}

            {aktivVisning === "varslinger" && (
                <SectionErrorBoundary sectionName="varslinger">
                    <Suspense fallback={<SectionLoader text={t("dashboard.loadingNotifications")} />}>
                        <VarslingerSection harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {aktivVisning === "settings" && (
                <SectionErrorBoundary sectionName="innstillinger">
                    <Suspense fallback={<SectionLoader text={t("dashboard.loadingSettings")} />}>
                        <SettingsSection
                            harCanvasToken={harCanvasToken}
                            lokalBrukerEpost={megQuery.data?.user?.email}
                            canvasBaseUrl={megQuery.data?.user?.canvasBaseUrl ?? undefined}
                        />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {aktivVisning === "quiz" && (
                <SectionErrorBoundary sectionName="quiz">
                    <Suspense fallback={<SectionLoader text={t("dashboard.loadingQuiz")} />}>
                        <QuizView />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            </>
            )}
        </SidebarAppShell>
    );
}
