/*
* KI Assistent seksjon i Dashboard
* Viser chat-modal når bruker trykker "Start ny samtale"
*/
"use client";

import { useState } from "react";
import { useKITestConnection } from "../ki/ki-api";
import KiChat from "./kiChat";

// KI Seksjon komponent
export function KISection() {
    const [isChatOpen, setIsChatOpen] = useState(false);
    const { data: response, error, isLoading, refetch } = useKITestConnection();

    // Test KI tilkobling
    const testConnection = async () => {
        refetch();
    };

    const status = isLoading
        ? "Kobler til..."
        : error
            ? `Feil: ${error.message}`
            : response?.suksess
                ? "Tilkoblet!"
                : response
                    ? `Feil: ${response.melding}`
                    : null;
    // Render KI seksjon
    return (
        <>
        <div className="p-4 sm:p-6 md:p-8 border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-700 text-center transition-colors">
            <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4 text-gray-900 dark:text-gray-100">KI Assistent</h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-4 sm:mb-6">
                Start en samtale med din personlige studieassistent.
            </p>

            <div className="flex flex-col items-center gap-4">
                <button 
                    onClick={() => setIsChatOpen(true)}
                    className="px-5 py-2.5 sm:px-6 sm:py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-lg transition-all text-sm sm:text-base font-medium shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40"
                >
                    Start ny samtale
                </button>

                <div className="mt-4 border-t dark:border-gray-700 pt-4 w-full">
                    <button
                        onClick={testConnection}
                        disabled={isLoading}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 text-sm"
                    >
                        {isLoading ? "Tester..." : "Test AI Kobling"}
                    </button>

                    {status && (
                        <div className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                            <p className="font-bold">{status}</p>
                            {response && (
                                <pre className="mt-2 text-xs text-left bg-gray-100 dark:bg-gray-800 dark:text-gray-200 p-2 rounded overflow-auto max-h-40 border dark:border-gray-700">
                                    {JSON.stringify(response, null, 2)}
                                </pre>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* KI Chat */}
        <KiChat isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
        </>
    );
}
