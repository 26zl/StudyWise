/*
 * DashboardView - Presentasjonskomponent for dashboardet
 * Inneholder all tilstand og logikk for visning av dashboardet
 * Bruker URL search params for å bevare visning ved refresh
 */
"use client";

import { useState, useEffect, Suspense, lazy, useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Sidebar, type VisningType } from "./Sidebar";
import { SectionErrorBoundary } from "./ErrorBoundary";
import { useCanvasUser } from "../canvas/canvas-api";
import { Footer } from "./footer";
import { useMeg } from "../auth/auth-api";
import { prefetchCanvasData } from "../canvas/canvas-api";
import { useUIStore } from "../store/uiStore";

// Gyldige visningstyper for URL-validering
const GYLDIGE_VISNINGER: VisningType[] = [
  "chat", "canvas-announcements", "calendar", "canvas-courses", "settings"
];

// Lazy load tunge komponenter for raskere initial page load
const ChatSection = lazy(() => import("./ChatSection").then(m => ({ default: m.ChatSection })));
const CanvasSection = lazy(() => import("./canvasSection").then(m => ({ default: m.CanvasSection })));
const SettingsSection = lazy(() => import("./SettingsSection").then(m => ({ default: m.SettingsSection })));
const CalendarSection = lazy(() => import("../calendar/CalendarSection").then(m => ({ default: m.CalendarSection })));

// Loading fallback komponent
function SectionLoader({ text = "Laster..." }: { text?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="text-sm text-slate-500 dark:text-slate-400">{text}</span>
      </div>
    </div>
  );
}

// Hovedkomponent for dashboard-visningen
export function DashboardView() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();

    // Les visning fra URL, fallback til "chat"
    const visningFraUrl = searchParams.get("view") as VisningType | null;
    const initialVisning = visningFraUrl && GYLDIGE_VISNINGER.includes(visningFraUrl) ? visningFraUrl : "chat";
    const [aktivVisning, settAktivVisningState] = useState<VisningType>(initialVisning);
    const [, startTransition] = useTransition();

    // Oppdater URL og visning med transition (unngår flicker)
    const settAktivVisning = useCallback((nyVisning: VisningType) => {
        // Bruk startTransition for å holde forrige innhold synlig til ny er klar
        startTransition(() => {
            settAktivVisningState(nyVisning);
        });
        // Oppdater URL uten full page reload
        const url = new URL(window.location.href);
        if (nyVisning === "chat") {
            url.searchParams.delete("view");
        } else {
            url.searchParams.set("view", nyVisning);
        }
        router.replace(url.pathname + url.search, { scroll: false });
    }, [router]);

    // Synkroniser state med URL ved browser back/forward
    useEffect(() => {
        const visning = searchParams.get("view") as VisningType | null;
        const gyldigVisning = visning && GYLDIGE_VISNINGER.includes(visning) ? visning : "chat";
        if (gyldigVisning !== aktivVisning) {
            startTransition(() => {
                settAktivVisningState(gyldigVisning);
            });
        }
    }, [searchParams, aktivVisning]);

    const megQuery = useMeg();
    const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
    const brukerQueryAktiv = megQuery.isSuccess && harCanvasToken;
    const userQuery = useCanvasUser(brukerQueryAktiv);
    const setCanvasContextSelection = useUIStore((state) => state.setCanvasContextSelection);

    // Synkroniser Canvas-kontekst preferanser fra backend til global state
    useEffect(() => {
        const prefs = megQuery.data?.user?.canvasContextPreferences;
        if (prefs) {
            setCanvasContextSelection(prefs);
        }
    }, [megQuery.data?.user?.canvasContextPreferences, setCanvasContextSelection]);

    // Redirect til innlogging hvis ikke autentisert
    useEffect(() => {
        // Redirect hvis query feilet eller hvis lasting er ferdig uten brukerdata
        const erIkkeAutentisert = megQuery.isError ||
            (megQuery.isFetched && !megQuery.isLoading && !megQuery.data?.user);
        if (erIkkeAutentisert) {
            router.replace("/auth");
        }
    }, [megQuery.isError, megQuery.isFetched, megQuery.isLoading, megQuery.data?.user, router]);
    // Prefetch Canvas data hvis bruker har token
    useEffect(() => {
        if (harCanvasToken) {
            prefetchCanvasData(queryClient);
        }
    }, [harCanvasToken, queryClient]);

    // Prefetch samtalehistorikk for innstillinger (uavhengig av Canvas-token)
    useEffect(() => {
        if (megQuery.isSuccess) {
            queryClient.prefetchQuery({
                queryKey: ["chat-history"],
                queryFn: async () => {
                    const { ChatHistoryResponseSchema } = await import("common/chat");
                    const res = await fetch("/api/ki/chat/history?limit=20&page=1", {
                        credentials: "include",
                        cache: "no-store",
                    });
                    if (!res.ok) return [];
                    const data = await res.json();
                    const parsed = ChatHistoryResponseSchema.parse(data);
                    return parsed.chats
                        .slice(0, 50)
                        .map((c: { timestamp: string | Date }) => ({ ...c, timestamp: new Date(c.timestamp) }));
                },
                staleTime: 1000 * 60 * 5,
            });
        }
    }, [megQuery.isSuccess, queryClient]);

    // Hent fornavn fra Canvas brukerdata
    const brukernavn =
        userQuery.data?.name?.split(" ")[0] ||
        megQuery.data?.user?.firstName ||
        megQuery.data?.user?.email?.split("@")[0];

    // Hjelpefunksjon for å bestemme hvilken Canvas-visning som skal vises
    const hentCanvasVisning = () => {
        if (aktivVisning === "canvas-announcements") return "announcements";
        if (aktivVisning === "canvas-courses") return "courses";
        return "announcements";
    };
    // Vis lasteskjerm mens brukerdata hentes eller hvis vi redirecter
    if (megQuery.isLoading || (megQuery.isError && !brukerQueryAktiv)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }
    // Hovedrendering
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
                        aktivVisning === "canvas-courses") && (
                        <SectionErrorBoundary sectionName="Canvas">
                            <Suspense fallback={<SectionLoader text="Laster Canvas..." />}>
                                <CanvasSection startVisning={hentCanvasVisning()} harCanvasToken={harCanvasToken} />
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
