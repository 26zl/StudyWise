/*
 * KI API klient for frontend
 * Håndterer kommunikasjon med backend API for AI funksjonalitet
 * Henter zod schemas fra common for validering av data
 */

import type { ZodType } from "zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  KIChatResponseSchema,
  KIDocumentAnalyseResponseSchema,
  KIOppsummeringResponseSchema,
  KI_MAX_MESSAGE_LENGTH_FRONTEND,
  type KIChatRequest,
  type KIDocumentAnalyseResponse,
  type KIOppsummeringResponse,
} from "common/ki";
import { fornySesjon } from "../auth/auth-api";
import { parseApiError } from "../lib/errorUtils";

// Eksporter typer
export type { KIChatResponse, KIMessage } from "common/ki";

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

// Felles feilhåndtering for KI API-responser
async function håndterKIFeilRespons(res: Response): Promise<void> {
  if (res.status === 401) {
    throw new KIAuthError(
      "Du må logge inn på nytt for å bruke KI-assistenten.",
    );
  }
  if (res.status === 413) {
    throw new Error(
      "For mye data. Prøv med mindre innhold eller start en ny samtale.",
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
  if (res.status >= 500) {
    throw new KIServiceError(
      "Noe gikk galt på serveren. Prøv igjen om litt, eller forenkle spørsmålet ditt.",
    );
  }
  if (!res.ok) {
    throw new Error(await parseApiError(res));
  }
}

// API funksjoner
// POST funksjon for chat (støtter SSE-streaming fra backend)
async function postKI<T>(
  endpoint: string,
  body: unknown,
  schema: ZodType<T>,
  forsoktRefresh = false,
  method: "POST" | "PUT" | "DELETE" = "POST",
): Promise<T> {
  const res = await fetch(`/api/ki${endpoint}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 401 && !forsoktRefresh) {
    await fornySesjon();
    return postKI(endpoint, body, schema, true, method);
  }

  await håndterKIFeilRespons(res);

  const contentType = res.headers.get("Content-Type") || "";

  // SSE-svar fra /chat endepunktet (text/event-stream)
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    const lines = text.split("\n");
    let lastData: string | null = null;

    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        lastData = line.slice(6);
      }
    }

    if (!lastData) {
      throw new Error("Ingen respons mottatt fra KI-tjenesten.");
    }
    return schema.parse(JSON.parse(lastData));
  }

  // Vanlig JSON-svar (feilresponser, andre endepunkter)
  const data = await res.json();
  return schema.parse(data);
}

// POST funksjon for FormData (brukes av dokumentanalyse)
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

  if (res.status === 401 && !forsoktRefresh) {
    await fornySesjon();
    return postKIFormData(endpoint, formData, schema, true);
  }

  await håndterKIFeilRespons(res);

  const contentType = res.headers.get("Content-Type") || "";

  // SSE-svar fra analyze-document endepunktet (text/event-stream)
  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    const lines = text.split("\n");
    let lastData: string | null = null;

    for (const line of lines) {
      if (line.startsWith("data: ") && line !== "data: [DONE]") {
        lastData = line.slice(6);
      }
    }

    if (!lastData) {
      throw new Error("Ingen respons mottatt fra KI-tjenesten.");
    }
    return schema.parse(JSON.parse(lastData));
  }

  // Vanlig JSON-svar (feilresponser, andre endepunkter)
  const data = await res.json();
  return schema.parse(data);
}

// React query hooks

/** Test tilkobling til KI-tjenesten (GET /test-connection). Brukes for å vise feilmelding i chat hvis KI er utilgjengelig. */
export function useKITestTilkobling(enabled = true) {
  const query = useQuery({
    queryKey: ["ki", "test-connection"],
    queryFn: async () => {
      const res = await fetch("/api/ki/test-connection", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text();
        let message = "Kunne ikke koble til KI-assistenten.";
        try {
          const json = JSON.parse(text);
          message = json.melding || json.feil || message;
        } catch {
          // bruk default
        }
        throw new Error(message);
      }
      return res.json();
    },
    enabled,
    staleTime: 60 * 1000, // 1 minutt
    retry: false,
  });
  return {
    isError: query.isError,
    error: query.error,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
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
      spørsmål,
      model,
    }: {
      fil: File;
      spørsmål?: string;
      model?: string;
    }) => {
      const formData = new FormData();
      formData.append("document", fil);
      if (spørsmål) formData.append("question", spørsmål);
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
      spørsmål?: string,
      options?: {
        model?: string;
        onSuccess?: (data: DocumentAnalyseResponse) => void;
        onError?: (error: Error) => void;
      },
    ) => {
      mutation.mutate(
        { fil, spørsmål, model: options?.model },
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

