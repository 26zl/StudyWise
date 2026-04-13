/*
 * Sidebar - Venstre navigasjon for dashboard
 * Håndterer navigasjon mellom chat, Canvas-seksjoner og innstillinger
 */
"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
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
    MoreHorizontal,
    X,
    ArrowRight,
    UserRound,
} from "lucide-react";
import { useLoggUtWithRedirect } from "@/app/auth/auth-api";
import { useChatHistory } from "@/app/hooks/useChatHistory";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/app/i18n";
import { useDialogAccessibility } from "@/app/hooks/useDialogAccessibility";
import {
    MOBILE_MEDIA_QUERY,
    useMediaQuery,
} from "@/app/hooks/useMediaQuery";

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
    | "flashcards"
    | "admin";

// Props for Sidebar-komponenten
interface SidebarProps {
    aktivVisning: VisningType;
    byttVisning: (visning: VisningType) => void;
    brukernavn?: string;
    brukerRolle?: string;
    avklarerBruker?: boolean;
    kanLoggUt?: boolean;
}

// Sidebar-komponent
export function Sidebar({
    aktivVisning,
    byttVisning,
    brukernavn,
    brukerRolle,
    avklarerBruker = false,
    kanLoggUt = true,
}: SidebarProps) {
    const { isVenstreMenyOpen, lukkVenstreMeny } = useUIStore();
    const [erCanvasUtvidet, settErCanvasUtvidet] = useState(true);
    const handleLoggUt = useLoggUtWithRedirect();
    const { setSelectedChatId, currentChatId, setCurrentChatId, requestNewChat } = useUIStore();
    const { runningChatId } = useKIStore();
    const { chats, setChatPinned, setChatTitle, deleteChat } = useChatHistory();
    const pathname = usePathname();
    const router = useRouter();
    const { t } = useLanguage();
    const [openActionsChatId, setOpenActionsChatId] = useState<string | null>(null);
    const [renameModalChatId, setRenameModalChatId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [erBookmarksUtvidet, settErBookmarksUtvidet] = useState(true);
    const [erHistorikkUtvidet, settErHistorikkUtvidet] = useState(true);
    const erMobil = useMediaQuery(MOBILE_MEDIA_QUERY);
    const dialogRef = useRef<HTMLElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const headingId = useId();
    const renameDialogRef = useRef<HTMLDivElement | null>(null);
    const renameCloseButtonRef = useRef<HTMLButtonElement | null>(null);
    const renameInputRef = useRef<HTMLTextAreaElement | null>(null);
    const renameTitleId = useId();
    const renameDescriptionId = useId();
    const renameInputId = useId();
    const dialogId = "dashboard-sidebar";
    const [pendingVisning, setPendingVisning] = useState<VisningType | null>(null);
    const [pendingPathname, setPendingPathname] = useState<
      "/dashboard" | "/oversikt" | "/ai-breakdown" | null
    >(null);

    const handleCloseRenameModal = useCallback(() => {
        setRenameModalChatId(null);
        setRenameValue("");
    }, []);

    const handleOpenRenameModal = useCallback((chatId: string, title: string) => {
        setRenameModalChatId(chatId);
        setRenameValue(title);
        setOpenActionsChatId(null);
    }, []);

    useDialogAccessibility({
        open: isVenstreMenyOpen,
        enabled: erMobil,
        containerRef: dialogRef,
        initialFocusRef: closeButtonRef,
        onClose: lukkVenstreMeny,
    });

    useDialogAccessibility({
        open: renameModalChatId !== null,
        containerRef: renameDialogRef,
        initialFocusRef: renameInputRef,
        onClose: handleCloseRenameModal,
    });

    useEffect(() => {
        router.prefetch("/dashboard");
        router.prefetch("/oversikt");
        router.prefetch("/ai-breakdown");
        router.prefetch("/account");
    }, [router]);

    // Hold sidebar-state i sync med faktisk breakpoint slik at mobil/desktop
    // ikke driver fra hverandre ved resize eller hydration.
    const settVenstreMenyOpen = useUIStore((s) => s.settVenstreMenyOpen);
    useEffect(() => {
        if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
            settVenstreMenyOpen(!window.matchMedia(MOBILE_MEDIA_QUERY).matches);
        }
    }, [erMobil, settVenstreMenyOpen]);

    useEffect(() => {
        if (pendingPathname != null && pathname === pendingPathname) {
            setPendingPathname(null);
        }
    }, [pathname, pendingPathname]);

    useEffect(() => {
        if (pendingVisning == null) {
            return;
        }

        // Behold optimistisk dashboard-visning mens ruteovergangen til /dashboard pågår.
        if (pathname !== "/dashboard") {
            if (pendingPathname !== "/dashboard") {
                setPendingVisning(null);
            }
            return;
        }

        if (pendingVisning === aktivVisning) {
            setPendingVisning(null);
        }
    }, [pathname, pendingPathname, pendingVisning, aktivVisning]);

    const lukkVenstreMenyHvisMobil = useCallback(() => {
        if (erMobil) {
            lukkVenstreMeny();
        }
    }, [erMobil, lukkVenstreMeny]);

    const handleNavigasjon = (visning: VisningType) => {
        if (pathname !== "/dashboard") {
            setPendingPathname("/dashboard");
        } else {
            setPendingPathname(null);
        }
        setPendingVisning(visning);
        byttVisning(visning);
        lukkVenstreMenyHvisMobil();
    };
    const effektivPathname = pendingPathname ?? pathname;
    const erPåDashboard = effektivPathname === "/dashboard";
    const effektivVisning = pendingVisning ?? aktivVisning;
    const skalViseAdmin = brukerRolle === "admin";
    const visBrukerPlaceholder = avklarerBruker && !brukernavn;

    // KI Assistent er kun «aktiv» når dashboardet faktisk er aktivt
    const erChatAktiv = erPåDashboard && effektivVisning === "chat";
    const bookmarkedChats = chats.filter((chat) => chat.pinned).slice(0, 5);
    const allHistoryChats = chats.filter((chat) => !chat.pinned);
    const historyVisibleCount = 7;
    const historyChats = allHistoryChats.slice(0, historyVisibleCount);
    const hasHiddenHistoryChats = allHistoryChats.length > historyVisibleCount;
    const erPåChatSide = pathname === "/dashboard" && aktivVisning === "chat";
    const chatHandlingTekster = {
        closeMenu: t("chatActions.closeMenu"),
        actions: t("chatActions.actionsMenu"),
        rename: t("chatActions.rename"),
        removeBookmark: t("chatActions.removeBookmark"),
        addBookmark: t("chatActions.addBookmark"),
        delete: t("chatActions.delete"),
        hideBookmarks: t("chatActions.hideBookmarks"),
        showBookmarks: t("chatActions.showBookmarks"),
        hideHistory: t("chatActions.hideHistory"),
        showHistory: t("chatActions.showHistory"),
        showMore: t("chatActions.showMore"),
    };
    type SidebarChat = (typeof chats)[number];

    const renderChatRad = (chat: SidebarChat, section: "bookmarks" | "history") => {
        const erAktivSamtale = currentChatId === chat.id;
        const visPågåendeMarkering = erAktivSamtale && (erPåChatSide || runningChatId === chat.id);
        const erMenyÅpen = openActionsChatId === chat.id;
        const erBokmerke = section === "bookmarks";

        return (
            <div key={`${section}-${chat.id}`} className="relative">
                <button
                    type="button"
                    onClick={() => {
                        setSelectedChatId(chat.id);
                        setCurrentChatId(chat.id);
                        handleNavigasjon("chat");
                    }}
                    aria-current={visPågåendeMarkering ? "page" : undefined}
                    className={`
                        group w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm
                        transition-all duration-150
                        focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                        ${visPågåendeMarkering
                            ? "border-sky-200/80 dark:border-sky-900/70 bg-sky-50/80 dark:bg-sky-950/25 text-slate-900 dark:text-slate-100"
                            : "border-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                        }
                    `}
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
                        size={14}
                        className={`shrink-0 transition-colors ${visPågåendeMarkering ? "text-sky-600 dark:text-sky-300" : "opacity-50"}`}
                    />
                    <span className="truncate pr-8">{chat.title}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setOpenActionsChatId(erMenyÅpen ? null : chat.id)}
                    className="absolute right-3 top-2.5 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    aria-label={chatHandlingTekster.actions}
                >
                    <MoreHorizontal size={16} />
                </button>
                {erMenyÅpen && (
                    <>
                        <button
                            type="button"
                            aria-label={chatHandlingTekster.closeMenu}
                            onClick={() => setOpenActionsChatId(null)}
                            className="fixed inset-0 z-10 cursor-default"
                        />
                        <div className="absolute right-2 z-20 mt-1 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenRenameModal(chat.id, chat.title);
                                }}
                                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                {chatHandlingTekster.rename}
                            </button>
                            <button
                                type="button"
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    await setChatPinned(chat.id, !erBokmerke);
                                    setOpenActionsChatId(null);
                                }}
                                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                                {erBokmerke ? chatHandlingTekster.removeBookmark : chatHandlingTekster.addBookmark}
                            </button>
                            <button
                                type="button"
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    await deleteChat(chat.id);
                                    if (currentChatId === chat.id) {
                                        setCurrentChatId(null);
                                        setSelectedChatId(null);
                                    }
                                    setOpenActionsChatId(null);
                                }}
                                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                                {chatHandlingTekster.delete}
                            </button>
                        </div>
                    </>
                )}
            </div>
        );
    };

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
            {erMobil && isVenstreMenyOpen && (
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
                    w-72 h-dvh md:h-full
                    pb-[env(safe-area-inset-bottom)] md:pb-0
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

                <nav aria-label={t("dashboard.sidebar.navigationTitle")} className="relative flex-1 overflow-y-auto px-5 py-5 space-y-2">
                    {/* Hovednavigasjon */}
                    <div className="mb-1">
                        <Link
                            href="/oversikt"
                            prefetch={false}
                            aria-current={effektivPathname === "/oversikt" ? "page" : undefined}
                            onClick={() => {
                                setPendingVisning(null);
                                setPendingPathname("/oversikt");
                                lukkVenstreMenyHvisMobil();
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
                        <Plus size={16} />
                        <span>{t("common.actions.newConversation")}</span>
                    </button>

                    {/* Chat-historikk */}
                    <div className="mb-10">
                        <NavElement view="chat" icon={MessageSquare} label={t("dashboard.sidebar.aiAssistant")} isActiveOverride={erChatAktiv} />

                        {/* Oppgavedeling med KI */}
                        <Link
                            href="/ai-breakdown"
                            prefetch={false}
                            aria-current={effektivPathname === "/ai-breakdown" ? "page" : undefined}
                            onClick={() => {
                                setPendingVisning(null);
                                setPendingPathname("/ai-breakdown");
                                lukkVenstreMenyHvisMobil();
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
                        <NavElement
                            view="quiz"
                            icon={Brain}
                            label={t("dashboard.sidebar.quiz")}
                            isActiveOverride={erPåDashboard && (effektivVisning === "quiz" || effektivVisning === "flashcards")}
                        />

                        <div className={`flex items-center justify-between px-5 ${erBookmarksUtvidet ? "pt-5 pb-2" : "pt-3 pb-1"}`}>
                            <Link
                                href="/dashboard/bokmerker"
                                prefetch={false}
                                onClick={() => {
                                    lukkVenstreMenyHvisMobil();
                                }}
                                className="group flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
                            >
                                {t("dashboard.sidebar.bookmarks")}
                                <ArrowRight size={11} className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                            </Link>
                            <button
                                type="button"
                                onClick={() => settErBookmarksUtvidet((prev) => !prev)}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                                aria-label={erBookmarksUtvidet ? chatHandlingTekster.hideBookmarks : chatHandlingTekster.showBookmarks}
                            >
                                {erBookmarksUtvidet ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                        </div>
                        {!erBookmarksUtvidet ? null : bookmarkedChats.length === 0 ? (
                            <div className="px-5 pb-2 text-xs text-slate-500 dark:text-slate-400">
                                {t("dashboard.sidebar.noBookmarksYet")}
                            </div>
                        ) : (
                            bookmarkedChats.map((chat) => renderChatRad(chat, "bookmarks"))
                        )}

                        <div className={`flex items-center justify-between px-5 ${erBookmarksUtvidet ? "pt-6 pb-2" : "pt-3 pb-1"}`}>
                            <Link
                                href="/dashboard/samtalehistorikk"
                                prefetch={false}
                                onClick={() => {
                                    lukkVenstreMenyHvisMobil();
                                }}
                                className="group flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-blue-500 dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
                            >
                                {t("dashboard.sidebar.chatHistory")}
                                <ArrowRight size={11} className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                            </Link>
                            <button
                                type="button"
                                onClick={() => settErHistorikkUtvidet((prev) => !prev)}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                                aria-label={erHistorikkUtvidet ? chatHandlingTekster.hideHistory : chatHandlingTekster.showHistory}
                            >
                                {erHistorikkUtvidet ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                        </div>
                        {!erHistorikkUtvidet ? null : historyChats.length === 0 ? (
                            <div className="px-5 py-2 text-xs text-slate-500 dark:text-slate-400">
                                {t("dashboard.sidebar.noChatsYet")}
                            </div>
                        ) : (
                            historyChats.map((chat) => renderChatRad(chat, "history"))
                        )}
                        {erHistorikkUtvidet && hasHiddenHistoryChats && (
                            <Link
                                href="/dashboard/samtalehistorikk"
                                prefetch={false}
                                onClick={() => {
                                    lukkVenstreMenyHvisMobil();
                                }}
                                className="mt-1 block px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                            >
                                {chatHandlingTekster.showMore}
                            </Link>
                        )}
                    </div>

                    {/* Canvas-seksjon */}
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-10">
                        <button
                            type="button"
                            onClick={() => settErCanvasUtvidet(!erCanvasUtvidet)}
                            aria-expanded={erCanvasUtvidet}
                            aria-controls="sidebar-canvas-menu"
                            className="w-full flex items-center justify-between px-5 py-3.5 text-xs font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300 transition-colors rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                        >
                            <span>{t("dashboard.sidebar.canvas")}</span>
                            {erCanvasUtvidet ? (
                                <ChevronDown size={14} />
                            ) : (
                                <ChevronRight size={14} />
                            )}
                        </button>

                        {erCanvasUtvidet && (
                            <div id="sidebar-canvas-menu" className="mt-2 space-y-1">
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
                </nav>

                {/* Innstillinger + Profil + Admin (fast i bunn) */}
                <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 px-5 py-3 space-y-1">
                    <NavElement view="settings" icon={Settings} label={t("dashboard.sidebar.settings")} />
                    <Link
                        href="/account"
                        prefetch={false}
                        aria-current={effektivPathname === "/account" || effektivPathname.startsWith("/account/") ? "page" : undefined}
                        onClick={() => {
                            setPendingVisning(null);
                            lukkVenstreMenyHvisMobil();
                        }}
                        className={`
                            w-full flex items-center gap-3 px-5 py-3.5 rounded-xl text-left text-sm
                            transition-colors duration-150
                            focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                            ${pathname === "/account" || pathname.startsWith("/account/")
                                ? "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                                : "text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200"
                            }
                        `}
                    >
                        <UserRound size={18} className="shrink-0" />
                        <span className="truncate">{t("dashboard.sidebar.profile")}</span>
                    </Link>
                    {skalViseAdmin && (
                        <NavElement view="admin" icon={Shield} label={t("dashboard.sidebar.admin")} />
                    )}
                </div>

                {/* Bruker-seksjon */}
                <div className="shrink-0 px-5 py-2.5 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div
                            className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 font-medium text-xs ${
                                visBrukerPlaceholder
                                    ? "bg-slate-200 dark:bg-slate-700 animate-pulse"
                                    : "bg-slate-200 dark:bg-slate-700"
                            }`}
                            aria-hidden={visBrukerPlaceholder ? "true" : undefined}
                        >
                            {visBrukerPlaceholder ? null : brukernavn ? brukernavn.charAt(0).toUpperCase() : "?"}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                            {visBrukerPlaceholder ? (
                                <>
                                    <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" aria-hidden="true" />
                                    <div className="h-3 w-16 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" aria-hidden="true" />
                                </>
                            ) : (
                                <>
                                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate leading-tight">
                                        {brukernavn || t("common.labels.notSignedIn")}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight">
                                        {t("common.labels.canvasUser")}
                                    </p>
                                </>
                            )}
                        </div>
                        {kanLoggUt ? (
                            <button
                                type="button"
                                onClick={handleLoggUt}
                                className="shrink-0 p-2 -mr-2 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                                aria-label={t("common.actions.signOut")}
                                title={t("common.actions.signOut")}
                            >
                                <LogOut size={18} />
                            </button>
                        ) : null}
                    </div>
                </div>
            </aside>
            {renameModalChatId && (
                <div
                    className="fixed inset-0 z-120 flex items-center justify-center bg-black/35 p-4"
                    onClick={handleCloseRenameModal}
                    role="presentation"
                >
                    <div
                        ref={renameDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={renameTitleId}
                        aria-describedby={renameDescriptionId}
                        tabIndex={-1}
                        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <h3 id={renameTitleId} className="text-3xl font-semibold text-slate-900 dark:text-slate-100">{t("chatActions.renameChatTitle")}</h3>
                            <button
                                ref={renameCloseButtonRef}
                                type="button"
                                onClick={handleCloseRenameModal}
                                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                aria-label={t("chatActions.renameChatClose")}
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <p id={renameDescriptionId} className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                            {t("chatActions.renameChatDescription")}
                        </p>
                        <label htmlFor={renameInputId} className="sr-only">
                            {t("chatActions.renameChatLabel")}
                        </label>
                        <textarea
                            ref={renameInputRef}
                            id={renameInputId}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            rows={3}
                            className="w-full resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-xl dark:border-slate-700 dark:bg-slate-950"
                        />
                        <div className="mt-4 flex justify-end">
                            <button
                                type="button"
                                onClick={async () => {
                                    const next = renameValue.trim();
                                    if (!next || !renameModalChatId) return;
                                    const ok = await setChatTitle(renameModalChatId, next);
                                    if (ok) {
                                        handleCloseRenameModal();
                                    }
                                }}
                                disabled={!renameValue.trim()}
                                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
                            >
                                {t("chatActions.renameChatSave")}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}  
