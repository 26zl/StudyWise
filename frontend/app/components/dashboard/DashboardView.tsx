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

const GYLDIGE_VISNINGER = [
  "chat",
  "canvas-announcements",
  "calendar",
  "canvas-courses",
  "canvas-assignments",
  "varslinger",
  "settings",
] as const satisfies readonly VisningType[];

// Lazy load tunge komponenter for raskere initial page load
const ChatSection = lazy(() => import("@/app/components/chat/ChatSection").then(m => ({ default: m.ChatSection })));
const CanvasSection = lazy(() => import("@/app/components/canvas/canvasSection").then(m => ({ default: m.CanvasSection })));
const SettingsSection = lazy(() => import("@/app/components/dashboard/SettingsSection").then(m => ({ default: m.SettingsSection })));
const CalendarSection = lazy(() => import("@/app/calendar/CalendarSection").then(m => ({ default: m.CalendarSection })));
const VarslingerSection = lazy(() => import("@/app/components/dashboard/VarslingerSection").then(m => ({ default: m.VarslingerSection })));

function SectionLoader({ text = "Laster..." }: { text?: string }) {
  return <LoadingView text={text} fullPage={false} />;
}

// Hovedkomponent for dashboard-visningen
export function DashboardView() {
    const queryClient = useQueryClient();

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
    // Forsinket og utspredt prefetch — unngår at backend får 6+ samtidige kall ved cold start (Heroku/Vercel).
    const { prefetchChatHistory } = useChatHistoryPrefetch();
    useEffect(() => {
        if (!megQuery.isSuccess || !harCanvasToken) {
            if (megQuery.isSuccess) prefetchChatHistory(queryClient);
            return;
        }
        const t1 = setTimeout(() => prefetchCanvasData(queryClient), 600);
        const t2 = setTimeout(() => prefetchChatHistory(queryClient), 1200);
        return () => {
            clearTimeout(t1);
            clearTimeout(t2);
        };
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
                label="Sender deg til innlogging..."
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
                <SectionLoader text={megQuery.isLoading ? "Laster brukerdata..." : "Laster..."} />
            ) : (
            <>
            {aktivVisning === "chat" && (
                <SectionErrorBoundary sectionName="KI-chat">
                    <Suspense fallback={<SectionLoader text="Laster KI-chat..." />}>
                        <ChatSection />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {aktivVisning === "calendar" && (
                <SectionErrorBoundary sectionName="kalender">
                    <Suspense fallback={<SectionLoader text="Laster kalender..." />}>
                        <CalendarSection harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {(aktivVisning === "canvas-announcements" ||
                aktivVisning === "canvas-courses" ||
                aktivVisning === "canvas-assignments") && (
                <SectionErrorBoundary sectionName="Canvas">
                    <Suspense fallback={<SectionLoader text="Laster Canvas..." />}>
                        <CanvasSection startVisning={hentCanvasVisning()} harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}

            {aktivVisning === "varslinger" && (
                <SectionErrorBoundary sectionName="varslinger">
                    <Suspense fallback={<SectionLoader text="Laster varslinger..." />}>
                        <VarslingerSection harCanvasToken={harCanvasToken} />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            {aktivVisning === "settings" && (
                <SectionErrorBoundary sectionName="innstillinger">
                    <Suspense fallback={<SectionLoader text="Laster innstillinger..." />}>
                        <SettingsSection
                            harCanvasToken={harCanvasToken}
                            lokalBrukerEpost={megQuery.data?.user?.email}
                            canvasBaseUrl={megQuery.data?.user?.canvasBaseUrl ?? undefined}
                        />
                    </Suspense>
                </SectionErrorBoundary>
            )}
            </>
            )}
        </SidebarAppShell>
    );
}
