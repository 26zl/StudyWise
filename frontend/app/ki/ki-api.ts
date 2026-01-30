/*
* KI API klient for frontend
* Håndterer kommunikasjon med backend API for AI funksjonalitet
* Henter zod schemas fra common for validering av data
*/

import type { ZodType } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
    KIChatResponseSchema,
} from "common/ki";
import { fornySesjon } from "../auth/auth-api";

// Eksporter typer
export type {
    KIChatResponse,
    KIMessage,
} from "common/ki";

// API funksjoner for GET requests
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

// API funksjoner for POST requests
async function postKI<T>(endpoint: string, body: unknown, schema: ZodType<T>, forsoktRefresh = false): Promise<T> {
    const res = await fetch(`/api/ki${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(body),
    });
    
    if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
        await fornySesjon();
        return postKI(endpoint, body, schema, true);
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

// React query hook for chat
export function useKIChat() {
    const mutation = useMutation({
        mutationFn: (messages: Array<{ role: string; content: string }>) =>
            postKI("/chat", { messages }, KIChatResponseSchema),
    });

    return {
        sendMelding: mutation.mutate,
        isLoading: mutation.isPending,
        isError: mutation.isError,
        error: mutation.error,
        data: mutation.data,
    };
} 