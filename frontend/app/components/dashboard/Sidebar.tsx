/*
 * Sidebar - Venstre navigasjon for dashboard
 * Håndterer navigasjon mellom chat, Canvas-seksjoner og innstillinger
 */
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useUIStore } from "@/app/store/uiStore";
import { useKIStore } from "@/app/store/kiStore";
import {
    MessageSquare,
    BookOpen,
    ClipboardList,
    Megaphone,
    Bell,
    Settings,
    ChevronDown,
    ChevronRight,
    Plus,
    LayoutDashboard,
    LogOut,
    CalendarDays,
    Sparkles,
    Brain,
    Shield,
    X,
} from "lucide-react";
import { useLoggUtWithRedirect } from "@/app/auth/auth-api";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/app/i18n";
import { useDialogAccessibility } from "@/app/hooks/useDialogAccessibility";
import { useMediaQuery } from "@/app/hooks/useMediaQuery";

// Typer for de ulike visningene i sidebar
export type VisningType =
    | "chat"
    | "canvas-announcements"
    | "calendar"
    | "canvas-courses"
    | "canvas-assignments"
    | "varslinger"
    | "settings"
    | "quiz"
    | "admin";

// Props for Sidebar-komponenten
interface SidebarProps {
    aktivVisning: VisningType;
    byttVisning: (visning: VisningType) => void;
    brukernavn?: string;
    brukerRolle?: string;
}

