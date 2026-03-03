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
  KIOppsummeringResponseSchema,
  KI_MAX_MESSAGE_LENGTH_FRONTEND,
  type KIChatRequest,
  type KIModelsResponse,
  type KIDocumentAnalyseResponse,
  type KIOppsummeringResponse,
} from "common/ki";
import { fornySesjon } from "../auth/auth-api";

// Eksporter typer
export type { KIChatResponse, KIMessage } from "common/ki";

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

// Maks tegn for meldinger (importert fra common)

/**
 * Trimmer meldingshistorikk for å holde seg under maks tegngrense.
 * Beholder alltid:
 * 1. System-meldingen (hvis den finnes)
 * 2. Den nyeste bruker-meldingen
 * 3. Så mange eldre meldinger som mulig (nyeste først)
 */
function trimMessages(
  messages: Array<{ role: string; content: string }>,
  maxLength: number = KI_MAX_MESSAGE_LENGTH_FRONTEND,
): Array<{ role: string; content: string }> {
  if (messages.length === 0) return messages;

  // Beregn total lengde
  const totalLength = messages.reduce(
    (sum, m) => sum + (m.content?.length || 0),
    0,
  );
  if (totalLength <= maxLength) return messages;

  // Separer system-melding fra resten
  const systemMessage = messages.find((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  // Start med system-melding og nyeste melding
  const result: Array<{ role: string; content: string }> = [];
  let currentLength = 0;

  // Legg til system-melding først (hvis den finnes)
  if (systemMessage) {
    result.push(systemMessage);
    currentLength += systemMessage.content?.length || 0;
  }

  // Legg til meldinger fra nyeste til eldste
  const reversedMessages = [...nonSystemMessages].reverse();
  const messagesToAdd: Array<{ role: string; content: string }> = [];

  for (const msg of reversedMessages) {
    const msgLength = msg.content?.length || 0;
    if (currentLength + msgLength <= maxLength) {
      messagesToAdd.unshift(msg); // Legg til i starten for å bevare rekkefølge
      currentLength += msgLength;
    } else {
      // Ikke plass til flere hele meldinger
      break;
    }
  }

  // Kombiner system-melding med de andre meldingene
  result.push(...messagesToAdd);

  // Logg hvis vi trimmet
  if (result.length < messages.length) {
    console.info(
      `[KI] Trimmet samtalehistorikk: ${messages.length} → ${result.length} meldinger ` +
        `(${totalLength} → ${currentLength} tegn)`,
    );
  }

  return result;
}

// Spesialiserte feilklasser - importert fra felles error-modul
import {
  KIAuthError,
  KIRateLimitError,
  KIServiceError,
  KITimeoutError,
} from "../lib/errors";

// Re-eksporter for konsumenter
export { KIAuthError, KIRateLimitError, KIServiceError, KITimeoutError };

// API funksjoner
async function fetchKI<T>(
  endpoint: string,
  schema: ZodType<T>,
  forsoktRefresh = false,
): Promise<T> {
  // Bruker relativ URL slik at Next.js rewrites håndterer videresending
  const res = await fetch(`/api/ki${endpoint}`, {
    credentials: "include",
    cache: "no-store",
  });

  // Håndter 401 (ikke autentisert) - prøv refresh token
  if (res.status === 401 && !forsoktRefresh) {
    await fornySesjon();
    return fetchKI(endpoint, schema, true);
  }

  // Håndter spesifikke feilkoder med egne feilklasser
  if (res.status === 401) {
    throw new KIAuthError(
      "Du må logge inn på nytt for å bruke KI-assistenten.",
    );
  }
  if (res.status === 429) {
    throw new KIRateLimitError(
      "For mange forespørsler. Vent litt og prøv igjen.",
    );
  }
  if (res.status === 503 || res.status === 502) {
    throw new KIServiceError(
      "KI-tjenesten er midlertidig utilgjengelig. Prøv igjen om noen minutter.",
    );
  }
  if (res.status === 504) {
    throw new KITimeoutError(
      "Forespørselen tok for lang tid. Prøv å forenkle spørsmålet.",
    );
  }
  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = "API feil";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  const data = await res.json();
  return schema.parse(data);
}

// POST funksjon for chat
async function postKI<T>(
  endpoint: string,
  body: unknown,
  schema: ZodType<T>,
  forsoktRefresh = false,
): Promise<T> {
  const res = await fetch(`/api/ki${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // Håndter 401 (ikke autentisert) - prøv refresh token
  if (res.status === 401 && !forsoktRefresh) {
    await fornySesjon();
    return postKI(endpoint, body, schema, true);
  }

  // Håndter spesifikke feilkoder med egne feilklasser
  if (res.status === 401) {
    throw new KIAuthError(
      "Du må logge inn på nytt for å bruke KI-assistenten.",
    );
  }
  if (res.status === 413) {
    throw new Error(
      "Samtalen er for lang. Start en ny samtale for å fortsette.",
    );
  }
  if (res.status === 429) {
    throw new KIRateLimitError(
      "For mange forespørsler. Vent litt og prøv igjen.",
    );
  }
  if (res.status === 503 || res.status === 502) {
    throw new KIServiceError(
      "KI-tjenesten er midlertidig utilgjengelig. Prøv igjen om noen minutter.",
    );
  }
  if (res.status === 504) {
    throw new KITimeoutError(
      "Forespørselen tok for lang tid. Prøv å forenkle spørsmålet.",
    );
  }
  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = "API feil";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
  }
  const data = await res.json();
  return schema.parse(data);
}

// POST funksjon for FormData (brukes av PDF-analyse) med samme auth-retry som øvrige kall
async function postKIFormData<T>(
  endpoint: string,
  formData: FormData,
  schema: ZodType<T>,
  forsoktRefresh = false,
): Promise<T> {
  const res = await fetch(`/api/ki${endpoint}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  // Håndter 401 (ikke autentisert) - prøv refresh token
  if (res.status === 401 && !forsoktRefresh) {
    await fornySesjon();
    return postKIFormData(endpoint, formData, schema, true);
  }
  // Håndter spesifikke feilkoder
  if (res.status === 401) {
    throw new KIAuthError(
      "Du må logge inn på nytt for å analysere dokumenter.",
    );
  }
  if (res.status === 413) {
    throw new Error("Filen er for stor. Maksimal filstørrelse er 15MB.");
  }
  if (res.status === 429) {
    throw new KIRateLimitError(
      "For mange forespørsler. Vent litt og prøv igjen.",
    );
  }
  if (res.status === 503 || res.status === 502) {
    throw new KIServiceError(
      "Dokumentanalyse er midlertidig utilgjengelig. Prøv igjen om noen minutter.",
    );
  }
  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = "API feil";
    try {
      const error = JSON.parse(errorText);
      errorMessage = error.melding || error.feil || errorMessage;
    } catch {
      errorMessage = errorText || errorMessage;
    }
    throw new Error(errorMessage);
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
      },
    ) => {
      // Trim meldinger for å unngå 413 Payload Too Large
      const trimmedMessages = trimMessages(messages);

      const request: KIChatRequest = {
        messages: trimmedMessages.map((m) => ({
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
      model,
    }: {
      fil: File;
      sporsmaal?: string;
      model?: string;
    }) => {
      const formData = new FormData();
      formData.append("document", fil);
      if (sporsmaal) formData.append("question", sporsmaal);
      if (model) formData.append("model", model);
      return postKIFormData(
        "/analyze-document",
        formData,
        KIDocumentAnalyseResponseSchema,
      );
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
      },
    ) => {
      mutation.mutate(
        { fil, sporsmaal, model: options?.model },
        {
          onSuccess: options?.onSuccess,
          onError: options?.onError,
        },
      );
    },
    isLoading: mutation.isPending,
    error: mutation.error,
    data: mutation.data,
    reset: mutation.reset,
    mutation,
  };
}

// Oppsummering av kunngjøringer
export type { KIOppsummeringResponse };

export function useKIOppsummering() {
  const mutation = useMutation({
    mutationFn: (request: {
      tekst: string;
      type?: "tldr" | "handlinger" | "begge";
    }) => postKI("/oppsummering", request, KIOppsummeringResponseSchema),
  });

  return {
    oppsummer: (
      tekst: string,
      options?: {
        type?: "tldr" | "handlinger" | "begge";
        onSuccess?: (data: KIOppsummeringResponse) => void;
        onError?: (error: Error) => void;
      },
    ) => {
      mutation.mutate(
        { tekst, type: options?.type ?? "begge" },
        {
          onSuccess: options?.onSuccess,
          onError: options?.onError,
        },
      );
    },
    isPending: mutation.isPending,
    data: mutation.data,
    error: mutation.error,
    reset: mutation.reset,
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
