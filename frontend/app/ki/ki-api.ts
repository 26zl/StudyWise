/*
* KI API klient for frontend
* Håndterer kommunikasjon med backend API for AI funksjonalitet
* Henter zod schemas fra common for validering av data
*/

import type { ZodType } from "zod";
import { useQuery } from "@tanstack/react-query";
import {
    KIChatResponseSchema,
} from "common/ki";
import { fornySesjon } from "../auth/auth-api";

// Eksporter typer
export type {
    KIChatResponse,
} from "common/ki";

// API funksjoner
async function fetchKI<T>(endpoint: string, schema: ZodType<T>, forsoktRefresh = false): Promise<T> {
    // Bruker relativ URL slik at Next.js rewrites håndterer videresending
    const res = await fetch(`/api/ki${endpoint}`, {
        credentials: "include",
        cache: "no-store",
    });
    if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
        await fornySesjon();
        return fetchKI(endpoint, schema, true);
    }
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.melding || error.feil || "API feil");
    }
    const data = await res.json();
    return schema.parse(data);
}

// React query hooks
export function useKITestTilkobling() {
    return useQuery({
        queryKey: ["ki", "test-connection"],
        queryFn: () => fetchKI("/test-connection", KIChatResponseSchema),
        enabled: false, // Kun kjør manuelt (via refetch)
    });
}