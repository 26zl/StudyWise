/*
 * Sidebar - Venstre navigasjon for dashboard
 * Håndterer navigasjon mellom chat, Canvas-seksjoner og innstillinger
 */
"use client";

import { useState } from "react";
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
} from "lucide-react";

import { useUIStore } from "../store/uiStore";

// Typer for de ulike visningene i sidebar
export type ViewType =
    | "chat"
    | "canvas-announcements"
    | "canvas-courses"
    | "canvas-data"
    | "settings";

interface SidebarProps {
    activeView: ViewType;
    onViewChange: (view: ViewType) => void;
    // isOpen & onClose moved to global store
    userName?: string;
}

// Chatte historikk (dummy data for nå)
const chatHistory = [
    { id: "1", title: "Spørsmål om eksamen", date: "I dag" },
    { id: "2", title: "Hjelp med innlevering", date: "I går" },
    { id: "3", title: "Forklaring av moduler", date: "3 dager siden" },
];

// Sidebar komponent
export function Sidebar({
    activeView,
    onViewChange,
    userName,
}: SidebarProps) {
    const { isSidebarOpen, closeSidebar } = useUIStore();
    const [canvasExpanded, setCanvasExpanded] = useState(true);

    const handleNavClick = (view: ViewType) => {
        onViewChange(view);
        // Lukk sidebar på mobil etter navigasjon
        if (window.innerWidth < 768) {
            closeSidebar();
        }
    };
    // Enkel komponent for navigasjons elementer
    const NavItem = ({
        view,
        icon: Icon,
        label,
        indent = false,
    }: {
        view: ViewType;
        icon: React.ElementType;
        label: string;
        indent?: boolean;
    }) => (
        <button
            onClick={() => handleNavClick(view)}
            className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm
                transition-colors duration-150
                ${indent ? "pl-9" : ""}
                ${activeView === view
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                }
            `}
        >
            <Icon size={18} className="shrink-0" />
            <span className="truncate">{label}</span>
        </button>
    );

    return (
        <>
            {/* Mobile Overlay */}
            {isSidebarOpen && (
                <div
                    className="md:hidden fixed inset-0 bg-black/30 z-40"
                    onClick={closeSidebar}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`
                    fixed md:relative z-50 md:z-auto
                    w-72 h-full
                    bg-white dark:bg-slate-900
                    border-r border-slate-200 dark:border-slate-800
                    flex flex-col
                    transition-transform duration-200 ease-out
                    ${isSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
                `}
            >


                {/* Mobile Close Button */}
                <div className="md:hidden flex items-center justify-between px-4 h-14 border-b border-slate-200 dark:border-slate-800">
                    <span className="font-semibold text-slate-900 dark:text-white">
                        Meny
                    </span>
                    <button
                        onClick={closeSidebar}
                        className="p-2 -mr-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        aria-label="Close menu"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                    {/* Main Navigation */}
                    <div className="mb-2">
                        <NavItem view="chat" icon={LayoutDashboard} label="Oversikt" />
                    </div>


                    {/* New Chat Button */}
                    <button
                        onClick={() => handleNavClick("chat")}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 mb-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm font-medium"
                    >
                        <Plus size={18} />
                        <span>Ny samtale</span>
                    </button>

                    {/* Chat History */}
                    <div className="mb-2">
                        <NavItem view="chat" icon={MessageSquare} label="KI Assistent" />
                    </div>

                    {/* Previous Chats */}
                    <div className="mb-4">
                        <p className="px-3 py-2 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            Nylige samtaler
                        </p>
                        {chatHistory.map((chat) => (
                            <button
                                key={chat.id}
                                onClick={() => handleNavClick("chat")}
                                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
                            >
                                <MessageSquare size={16} className="shrink-0 opacity-50" />
                                <span className="truncate">{chat.title}</span>
                            </button>
                        ))}
                    </div>

                    {/* Canvas Section */}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-4 mb-2">
                        <button
                            onClick={() => setCanvasExpanded(!canvasExpanded)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                        >
                            <span>Canvas</span>
                            {canvasExpanded ? (
                                <ChevronDown size={16} />
                            ) : (
                                <ChevronRight size={16} />
                            )}
                        </button>

                        {canvasExpanded && (
                            <div className="mt-1 space-y-0.5">
                                <NavItem
                                    view="canvas-announcements"
                                    icon={Megaphone}
                                    label="Kunngjøringer"
                                    indent
                                />
                                <NavItem
                                    view="canvas-courses"
                                    icon={BookOpen}
                                    label="Mine emner"
                                    indent
                                />
                                <NavItem
                                    view="canvas-data"
                                    icon={FolderOpen}
                                    label="Canvas data"
                                    indent
                                />
                            </div>
                        )}
                    </div>

                    {/* Settings */}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-4">
                        <NavItem view="settings" icon={Settings} label="Innstillinger" />
                    </div>
                </nav>

                {/* User Section */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 font-medium text-sm">
                            {userName ? userName.charAt(0).toUpperCase() : "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                {userName || "Ikke innlogget"}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Canvas bruker
                            </p>
                        </div>
                    </div>
                </div>
            </aside>
        </>
    );
}
