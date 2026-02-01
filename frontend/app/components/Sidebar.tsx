/*
 * Sidebar - Venstre navigasjon for dashboard
 * Håndterer navigasjon mellom chat, Canvas-seksjoner og innstillinger
 */
"use client";

import { useState } from "react";
import { useUIStore } from "../store/uiStore";
import {
    MessageSquare,
    BookOpen,
    Megaphone,
    FolderOpen,
    Settings,
    ChevronDown,
    ChevronRight,
    Plus,
    X,
    LayoutDashboard,
    LogOut,
    CalendarDays,
} from "lucide-react";
import { useLoggUt } from "../auth/auth-api";
import { useQueryClient } from "@tanstack/react-query";
import { broadcastLogout } from "../hooks/use-auth-sync";
import { useChatHistory } from "../hooks/useChatHistory";


// Typer for de ulike visningene i sidebar
export type VisningType =
    | "chat"
    | "canvas-announcements"
    | "calendar"
    | "canvas-courses"
    | "canvas-data"
    | "settings";

// Props for Sidebar-komponenten
interface SidebarProps {
    aktivVisning: VisningType;
    byttVisning: (visning: VisningType) => void;
    brukernavn?: string;
}

// Sidebar-komponent
export function Sidebar({
    aktivVisning,
    byttVisning,
    brukernavn,
}: SidebarProps) {
    const { isVenstreMenyOpen, lukkVenstreMeny, reset: resetUIStore } = useUIStore();
    const [erCanvasUtvidet, settErCanvasUtvidet] = useState(true);
    const loggUt = useLoggUt();
    const queryClient = useQueryClient();
    const { setSelectedChatId, requestNewChat } = useUIStore();
    const { chats } = useChatHistory();

    // Håndter navigasjon og lukk meny på mobil
    const handleNavigasjon = (visning: VisningType) => {
        byttVisning(visning);
        // Lukk sidebar på mobil etter navigasjon
        if (window.innerWidth < 768) {
            lukkVenstreMeny();
        }
    };
    // Håndter logg ut - rydder opp all cache og state før redirect
    const handleLoggUt = async () => {
        try {
            await loggUt.mutateAsync();
        } catch {
            // Ignorer feil - vi logger ut uansett
        } finally {
            // Varsle andre faner om utlogging
            broadcastLogout();
            // Rydd opp all cached data
            queryClient.clear();
            // Nullstill UI-tilstand
            resetUIStore();
            // Hard redirect til hjemmesiden
            window.location.href = "/hjem";
        }
    };
    // Enkel komponent for navigasjonselementer
    const NavElement = ({
        view,
        icon: Icon,
        label,
        indent = false,
    }: {
        view: VisningType;
        icon: React.ElementType;
        label: string;
        indent?: boolean;
    }) => (
        <button
            onClick={() => handleNavigasjon(view)}
            className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm
                transition-colors duration-150
                ${indent ? "pl-9" : ""}
                ${aktivVisning === view
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                }
            `}
        >
            <Icon size={18} className="shrink-0" />
            <span className="truncate">{label}</span>
        </button>
    );
    // Render
    return (
        <>
            {/* Mobil overlegg (Overlay) */}
            {isVenstreMenyOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/30 z-40"
                    onClick={lukkVenstreMeny}
                />
            )}

            {/* Sidebar / Venstremeny */}
            <aside
                className={`
                    fixed md:relative z-50 md:z-auto
                    w-72 h-full
                    bg-white dark:bg-slate-900
                    border-r border-slate-200 dark:border-slate-800
                    flex flex-col
                    transition-transform duration-200 ease-out
                    ${isVenstreMenyOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
                `}
            >


                {/* Lukk-knapp for mobil */}
                <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-800">
                    <span className="font-semibold text-slate-900 dark:text-white">
                        Meny
                    </span>
                    <button
                        onClick={lukkVenstreMeny}
                        className="p-2 -mr-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        aria-label="Lukk meny"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Navigasjon */}
                <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                    {/* Hovednavigasjon */}
                    <div className="mb-2">
                        <NavElement view="chat" icon={LayoutDashboard} label="Oversikt" />
                    </div>


                    {/* Ny samtale-knapp */}
                    <button
                        onClick={() => {
                            requestNewChat();
                            handleNavigasjon("chat");
                        }}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm font-medium"
                    >
                        <Plus size={18} />
                        <span>Ny samtale</span>
                    </button>

                    {/* Chat-historikk */}
                    <div className="mb-4">
                        <div className="mb-2">
                            <NavElement view="chat" icon={MessageSquare} label="KI Assistent" />
                        </div>
                        <p className="px-3 py-2 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            Samtalehistorikk
                        </p>
                        {chats.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                                Ingen samtaler ennå
                            </div>
                        ) : (
                            chats.slice(0, 5).map((chat) => (
                                <button
                                    key={chat.id}
                                    onClick={() => {
                                        setSelectedChatId(chat.id);
                                        handleNavigasjon("chat");
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
                                >
                                    <MessageSquare size={16} className="shrink-0 opacity-50" />
                                    <span className="truncate">{chat.title}</span>
                                </button>
                            ))
                        )}
                    </div>

                    {/* Canvas-seksjon */}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-4 mb-2">
                        <button
                            onClick={() => settErCanvasUtvidet(!erCanvasUtvidet)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                            <span>Canvas</span>
                            {erCanvasUtvidet ? (
                                <ChevronDown size={16} />
                            ) : (
                                <ChevronRight size={16} />
                            )}
                        </button>

                        {erCanvasUtvidet && (
                            <div className="mt-1 space-y-0.5">
                                <NavElement
                                    view="canvas-announcements"
                                    icon={Megaphone}
                                    label="Kunngjøringer"
                                    indent
                                />
                                <NavElement
                                    view="calendar"
                                    icon={CalendarDays}
                                    label="Kalender"
                                    indent
                                />
                                <NavElement
                                    view="canvas-courses"
                                    icon={BookOpen}
                                    label="Mine emner"
                                    indent
                                />
                                <NavElement
                                    view="canvas-data"
                                    icon={FolderOpen}
                                    label="Canvas data"
                                    indent
                                />
                            </div>
                        )}
                    </div>

                    {/* Innstillinger */}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                        <NavElement view="settings" icon={Settings} label="Innstillinger" />
                    </div>
                </nav>

                {/* Bruker-seksjon */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 font-medium text-sm">
                            {brukernavn ? brukernavn.charAt(0).toUpperCase() : "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                {brukernavn || "Ikke innlogget"}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Canvas bruker
                            </p>
                        </div>
                        <button
                            onClick={handleLoggUt}
                            className="p-2 -mr-2 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                            aria-label="Logg ut"
                            title="Logg ut"
                        >
                            <LogOut size={20} />
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
}
