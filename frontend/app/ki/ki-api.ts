/*
* KI API klient for frontend
* Håndterer kommunikasjon med backend API for AI funksjonalitet
* Henter zod schemas fra common for validering av data
*/

import type { ZodType } from "zod";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
    KIChatResponseSchema,
    type KIChatRequest,
} from "common/ki";
import { fornySesjon } from "../auth/auth-api";
import { z } from "zod";

// Eksporter typer
export type {
    KIChatResponse,
    KIMessage,
} from "common/ki";

// Schema for modell-liste
const ModelsResponseSchema = z.object({
    models: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        isDefault: z.boolean(),
    })),
    defaultModel: z.string(),
});

export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

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
        queryFn: () => fetchKI("/models", ModelsResponseSchema),
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
    };
}

// Schema for PDF-analyse respons
const PdfAnalyseResponseSchema = z.object({
    suksess: z.boolean(),
    melding: z.string().optional(),
    response: z.string(),
    model: z.string().optional(),
    dokumentInfo: z.object({
        sider: z.number(),
        tegn: z.number(),
    }).optional(),
    usage: z.object({
        prompt_tokens: z.number(),
        completion_tokens: z.number(),
        total_tokens: z.number(),
    }).optional(),
});

export type PdfAnalyseResponse = z.infer<typeof PdfAnalyseResponseSchema>;

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
            formData.append('pdf', fil);
            if (sporsmaal) formData.append('question', sporsmaal);
            if (model) formData.append('model', model);

            const res = await fetch('/api/ki/analyze-pdf', {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.melding || 'Kunne ikke analysere PDF');
            }

            const data = await res.json();
            return PdfAnalyseResponseSchema.parse(data);
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
    };
}