// Sidebar-komponent
export function Sidebar({
    aktivVisning,
    byttVisning,
    brukernavn,
    brukerRolle,
}: SidebarProps) {
    const { isVenstreMenyOpen, lukkVenstreMeny } = useUIStore();
    const [erCanvasUtvidet, settErCanvasUtvidet] = useState(true);
    const handleLoggUt = useLoggUtWithRedirect();
    const { setSelectedChatId, currentChatId, setCurrentChatId, requestNewChat } = useUIStore();
    const { runningChatId } = useKIStore();
    const { chats } = useChatHistory();
    const pathname = usePathname();
    const router = useRouter();
    const { t } = useLanguage();
    const erMobil = useMediaQuery("(max-width: 767px)");
    const dialogRef = useRef<HTMLElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const headingId = useId();
    const dialogId = "dashboard-sidebar";
    const [pendingVisning, setPendingVisning] = useState<VisningType | null>(null);
    const [pendingPathname, setPendingPathname] = useState<
      "/dashboard" | "/oversikt" | "/ai-breakdown" | null
    >(null);

    useDialogAccessibility({
        open: isVenstreMenyOpen,
        enabled: erMobil,
        containerRef: dialogRef,
        initialFocusRef: closeButtonRef,
        onClose: lukkVenstreMeny,
    });

    useEffect(() => {
        router.prefetch("/dashboard");
        router.prefetch("/oversikt");
        router.prefetch("/ai-breakdown");
    }, [router]);

    useEffect(() => {
        if (pendingPathname != null && pathname === pendingPathname) {
            setPendingPathname(null);
        }
    }, [pathname, pendingPathname]);

    useEffect(() => {
        if (pathname !== "/dashboard") {
            setPendingVisning(null);
            return;
        }

        if (pendingVisning != null && pendingVisning === aktivVisning) {
            setPendingVisning(null);
        }
    }, [pathname, pendingVisning, aktivVisning]);

    const handleNavigasjon = (visning: VisningType) => {
        if (pathname !== "/dashboard") {
            setPendingPathname("/dashboard");
        } else {
            setPendingPathname(null);
        }
        setPendingVisning(visning);
        byttVisning(visning);
        if (window.innerWidth < 768) {
            lukkVenstreMeny();
        }
    };
    const effektivPathname = pendingPathname ?? pathname;
    const erPåDashboard = effektivPathname === "/dashboard";
    const effektivVisning = pendingVisning ?? aktivVisning;

    // KI Assistent er kun «aktiv» når dashboardet faktisk er aktivt
    const erChatAktiv = erPåDashboard && effektivVisning === "chat";

    // Enkel komponent for navigasjonselementer
    const NavElement = ({
        view,
        icon: Icon,
        label,
        indent = false,
        isActiveOverride,
    }: {
        view: VisningType;
        icon: React.ElementType;
        label: string;
        indent?: boolean;
        isActiveOverride?: boolean;
    }) => {
        const erAktiv = isActiveOverride !== undefined
            ? isActiveOverride
            : erPåDashboard && effektivVisning === view;
        return (
            <button
                type="button"
                onClick={() => handleNavigasjon(view)}
                aria-current={erAktiv ? "page" : undefined}
                className={`
                    w-full flex items-center gap-3 px-5 py-3.5 rounded-xl text-left text-sm
                    transition-colors duration-150
                    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                    ${indent ? "pl-11" : ""}
                    ${erAktiv
                        ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                        : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                    }
                `}
            >
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{label}</span>
            </button>
        );
    };
    // Render
    return (
        <>
            {/* Mobil overlegg (Overlay) */}
            {isVenstreMenyOpen && (
                <button
                    type="button"
                    aria-label={t("common.actions.close")}
                    className="md:hidden fixed inset-0 bg-black/30 z-40"
                    onClick={lukkVenstreMeny}
                    tabIndex={-1}
                />
            )}

            {/* Sidebar / Venstremeny */}
            <aside
                ref={dialogRef}
                id={erMobil ? dialogId : undefined}
                role={erMobil ? "dialog" : undefined}
                aria-modal={erMobil ? "true" : undefined}
                aria-labelledby={erMobil ? headingId : undefined}
                tabIndex={erMobil ? -1 : undefined}
                className={`
                    fixed md:relative z-50 md:z-auto
                    w-72 h-full
                    bg-white dark:bg-slate-900
                    border-r border-slate-200 dark:border-slate-800
                    flex flex-col
                    transition-[transform,width] duration-200 ease-out
                    ${isVenstreMenyOpen ? "translate-x-0" : "-translate-x-full md:w-0 md:min-w-0 md:overflow-hidden"}
                `}
            >
                {erMobil && (
                    <div className="flex items-center justify-end gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
                        <h2 id={headingId} className="sr-only">
                            {t("dashboard.sidebar.navigationTitle")}
                        </h2>
                        <button
                            ref={closeButtonRef}
                            type="button"
                            onClick={lukkVenstreMeny}
                            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                            aria-label={t("common.actions.close")}
                        >
                            <X size={20} />
                        </button>
                    </div>
                )}

                <nav aria-label={t("dashboard.sidebar.navigationTitle")} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-3">
                    {/* Hovednavigasjon */}
                    <div className="mb-4">
                        <Link
                            href="/oversikt"
                            prefetch={false}
                            aria-current={effektivPathname === "/oversikt" ? "page" : undefined}
                            onClick={() => {
                                setPendingVisning(null);
                                setPendingPathname("/oversikt");
                                if (window.innerWidth < 768) lukkVenstreMeny();
                            }}
                            className={`
                                w-full flex items-center gap-3 px-5 py-3.5 rounded-xl text-left text-sm
                                transition-colors duration-150
                                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                                ${effektivPathname === "/oversikt"
                                    ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                                }
                            `}
                        >
                            <LayoutDashboard size={18} className="shrink-0" />
                            <span className="truncate">{t("dashboard.sidebar.overview")}</span>
                        </Link>
                    </div>


                    {/* Ny samtale-knapp */}
                    <button
                        type="button"
                        onClick={() => {
                            requestNewChat();
                            handleNavigasjon("chat");
                        }}
                        className="w-full flex items-center justify-center gap-2 px-5 py-3.5 mb-8 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                    >
                        <Plus size={18} />
                        <span>{t("common.actions.newConversation")}</span>
                    </button>

                    {/* Chat-historikk */}
                    <div className="mb-8">
                        <div className="mb-4">
                            <NavElement view="chat" icon={MessageSquare} label={t("dashboard.sidebar.aiAssistant")} isActiveOverride={erChatAktiv} />
                        </div>
                        
                        {/* Oppgavedeling med KI */}
                        <Link
                            href="/ai-breakdown"
                            prefetch={false}
                            aria-current={effektivPathname === "/ai-breakdown" ? "page" : undefined}
                            onClick={() => {
                                setPendingVisning(null);
                                setPendingPathname("/ai-breakdown");
                                if (window.innerWidth < 768) {
                                    lukkVenstreMeny();
                                }
                            }}
                            className={`
                                w-full flex items-center gap-3 px-5 py-3.5 rounded-xl text-left text-sm
                                transition-colors duration-150
                                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                                ${effektivPathname === "/ai-breakdown"
                                    ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                                }
                            `}
                        >
                            <Sparkles size={18} className="shrink-0" />
                            <span className="truncate">{t("dashboard.sidebar.taskBreakdown")}</span>
                        </Link>

                        {/* Quiz med KI */}
                        <NavElement view="quiz" icon={Brain} label={t("dashboard.sidebar.quiz")} />
                        
                        <p className="px-5 pt-6 pb-3 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                            {t("dashboard.sidebar.chatHistory")}
                        </p>
                        {chats.length === 0 ? (
                            <div className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
                                {t("dashboard.sidebar.noChatsYet")}
                            </div>
                        ) : (
                            chats.slice(0, 5).map((chat) => (
                                (() => {
                                    const erAktivSamtale = currentChatId === chat.id;
                                    const erPåChatSide = erPåDashboard && effektivVisning === "chat";
                                    // Marker aktivt: på chat-siden vises valgt samtale, på andre sider kun hvis KI jobber i bakgrunnen
                                    const visPågåendeMarkering = erAktivSamtale && (erPåChatSide || runningChatId === chat.id);
                                    return (
                                        <button
                                            key={chat.id}
                                            type="button"
                                            onClick={() => {
                                                setSelectedChatId(chat.id);
                                                setCurrentChatId(chat.id);
                                                handleNavigasjon("chat");
                                            }}
                                            className={`
                                                group w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm
                                                transition-all duration-150
                                                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                                                ${visPågåendeMarkering
                                                    ? "border-sky-200/80 dark:border-sky-900/70 bg-sky-50/80 dark:bg-sky-950/25 text-slate-900 dark:text-slate-100"
                                                    : "border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                                                }
                                            `}
                                            aria-current={visPågåendeMarkering ? "true" : undefined}
                                        >
                                            <span
                                                className={`
                                                    shrink-0 mt-0.5 h-2 w-2 rounded-full transition-all
                                                    ${visPågåendeMarkering ? "opacity-100 scale-100" : "opacity-0 scale-75"}
                                                    ${visPågåendeMarkering
                                                        ? "bg-sky-500 dark:bg-sky-400"
                                                        : "bg-slate-300 dark:bg-slate-600 group-hover:bg-slate-400 dark:group-hover:bg-slate-500"
                                                    }
                                                `}
                                            />
                                            <MessageSquare
                                                size={16}
                                                className={`shrink-0 transition-colors ${visPågåendeMarkering ? "text-sky-600 dark:text-sky-300" : "opacity-50"}`}
                                            />
                                            <span className="truncate">{chat.title}</span>
                                        </button>
                                    );
                                })()
                            ))
                        )}
                    </div>

                    {/* Canvas-seksjon */}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-8 pb-3">
                        <button
                            type="button"
                            onClick={() => settErCanvasUtvidet(!erCanvasUtvidet)}
                            aria-expanded={erCanvasUtvidet}
                            aria-controls="sidebar-canvas-menu"
                            className="w-full flex items-center justify-between px-5 py-3.5 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                        >
                            <span>{t("dashboard.sidebar.canvas")}</span>
                            {erCanvasUtvidet ? (
                                <ChevronDown size={16} />
                            ) : (
                                <ChevronRight size={16} />
                            )}
                        </button>

                        {erCanvasUtvidet && (
                            <div id="sidebar-canvas-menu" className="mt-4 space-y-2">
                                <NavElement
                                    view="varslinger"
                                    icon={Bell}
                                    label={t("dashboard.sidebar.notifications")}
                                    indent
                                />
                                <NavElement
                                    view="canvas-courses"
                                    icon={BookOpen}
                                    label={t("dashboard.sidebar.courses")}
                                    indent
                                />
                                <NavElement
                                    view="calendar"
                                    icon={CalendarDays}
                                    label={t("dashboard.sidebar.calendar")}
                                    indent
                                />
                                <NavElement
                                    view="canvas-assignments"
                                    icon={ClipboardList}
                                    label={t("dashboard.sidebar.assignments")}
                                    indent
                                />
                                <NavElement
                                    view="canvas-announcements"
                                    icon={Megaphone}
                                    label={t("dashboard.sidebar.announcements")}
                                    indent
                                />
                            </div>
                        )}
                    </div>

                    {/* Innstillinger + Admin */}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-8 space-y-2">
                        <NavElement view="settings" icon={Settings} label={t("dashboard.sidebar.settings")} />
                        {brukerRolle === "admin" && (
                            <NavElement view="admin" icon={Shield} label={t("dashboard.sidebar.admin")} />
                        )}
                    </div>
                </nav>

                {/* Bruker-seksjon */}
                <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 font-medium text-sm">
                            {brukernavn ? brukernavn.charAt(0).toUpperCase() : "?"}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                            <p className="text-sm font-medium text-slate-900 dark:text-white truncate leading-tight">
                                {brukernavn || t("common.labels.notSignedIn")}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight">
                                {t("common.labels.canvasUser")}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleLoggUt}
                            className="shrink-0 p-2 -mr-2 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                            aria-label={t("common.actions.signOut")}
                            title={t("common.actions.signOut")}
                        >
                            <LogOut size={20} />
                        </button>
                    </div>
                </div>
            </aside>
        </>
    );
}  
