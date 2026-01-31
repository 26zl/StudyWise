/*
* KI API klient for frontend
* Håndterer kommunikasjon med backend API for AI funksjonalitet
* Henter zod schemas fra common for validering av data
*/

import type { ZodType } from "zod";
import { z } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
    KIChatResponseSchema,
    KIModelsResponseSchema,
    KIPdfAnalyseResponseSchema,
    type KIChatRequest,
    type KIModelsResponse,
    type KIPdfAnalyseResponse,
} from "common/ki";
import { fornySesjon } from "../auth/auth-api";

// Eksporter typer
export type {
    KIChatResponse,
    KIMessage,
} from "common/ki";

export type ModelsResponse = KIModelsResponse;

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

// POST funksjon for chat
async function postKI<T>(
    endpoint: string, 
    body: unknown, 
    schema: ZodType<T>, 
    forsoktRefresh = false
): Promise<T> {
    const res = await fetch(`/api/ki${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
        },
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

// POST funksjon for FormData (brukes av PDF-analyse) med samme auth-retry som øvrige kall
async function postKIFormData<T>(
    endpoint: string,
    formData: FormData,
    schema: ZodType<T>,
    forsoktRefresh = false
): Promise<T> {
    const res = await fetch(`/api/ki${endpoint}`, {
        method: "POST",
        credentials: "include",
        body: formData,
    });
    if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
        await fornySesjon();
        return postKIFormData(endpoint, formData, schema, true);
    }
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.melding || error.feil || "API feil");
    }
    const data = await res.json();
    return schema.parse(data);
}

// React query hooks

// Test tilkobling
export function useKITestTilkobling() {
    return useQuery({
        queryKey: ["ki", "test-connection"],
        queryFn: () => fetchKI("/test-connection", KIChatResponseSchema),
        enabled: false, // Kun kjør manuelt (via refetch)
    });
}

// Hent støttede modeller
export function useKIModeller() {
    return useQuery({
        queryKey: ["ki", "models"],
        queryFn: () => fetchKI("/models", KIModelsResponseSchema),
        staleTime: 1000 * 60 * 5, // Cache i 5 minutter
    });
}

// Chat mutation hook
export function useKIChat() {
    const mutation = useMutation({
        mutationFn: (request: KIChatRequest) => 
            postKI("/chat", request, KIChatResponseSchema),
    });

    return {
        sendMelding: (
            messages: Array<{ role: string; content: string }>,
            options?: {
                model?: string;
                temperature?: number;
                onSuccess?: (data: z.infer<typeof KIChatResponseSchema>) => void;
                onError?: (error: Error) => void;
            }
        ) => {
            const request: KIChatRequest = {
                messages: messages.map(m => ({
                    role: m.role as "user" | "assistant" | "system",
                    content: m.content,
                })),
                model: options?.model,
                temperature: options?.temperature,
            };
            
            mutation.mutate(request, {
                onSuccess: options?.onSuccess,
                onError: options?.onError,
            });
        },
        isLoading: mutation.isPending,
        error: mutation.error,
        data: mutation.data,
        reset: mutation.reset,
        mutation,
    };
}

// Schema for PDF-analyse respons
export type PdfAnalyseResponse = KIPdfAnalyseResponse;

// PDF analyse hook
export function useKIPdfAnalyse() {
    const mutation = useMutation({
        mutationFn: async ({ 
            fil, 
            sporsmaal, 
            model 
        }: { 
            fil: File; 
            sporsmaal?: string; 
            model?: string;
        }) => {
            const formData = new FormData();
            formData.append("pdf", fil);
            if (sporsmaal) formData.append("question", sporsmaal);
            if (model) formData.append("model", model);
            return postKIFormData("/analyze-pdf", formData, KIPdfAnalyseResponseSchema);
        },
    });

    return {
        analyserPdf: (
            fil: File,
            sporsmaal?: string,
            options?: {
                model?: string;
                onSuccess?: (data: PdfAnalyseResponse) => void;
                onError?: (error: Error) => void;
            }
        ) => {
            mutation.mutate(
                { fil, sporsmaal, model: options?.model },
                {
                    onSuccess: options?.onSuccess,
                    onError: options?.onError,
                }
            );
        },
        isLoading: mutation.isPending,
        error: mutation.error,
        data: mutation.data,
        reset: mutation.reset,
        mutation,
    };
}