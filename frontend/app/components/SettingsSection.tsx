/*
 * SettingsSection - Brukerinnstillinger
 * Håndterer tema, Canvas-token og andre preferanser
 */
"use client";

import { useState } from "react";
import { Moon, Sun, Key, User, Shield, Info } from "lucide-react";

// Typer for SettingsSection props
interface SettingsSectionProps {
    isDarkMode: boolean;
    onToggleDarkMode: () => void;
    userName?: string;
}
// Settings seksjon komponent
export function SettingsSection({
    isDarkMode,
    onToggleDarkMode,
    userName,
}: SettingsSectionProps) {
    const [canvasToken, setCanvasToken] = useState("");
    const [showToken, setShowToken] = useState(false);

    const handleSaveToken = () => {
        // Placeholder foreløpig, kobling til API kommer senere
        console.log("Saving token...");
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
                    {/* User Info */}
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
                                {userName ? userName.charAt(0).toUpperCase() : "?"}
                            </div>
                            <div>
                                <p className="font-medium text-slate-900 dark:text-white">
                                    {userName || "Ikke innlogget"}
                                </p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Canvas-bruker
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* Appearance */}
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
                                <p className="text-slate-700 dark:text-slate-300">Mork modus</p>
                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                    Bytt mellom lyst og morkt tema
                                </p>
                            </div>
                            <button
                                onClick={onToggleDarkMode}
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

                        <div className="space-y-3">
                            <div className="relative">
                                <input
                                    type={showToken ? "text" : "password"}
                                    value={canvasToken}
                                    onChange={(e) => setCanvasToken(e.target.value)}
                                    placeholder="Lim inn din Canvas API token"
                                    className="w-full px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowToken(!showToken)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                                >
                                    {showToken ? "Skjul" : "Vis"}
                                </button>
                            </div>

                            <button
                                onClick={handleSaveToken}
                                disabled={!canvasToken.trim()}
                                className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-medium hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Lagre token
                            </button>
                        </div>

                        {/* Info box */}
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

                    {/* Privacy Info */}
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
