/*
 * DashboardView - Presentasjonskomponent for dashboardet
 * Inneholder all tilstand og logikk for visning av dashboardet
 */
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar, type VisningType } from "./Sidebar";
import { ChatSection } from "./ChatSection";
import { CanvasSection } from "./canvasSection";
import { SettingsSection } from "./SettingsSection";
import { useCanvasUser } from "../canvas/canvas-api";
import { Footer } from "./footer";
import { useMeg } from "../auth/auth-api";
import { prefetchCanvasData } from "../canvas/canvas-api";

// Hovedkomponent for dashboard-visningen
export function DashboardView() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const [aktivVisning, settAktivVisning] = useState<VisningType>("chat");
    const megQuery = useMeg();
    const harCanvasToken = megQuery.data?.user?.hasCanvasToken ?? false;
    const brukerQueryAktiv = megQuery.isSuccess && harCanvasToken;
    const userQuery = useCanvasUser(brukerQueryAktiv);

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
                <div className="flex-1 min-h-0 overflow-hidden bg-white dark:bg-slate-900">
                    {aktivVisning === "chat" && <ChatSection />}

                    {(aktivVisning === "canvas-announcements" ||
                        aktivVisning === "canvas-courses" ||
                        aktivVisning === "canvas-data") && (
                            <CanvasSection startVisning={hentCanvasVisning()} harCanvasToken={harCanvasToken} />
                        )}

                    {aktivVisning === "settings" && (
                        <SettingsSection
                            brukernavn={brukernavn}
                            harCanvasToken={harCanvasToken}
                        />
                    )}
                </div>
                <Footer />
            </main>
        </div>
    );
}
