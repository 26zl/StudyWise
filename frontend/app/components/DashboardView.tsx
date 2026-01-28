/*
 * DashboardView - Presentasjonskomponent for dashboardet
 * Inneholder all tilstand og logikk for visning av dashboardet
 */
"use client";

import { useState, useEffect } from "react";
import { Sidebar, type VisningType } from "./Sidebar";
import { ChatSection } from "./ChatSection";
import { CanvasSection } from "./canvasSection";
import { SettingsSection } from "./SettingsSection";
import { useCanvasUser } from "../canvas/canvas-api";
import { Footer } from "./footer";

export function DashboardView() {
    const [aktivVisning, settAktivVisning] = useState<VisningType>("chat");
    const [erDarkMode, settErDarkMode] = useState(false);
    const userQuery = useCanvasUser();

    // Initialiser tema basert på lagret preferanse eller systeminnstilling
    useEffect(() => {
        // Sjekk localStorage først
        const lagret = localStorage.getItem("studywise-dark-mode");
        if (lagret !== null) {
            settErDarkMode(lagret === "true");
        } else {
            // Fallback til systempreferanse
            const foretrekkerMork = window.matchMedia("(prefers-color-scheme: dark)").matches;
            settErDarkMode(foretrekkerMork);
        }
    }, []);

    // Legg til eller fjern tema-klasser på <html> basert på erDarkMode
    useEffect(() => {
        document.documentElement.classList.toggle("dark", erDarkMode);
        document.documentElement.classList.toggle("light", !erDarkMode);
        localStorage.setItem("studywise-dark-mode", String(erDarkMode));
    }, [erDarkMode]);

    const settDarkMode = () => settErDarkMode((forrige) => !forrige);

    // Hent fornavn fra Canvas brukerdata
    const brukernavn = userQuery.data?.name?.split(" ")[0];

    // Hjelpefunksjon for å bestemme hvilken Canvas-visning som skal vises
    const hentCanvasVisning = () => {
        if (aktivVisning === "canvas-announcements") return "announcements";
        if (aktivVisning === "canvas-courses") return "courses";
        if (aktivVisning === "canvas-data") return "data";
        return "announcements";
    };

    return (
        <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
            {/* Sidebar */}
            <Sidebar
                aktivVisning={aktivVisning}
                byttVisning={settAktivVisning}
                brukernavn={brukernavn}
            />

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-h-0 pt-0 md:pt-0 relative">
                {/* Content based on active view */}
                <div className="flex-1 min-h-0 overflow-hidden bg-white dark:bg-slate-900">
                    {aktivVisning === "chat" && <ChatSection />}

                    {(aktivVisning === "canvas-announcements" ||
                        aktivVisning === "canvas-courses" ||
                        aktivVisning === "canvas-data") && (
                            <CanvasSection startVisning={hentCanvasVisning()} />
                        )}

                    {aktivVisning === "settings" && (
                        <SettingsSection
                            erDarkMode={erDarkMode}
                            settDarkMode={settDarkMode}
                            brukernavn={brukernavn}
                        />
                    )}
                </div>
                <Footer />
            </main>
        </div>
    );
}
