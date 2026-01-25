/*
* Kun ment for testing/eksempel, må endres.
* Placeholder
*/


"use client";
import { useState } from "react";

import { KIChatResponse } from "common/ki";

export function KISection() {
    const [status, setStatus] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState<KIChatResponse | null>(null);

    const testConnection = async () => {
        setLoading(true);
        setStatus("Kobler til...");
        setResponse(null);
        try {
            // Bruker relativ URL slik at Next.js rewrites håndterer videresending
            const res = await fetch("/api/ki/test-connection");
            const data = await res.json();
            if (data.suksess) {
                setStatus("Tilkoblet!");
                setResponse(data);
            } else {
                setStatus("Feil: " + data.melding);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setStatus("Nettverksfeil: " + errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 sm:p-6 md:p-8 border rounded-lg bg-white dark:bg-gray-900 dark:border-gray-700 text-center transition-colors">
            <h2 className="text-xl sm:text-2xl font-bold mb-3 sm:mb-4 text-gray-900 dark:text-gray-100">KI Assistent</h2>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 mb-4 sm:mb-6">
                Her kommer chat-funksjonaliteten.
            </p>

            <div className="flex flex-col items-center gap-4">
                <button className="px-5 py-2.5 sm:px-6 sm:py-3 bg-gray-600 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition-colors text-sm sm:text-base font-medium">
                    Start ny samtale
                </button>

                <div className="mt-4 border-t dark:border-gray-700 pt-4 w-full">
                    <button
                        onClick={testConnection}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 text-sm"
                    >
                        {loading ? "Tester..." : "Test AI Kobling"}
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
    );
}
