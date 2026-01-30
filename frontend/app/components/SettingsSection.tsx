/*
 * SettingsSection - Brukerinnstillinger
 * Håndterer tema, Canvas-token og andre preferanser
 */
"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Moon, Sun, Key, User, Shield, Info } from "lucide-react";
import { useLagreCanvasToken } from "../auth/auth-api";
import { useTheme } from "next-themes";

// Typer for SettingsSection props
interface SettingsSectionProps {
    brukernavn?: string;
    harCanvasToken?: boolean;
}
// Settings seksjon komponent
export function SettingsSection({
    brukernavn,
    harCanvasToken,
}: SettingsSectionProps) {
    const { setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    // Sett mounted til true etter første render
    useEffect(() => {
        setMounted(true);
    }, []);

    // Bestem om mørk modus er aktiv
    const isDarkMode = mounted && resolvedTheme === "dark";
    const toggleTheme = () => setTheme(isDarkMode ? "light" : "dark");
    const queryClient = useQueryClient();
    const erCanvasTokenDeaktivert = false;
    const [canvasToken, setCanvasToken] = useState("");
    const [visToken, setVisToken] = useState(false);
    const {
        mutateAsync,
        isPending,
        isSuccess,
        isError,
        error,
        data,
    } = useLagreCanvasToken();

    const [cooldown, setCooldown] = useState(false);

    // Håndter lagring av Canvas token
    const handleLagreToken = async () => {
        if (erCanvasTokenDeaktivert || cooldown) return;
        const trimmetToken = canvasToken.trim();
        if (!trimmetToken) return;
        try {
            await mutateAsync(trimmetToken);
            setCanvasToken("");
            queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
            // Sett cooldown for å hindre spamming
            setCooldown(true);
            setTimeout(() => setCooldown(false), 3000);
        } catch {
            // Feil håndteres i UI
        }
    };

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="shrink-0 px-4 md:px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                    Innstillinger
                </h2>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6">
                <div className="max-w-2xl space-y-6">
                    {/* Brukerinformasjon */}
                    <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <User size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Profil
                            </h3>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-2xl font-medium text-slate-600 dark:text-slate-300">
                                {brukernavn ? brukernavn.charAt(0).toUpperCase() : "?"}
                            </div>
                            <div>
                                <p className="font-medium text-slate-900 dark:text-white">
                                    {brukernavn || "Ikke innlogget"}
                                </p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Canvas-bruker
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Utseende */}
                    <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                {isDarkMode ? (
                                    <Moon size={20} className="text-slate-600 dark:text-slate-300" />
                                ) : (
                                    <Sun size={20} className="text-slate-600 dark:text-slate-300" />
                                )}
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Utseende
                            </h3>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-slate-700 dark:text-slate-300">Mørk modus</p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Bytt mellom lyst og mørkt tema
                                </p>
                            </div>
                            <button
                                onClick={toggleTheme}
                                className={`shrink-0 w-14 h-8 rounded-full p-1 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${isDarkMode ? "bg-blue-600" : "bg-slate-200 dark:bg-slate-600"
                                    }`}
                                role="switch"
                                aria-checked={isDarkMode}
                            >
                                <span
                                    className={`block w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200 ${isDarkMode ? "translate-x-6" : "translate-x-0"
                                        }`}
                                />
                            </button>
                        </div>
                    </section>

                    {/* Canvas Token */}
                    <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <Key size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Canvas API Token
                            </h3>
                        </div>

                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                            Koble til din Canvas-konto for a hente emner, kunngjøringer og
                            frister.
                        </p>

                        {harCanvasToken && (
                            <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                                <div className="flex gap-2">
                                    <Info size={16} className="text-green-600 shrink-0 mt-0.5" />
                                    <p className="text-sm text-green-700 dark:text-green-300">
                                        Canvas-token er koblet til kontoen din.
                                    </p>
                                </div>
                            </div>
                        )}

                        {isSuccess && (
                            <div className="mb-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                                <div className="flex gap-2">
                                    <Info size={16} className="text-green-600 shrink-0 mt-0.5" />
                                    <p className="text-sm text-green-700 dark:text-green-300">
                                        {data?.melding || "Token lagret. Canvas-data blir tilgjengelig om kort tid."}
                                    </p>
                                </div>
                            </div>
                        )}

                        {isError && (
                            <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                                <div className="flex gap-2">
                                    <Info size={16} className="text-red-600 shrink-0 mt-0.5" />
                                    <p className="text-sm text-red-700 dark:text-red-300">
                                        {error instanceof Error ? error.message : "Kunne ikke lagre token"}
                                    </p>
                                </div>
                            </div>
                        )}

                        <fieldset
                            disabled={erCanvasTokenDeaktivert}
                            className={`space-y-3 ${erCanvasTokenDeaktivert ? "opacity-60 cursor-not-allowed" : ""}`}
                        >
                            <div className="relative">
                                <input
                                    type={visToken ? "text" : "password"}
                                    value={canvasToken}
                                    onChange={(e) => {
                                        setCanvasToken(e.target.value);
                                    }}
                                    placeholder="Lim inn din Canvas API token"
                                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setVisToken(!visToken)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                >
                                    {visToken ? "Skjul" : "Vis"}
                                </button>
                            </div>

                            <button
                                onClick={handleLagreToken}
                                disabled={!canvasToken.trim() || erCanvasTokenDeaktivert || isPending || cooldown}
                                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {isPending ? "Lagrer..." : "Lagre token"}
                            </button>
                        </fieldset>

                        {/* Infoboks */}
                        <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                            <div className="flex gap-2">
                                <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
                                <div className="text-sm text-blue-700 dark:text-blue-300">
                                    <p className="font-medium mb-1">Slik far du en API token:</p>
                                    <ol className="list-decimal list-inside space-y-1 text-blue-600 dark:text-blue-400">
                                        <li>Logg inn pa Canvas</li>
                                        <li>Ga til Innstillinger → Godkjente integrasjoner</li>
                                        <li>Klikk &quot;Ny tilgangstoken&quot;</li>
                                        <li>Kopier token og lim inn her</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Personverninfo */}
                    <section className="p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700">
                                <Shield size={20} className="text-slate-600 dark:text-slate-300" />
                            </div>
                            <h3 className="font-semibold text-slate-900 dark:text-white">
                                Personvern
                            </h3>
                        </div>

                        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
                            <p>
                                Din Canvas API token lagres kryptert og brukes kun til a hente
                                dine egne data fra Canvas.
                            </p>
                            <p>
                                Vi sender aldri personlig informasjon til eksterne AI-tjenester
                                uten anonymisering.
                            </p>
                            <p>
                                Du kan slette kontoen din og all tilknyttet data nar som helst.
                            </p>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
