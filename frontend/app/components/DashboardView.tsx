/*
 * DashboardView - Presentasjonskomponent for dashboardet
 * Inneholder all tilstand og logikk for visning av dashboardet
 */
"use client";

import { useState, useEffect, Suspense, lazy } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Sidebar, type VisningType } from "./Sidebar";
import { SectionErrorBoundary } from "./ErrorBoundary";
import { useCanvasUser } from "../canvas/canvas-api";
import { Footer } from "./footer";
import { useMeg } from "../auth/auth-api";
import { prefetchCanvasData } from "../canvas/canvas-api";
import type { CampusId } from "../calendar/calendar-api";

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
    const queryClient = useQueryClient();
    const [aktivVisning, settAktivVisning] = useState<VisningType>("chat");
    const megQuery = useMeg();
    const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
    const brukerQueryAktiv = megQuery.isSuccess && harCanvasToken;
    const userQuery = useCanvasUser(brukerQueryAktiv);
    
    // Campus-valg for TimeEdit - hent fra localStorage
    const [campus, setCampus] = useState<CampusId | undefined>(undefined);
    
    // Last inn lagret campus fra localStorage
    useEffect(() => {
        const savedCampus = localStorage.getItem("studywise_campus") as CampusId | null;
        if (savedCampus) {
            setCampus(savedCampus);
        }
    }, []);
    
    // Håndter campus-endring
    const handleCampusChange = (newCampus: CampusId | undefined) => {
        setCampus(newCampus);
        if (newCampus) {
            localStorage.setItem("studywise_campus", newCampus);
        } else {
            localStorage.removeItem("studywise_campus");
        }
        // Invalider TimeEdit-cache for å hente ny data
        queryClient.invalidateQueries({ queryKey: ["timeEdit"] });
    };

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

    // Hent fornavn fra Canvas brukerdata
    const brukernavn =
        userQuery.data?.name?.split(" ")[0] ||
        megQuery.data?.user?.firstName ||
        megQuery.data?.user?.email?.split("@")[0];

    // Hjelpefunksjon for å bestemme hvilken Canvas-visning som skal vises
    const hentCanvasVisning = () => {
        if (aktivVisning === "canvas-announcements") return "announcements";
        if (aktivVisning === "canvas-courses") return "courses";
        if (aktivVisning === "canvas-data") return "data";
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
                                <CalendarSection harCanvasToken={harCanvasToken} campus={campus} />
                            </Suspense>
                        </SectionErrorBoundary>
                    )}
                    {(aktivVisning === "canvas-announcements" ||
                        aktivVisning === "canvas-courses" ||
                        aktivVisning === "canvas-data") && (
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
                                    brukernavn={brukernavn}
                                    harCanvasToken={harCanvasToken}
                                    campus={campus}
                                    onCampusChange={handleCampusChange}
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
