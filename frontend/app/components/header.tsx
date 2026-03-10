/*
* Header-komponent
* Håndterer navigasjon og brukerinteraksjon i toppseksjonen
*/
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Sun, X, MoreVertical } from "lucide-react";
import { useUIStore } from "../store/uiStore";
import { useMeg, useLoggUtWithRedirect } from "../auth/auth-api";
import { useTheme } from "next-themes";
import { type MeResponse } from "common/auth";
import { useState, useEffect } from "react";

// Props for Header-komponenten
interface HeaderProps {
    user: MeResponse | null;
    /** True når server så auth-cookies – da viser vi skeleton til /me er avklart, ikke «Logg inn» med én gang. */
    hadCookies?: boolean;
}

// Header-komponent
export function Header({ user, hadCookies = false }: HeaderProps) {
    const pathname = usePathname();
    const { toggleVenstreMeny, isVenstreMenyOpen } = useUIStore();
    const harSidebar = ["/dashboard", "/oversikt", "/test-ai-breakdown"].includes(pathname);
    // Kun bruk server-data som initialData når vi har bekrevet innlogget bruker – aldri null (unngår at transient SSR-feil caches som gjest)
    const megQuery = useMeg({ initialData: user?.user ? user : undefined });
    const [mobilMenyOpen, setMobilMenyOpen] = useState(false);

    const aktivBruker = megQuery.data?.user ?? user?.user;
    const authLaster = megQuery.isLoading && !aktivBruker;
    /** Skeleton bare når server hadde cookies men vi venter fortsatt på /me – da er vi sannsynligvis innlogget. Gjester (hadCookies=false) ser «Logg inn» med én gang. */
    const visSkeleton = authLaster && hadCookies;

    const handleLoggUt = useLoggUtWithRedirect();
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    // Lukk dropdown-meny når bruker navigerer (pathname endres)
    useEffect(() => {
        setMobilMenyOpen(false);
    }, [pathname]);

    const handleMobilNavigation = () => {
        setMobilMenyOpen(false);
    };

    // Render
    return (
        <header className="shrink-0 h-14 px-4 md:px-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 sticky top-0 z-30">
            <div className="flex items-center gap-3">
                {/* Venstre: knapp for å åpne/lukke venstremeny (sidebar) — både mobil og desktop */}
                {harSidebar && (
                    <button
                        onClick={toggleVenstreMeny}
                        className="p-1 -ml-1 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                        aria-label={isVenstreMenyOpen ? "Lukk venstremeny" : "Åpne venstremeny"}
                    >
                        {isVenstreMenyOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                )}
                <div className="font-semibold text-lg text-slate-900 dark:text-white">
                    <Link href="/">StudyWise</Link>
                </div>
            </div>

            {/* Desktop navigasjon */}
            <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
                <Link href="/" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    Hjem
                </Link>
                <Link href="/dashboard" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    Dashboard
                </Link>
                {visSkeleton ? (
                    <span className="w-16 h-4 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" aria-hidden />
                ) : aktivBruker ? (
                    <button
                        onClick={handleLoggUt}
                        className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                        Logg ut
                    </button>
                ) : (
                    <Link href="/auth" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                        Logg inn
                    </Link>
                )}
                <button
                    onClick={() => setTheme(mounted && resolvedTheme === "dark" ? "light" : "dark")}
                    className="p-1 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    aria-label="Bytt tema"
                >
                    {mounted ? (
                        <>
                            <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" suppressHydrationWarning />
                            <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" suppressHydrationWarning />
                        </>
                    ) : (
                        <span className="h-5 w-5 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" aria-hidden />
                    )}
                </button>
            </nav>

            {/* Høyre på mobil: dropdown med Hjem, Dashboard, Logg ut, tema */}
            <button
                onClick={() => setMobilMenyOpen(!mobilMenyOpen)}
                className="md:hidden p-1 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                aria-label={mobilMenyOpen ? "Lukk meny" : "Meny (Hjem, Logg ut, osv.)"}
            >
                {mobilMenyOpen ? <X size={24} /> : <MoreVertical size={24} />}
            </button>
            {mobilMenyOpen && (
                <nav className="md:hidden absolute top-14 left-0 right-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-lg z-40">
                    <div className="flex flex-col p-4 gap-4 text-sm text-slate-600 dark:text-slate-400">
                        <Link
                            href="/"
                            onClick={handleMobilNavigation}
                            className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-2"
                        >
                            Hjem
                        </Link>
                        <Link
                            href="/dashboard"
                            onClick={handleMobilNavigation}
                            className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-2"
                        >
                            Dashboard
                        </Link>
                        {visSkeleton ? (
                            <span className="w-16 h-4 rounded bg-slate-200 dark:bg-slate-700 animate-pulse inline-block" aria-hidden />
                        ) : aktivBruker ? (
                            <button
                                onClick={() => {
                                    handleMobilNavigation();
                                    handleLoggUt();
                                }}
                                className="text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-2"
                            >
                                Logg ut
                            </button>
                        ) : (
                            <Link
                                href="/auth"
                                onClick={handleMobilNavigation}
                                className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-2"
                            >
                                Logg inn
                            </Link>
                        )}
                        <button
                            onClick={() => setTheme(mounted && resolvedTheme === "dark" ? "light" : "dark")}
                            className="flex items-center gap-2 text-left hover:text-blue-600 dark:hover:text-blue-400 transition-colors py-2"
                            aria-label="Bytt tema"
                        >
                            <Sun className="h-5 w-5 dark:hidden" />
                            <Moon className="h-5 w-5 hidden dark:block" />
                            <span>{mounted && resolvedTheme === "dark" ? "Lyst tema" : "Mørkt tema"}</span>
                        </button>
                    </div>
                </nav>
            )}
        </header>
    );
}
