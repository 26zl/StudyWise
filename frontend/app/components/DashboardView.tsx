/*
 * DashboardView - Presentasjonskomponent for dashboardet
 * Inneholder all tilstand og logikk for visning av dashboardet
 * Bruker nuqs for URL-synkronisert view-state (?view=).
 */
"use client";

import { useEffect, Suspense, lazy, useCallback } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { useQueryClient } from "@tanstack/react-query";
import { LoadingSpinner } from "./LoadingSpinner";
import { FeilMelding } from "./FeilMelding";
import { Sidebar, type VisningType } from "./Sidebar";
import { SectionErrorBoundary } from "./ErrorBoundary";
import { useCanvasUser } from "../canvas/canvas-api";
import { Footer } from "./footer";
import { useMeg } from "../auth/auth-api";
import { useAuthRedirect, skalRedirecteTilAuth } from "../auth/authUtils";
import { getBrukerdataFeilmelding } from "../lib/errorUtils";
import { prefetchCanvasData } from "../canvas/canvas-api";
import { useUIStore } from "../store/uiStore";
import { useVarslerPopups, useVarslerStateSync } from "../hooks/useVarsler";
import { useChatHistoryPrefetch } from "../hooks/useChatHistory";

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
const ChatSection = lazy(() => import("./ChatSection").then(m => ({ default: m.ChatSection })));
const CanvasSection = lazy(() => import("./canvasSection").then(m => ({ default: m.CanvasSection })));
const SettingsSection = lazy(() => import("./SettingsSection").then(m => ({ default: m.SettingsSection })));
const CalendarSection = lazy(() => import("../calendar/CalendarSection").then(m => ({ default: m.CalendarSection })));
const VarslingerSection = lazy(() => import("./VarslingerSection").then(m => ({ default: m.VarslingerSection })));

// Loading fallback komponent
function SectionLoader({ text = "Laster..." }: { text?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner />
        <span className="text-sm text-slate-500 dark:text-slate-400">{text}</span>
      </div>
    </div>
  );
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

    // Hent brukerdata og Canvas-token status
    const megQuery = useMeg();
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

    useAuthRedirect();
    // Prefetch Canvas data hvis bruker har token
    useEffect(() => {
        if (harCanvasToken) {
            prefetchCanvasData(queryClient);
        }
    }, [harCanvasToken, queryClient]);

    // Prefetch samtalehistorikk — useChatHistory i ChatSection bruker samme query key
    // Prefetch her slik at data er klar når bruker åpner chatten
    const { prefetchChatHistory } = useChatHistoryPrefetch();
    useEffect(() => {
        if (megQuery.isSuccess) {
            prefetchChatHistory(queryClient);
        }
    }, [megQuery.isSuccess, queryClient, prefetchChatHistory]);

    // Hent fornavn fra Canvas brukerdata
    const brukernavn =
        userQuery.data?.name?.split(" ")[0] ||
        megQuery.data?.user?.firstName ||
        megQuery.data?.user?.email?.split("@")[0];

    // Hjelpefunksjon for å bestemme hvilken Canvas-visning som skal vises
    const hentCanvasVisning = () => {
        if (aktivVisning === "canvas-announcements") return "announcements";
        if (aktivVisning === "canvas-courses") return "courses";
        if (aktivVisning === "canvas-assignments") return "assignments";
        return "announcements";
    };
    // Laster: vis spinner
    if (megQuery.isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                <LoadingSpinner />
            </div>
        );
    }
    // Skal redirecte til innlogging: vis spinner i stedet for feilmelding så bruker ikke ser rød boks i et splitt sekund
    if (skalRedirecteTilAuth(megQuery)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                <LoadingSpinner />
            </div>
        );
    }
    // Feil uten brukerdata (f.eks. nettverksfeil, 429 rate limit): vis feilmelding og retry – useAuthRedirect håndterer auth-feil
    if (megQuery.isError && !megQuery.data?.user) {
        const feilmelding = getBrukerdataFeilmelding(megQuery.error);
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-slate-50 dark:bg-slate-950">
                <FeilMelding melding={feilmelding} />
                <button
                    type="button"
                    onClick={() => megQuery.refetch()}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                >
                    Prøv igjen
                </button>
            </div>
        );
    }
    // Hovedrendering (inkl. ved isError med cached data)
    return (
        <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
            {/* Sidebar */}
            <Sidebar
                aktivVisning={aktivVisning}
                byttVisning={settAktivVisning}
                brukernavn={brukernavn}
            />

            {/* Hovedinnhold */}
            <main className="flex-1 flex flex-col min-h-0 pt-0 md:pt-0 relative">
                {/* Innholds basert på aktiv visning */}
                <div className="flex-1 min-h-0 overflow-y-auto bg-white dark:bg-slate-900">
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
                                />
                            </Suspense>
                        </SectionErrorBoundary>
                    )}
                </div>
                <Footer />
            </main>
        </div>
    );
}
