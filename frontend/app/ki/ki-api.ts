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
    KIDocumentAnalyseResponseSchema,
    type KIChatRequest,
    type KIModelsResponse,
    type KIDocumentAnalyseResponse,
} from "common/ki";
import { fornySesjon } from "../auth/auth-api";

// Eksporter typer
export type {
    KIChatResponse,
    KIMessage,
} from "common/ki";

export type ModelsResponse = KIModelsResponse;

// Støttede filtyper for dokumentopplasting (inkluderer bilder for OCR)
export const SUPPORTED_FILE_TYPES = [
    ".pdf",
    ".docx",
    ".doc",
    ".txt",
    ".md",
    ".csv",
    // Bilder for OCR
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".bmp",
    ".tiff",
    ".tif",
];

export const SUPPORTED_MIME_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
    "text/markdown",
    "text/csv",
    // Bilder for OCR
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
];

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

// Schema for dokumentanalyse respons
export type DocumentAnalyseResponse = KIDocumentAnalyseResponse;

// Dokumentanalyse hook (støtter PDF, Word, TXT, etc.)
export function useKIDocumentAnalyse() {
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
            formData.append("document", fil);
            if (sporsmaal) formData.append("question", sporsmaal);
            if (model) formData.append("model", model);
            return postKIFormData("/analyze-document", formData, KIDocumentAnalyseResponseSchema);
        },
    });

    return {
        analyserDokument: (
            fil: File,
            sporsmaal?: string,
            options?: {
                model?: string;
                onSuccess?: (data: DocumentAnalyseResponse) => void;
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

// Legacy PDF hook (bruk useKIDocumentAnalyse i stedet)
export function useKIPdfAnalyse() {
    const docAnalyse = useKIDocumentAnalyse();
    
    return {
        analyserPdf: docAnalyse.analyserDokument,
        isLoading: docAnalyse.isLoading,
        error: docAnalyse.error,
        data: docAnalyse.data,
        reset: docAnalyse.reset,
        mutation: docAnalyse.mutation,
    };
}