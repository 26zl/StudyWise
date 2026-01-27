/*
 * DashboardView - Presentasjonskomponent for dashboardet
 * Inneholder all tilstand og logikk for visning av dashboardet
 */
"use client";

import { useState, useEffect } from "react";
import { Sidebar, type ViewType } from "./Sidebar";
import { ChatSection } from "./ChatSection";
import { CanvasSection } from "./canvasSection";
import { SettingsSection } from "./SettingsSection";
import { useCanvasUser } from "../canvas/canvas-api";
import { Footer } from "./footer";

export function DashboardView() {
    const [activeView, setActiveView] = useState<ViewType>("chat");
    const [isDarkMode, setIsDarkMode] = useState(false);
    const userQuery = useCanvasUser();

    // Initialiser tema basert på lagret preferanse eller systeminnstilling
    useEffect(() => {
        // Sjekk localStorage først
        const stored = localStorage.getItem("studywise-dark-mode");
        if (stored !== null) {
            setIsDarkMode(stored === "true");
        } else {
            // Fallback til systempreferanse
            const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            setIsDarkMode(prefersDark);
        }
    }, []);

    // Legg til eller fjern "dark" klassen på <html> basert på isDarkMode
    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add("dark");
        } else {
            document.documentElement.classList.remove("dark");
        }
        localStorage.setItem("studywise-dark-mode", String(isDarkMode));
    }, [isDarkMode]);

    const toggleDarkMode = () => setIsDarkMode((prev) => !prev);

    // Hent fornavn fra Canvas brukerdata
    const userName = userQuery.data?.navn?.split(" ")[0];

    // Hjelpefunksjon for å bestemme hvilken Canvas-visning som skal vises
    const getCanvasView = () => {
        if (activeView === "canvas-announcements") return "announcements";
        if (activeView === "canvas-courses") return "courses";
        if (activeView === "canvas-data") return "data";
        return "announcements";
    };

    return (
        <div className="h-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden">
            {/* Sidebar */}
            <Sidebar
                activeView={activeView}
                onViewChange={setActiveView}
                userName={userName}
            />

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col min-h-0 pt-0 md:pt-0 relative">
                {/* Content based on active view */}
                <div className="flex-1 min-h-0 overflow-hidden bg-white dark:bg-slate-900">
                    {activeView === "chat" && <ChatSection />}

                    {(activeView === "canvas-announcements" ||
                        activeView === "canvas-courses" ||
                        activeView === "canvas-data") && (
                            <CanvasSection initialView={getCanvasView()} />
                        )}

                    {activeView === "settings" && (
                        <SettingsSection
                            isDarkMode={isDarkMode}
                            onToggleDarkMode={toggleDarkMode}
                            userName={userName}
                        />
                    )}
                </div>
                <Footer />
            </main>
        </div>
    );
}
