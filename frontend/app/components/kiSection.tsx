/*
* Kun ment for testing/eksempel, UI/UX må endres.
* Placeholder
*/


"use client";


import { useKITestConnection } from "../ki/ki-api";

export function KISection() {
    const { data: response, error, isLoading, refetch } = useKITestConnection();

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
    );
}
