/*
* KI API klient for frontend
* Håndterer kommunikasjon med backend API for AI funksjonalitet
* Henter zod schemas fra common for validering av data
* Ment for eksempel/testing men må forbli noe lignende, struktur fortsatt den samme.
*/

import type { ZodType } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
    KIChatResponseSchema,
} from "common/ki";

export type {
    KIChatResponse,
} from "common/ki";

// API funksjoner
async function fetchKI<T>(endpoint: string, schema: ZodType<T>): Promise<T> {
    // Bruker relativ URL slik at Next.js rewrites håndterer videresending
    const res = await fetch(`/api/ki${endpoint}`);

    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.melding || error.feil || "API feil");
    }

    const data = await res.json();
    return schema.parse(data);
}

// React query hooks
export function useKITestConnection() {
    return useQuery({
        queryKey: ["ki", "test-connection"],
        queryFn: () => fetchKI("/test-connection", KIChatResponseSchema),
        enabled: false, // Kun kjør manuelt (via refetch)
    });
}