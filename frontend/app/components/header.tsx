/*
* Header-komponent
* Håndterer navigasjon og brukerinteraksjon i toppseksjonen
*/
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Sun } from "lucide-react";
import { useUIStore } from "../store/uiStore";
import { useMeg, useLoggUt } from "../auth/auth-api";
import { useQueryClient } from "@tanstack/react-query";
import { broadcastLogout } from "../hooks/use-auth-sync";
import { useTheme } from "next-themes";

// Header-komponent
export function Header() {
    const pathname = usePathname();
    const { toggleVenstreMeny, reset: resetUIStore } = useUIStore();
    const erDashboard = pathname === "/dashboard";
    const queryClient = useQueryClient();
    const megQuery = useMeg();
    const authLaster = megQuery.isLoading || megQuery.isFetching;
    const loggUt = useLoggUt();
    const { theme, setTheme } = useTheme();
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

    // Render
    return (
        <header className="shrink-0 h-14 px-4 md:px-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 sticky top-0 z-30">
            <div className="flex items-center gap-3">
                {erDashboard && (
                    <button
                        onClick={toggleVenstreMeny}
                        className="md:hidden p-1 -ml-1 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                        aria-label="Toggle menu"
                    >
                        <Menu size={24} />
                    </button>
                )}
                <div className="font-semibold text-lg text-slate-900 dark:text-white">
                    <Link href="/hjem">StudyWise</Link>
                </div>
            </div>
            <nav className="hidden md:flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
                <Link href="/hjem" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    Hjem
                </Link>
                <Link href="/dashboard" className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                    Dashboard
                </Link>
                {authLaster ? (
                    <span className="w-16 h-4 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" aria-hidden />
                ) : megQuery.data?.user ? (
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
                    onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                    className="p-1 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    aria-label="Bytt tema"
                >
                    {/* suppressHydrationWarning brukes fordi nettleser-utvidelser (som Dark Reader) kan endre attributter og skape Hydration Error */}
                    <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" suppressHydrationWarning />
                    <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" suppressHydrationWarning />
                </button>
            </nav>
        </header>
    );
}
