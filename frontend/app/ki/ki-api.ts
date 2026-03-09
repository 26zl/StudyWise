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
import { withCsrfProtection } from "../lib/csrf";

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
function truncateContentPreservingEnds(
  content: string,
  maxLength: number,
): string {
  if (content.length <= maxLength) return content;
  if (maxLength <= 8) return content.slice(-maxLength);

  const separator = "\n...\n";
  const remaining = maxLength - separator.length;
  if (remaining <= 0) return content.slice(0, maxLength);

  const headLength = Math.ceil(remaining / 2);
  const tailLength = Math.floor(remaining / 2);
  return `${content.slice(0, headLength)}${separator}${content.slice(-tailLength)}`;
}

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
  if (nonSystemMessages.length === 0) {
    if (!systemMessage) return [];
    return [
      {
        ...systemMessage,
        content: truncateContentPreservingEnds(
          systemMessage.content,
          maxLength,
        ),
      },
    ];
  }

  // Behold alltid siste brukermelding. Hvis det ikke finnes en brukermelding,
  // behold i det minste siste ikke-system-melding.
  const latestUserMessage =
    [...nonSystemMessages].reverse().find((m) => m.role === "user") ??
    nonSystemMessages[nonSystemMessages.length - 1];
  const latestMessage = {
    ...latestUserMessage,
    content: truncateContentPreservingEnds(
      latestUserMessage.content,
      maxLength,
    ),
  };

  // Start med system-melding og reserver plass til siste melding
  const result: Array<{ role: string; content: string }> = [];
  let currentLength = 0;
  const budgetBeforeLatest = Math.max(
    0,
    maxLength - latestMessage.content.length,
  );

  // Legg til system-melding først (hvis den finnes)
  if (systemMessage && budgetBeforeLatest > 0) {
    const systemContent = truncateContentPreservingEnds(
      systemMessage.content,
      budgetBeforeLatest,
    );
    result.push({ ...systemMessage, content: systemContent });
    currentLength += systemContent.length;
  }

  // Legg til meldinger fra nyeste til eldste
  const reversedMessages = [...nonSystemMessages].reverse();
  const messagesToAdd: Array<{ role: string; content: string }> = [];

  for (const msg of reversedMessages) {
    if (msg === latestUserMessage) continue;
    const msgLength = msg.content?.length || 0;
    if (currentLength + msgLength + latestMessage.content.length <= maxLength) {
      messagesToAdd.unshift(msg); // Legg til i starten for å bevare rekkefølge
      currentLength += msgLength;
    } else {
      // Ikke plass til flere hele meldinger
      break;
    }
  }

  // Kombiner system-melding, historikk og siste melding
  result.push(...messagesToAdd, latestMessage);

  return result;
}

// Spesialiserte feilklasser - importert fra felles error-modul
import {
  KIAuthError,
  KIConfigError,
  KIRateLimitError,
  KIServiceError,
  KITimeoutError,
} from "../lib/errors";

// Re-eksporter for konsumenter
export {
  KIAuthError,
  KIConfigError,
  KIRateLimitError,
  KIServiceError,
  KITimeoutError,
};

/** Intern kategori for KI-feil – én kilde for både Error-typen og brukervennlige tekster. */
type KIErrorCategory =
  | "auth"
  | "config"
  | "rate_limit"
  | "timeout"
  | "service"
  | "unknown";

const DISPLAY_MESSAGES: Record<
  KIErrorCategory,
  { chat: string; dokument: string; banner?: string }
> = {
  auth: {
    chat: "Du må logge inn på nytt for å bruke KI-assistenten.",
    dokument: "Du må logge inn på nytt for å bruke KI-assistenten.",
    banner: "Du må logge inn på nytt for å bruke KI-assistenten.",
  },
  config: {
    chat: "KI-tjenesten er ikke konfigurert riktig akkurat nå. Mangler ANTHROPIC_API_KEY på backend.",
    dokument: "KI-tjenesten er ikke konfigurert riktig akkurat nå. Mangler ANTHROPIC_API_KEY på backend.",
    banner: "KI-tjenesten er ikke konfigurert i dette miljøet ennå. Mangler ANTHROPIC_API_KEY på backend.",
  },
  rate_limit: {
    chat: "For mange forespørsler. Vent noen sekunder og prøv igjen.",
    dokument: "For mange forespørsler. Vent noen sekunder og prøv igjen.",
    banner: "KI-tjenesten er midlertidig rate-begrenset. Vent litt og prøv igjen.",
  },
  timeout: {
    chat: "Forespørselen tok for lang tid. Prøv å forenkle spørsmålet ditt.",
    dokument: "Analysen tok for lang tid. Prøv med et mindre dokument.",
  },
  service: {
    chat: "KI-tjenesten er midlertidig utilgjengelig. Prøv igjen om noen minutter.",
    dokument: "Dokumentanalyse er midlertidig utilgjengelig. Prøv igjen om noen minutter.",
    banner: "KI-tjenesten er overbelastet akkurat nå. Prøv igjen om litt.",
  },
  unknown: {
    chat: "Noe gikk galt. Prøv igjen.",
    dokument: "Kunne ikke analysere dokumentet. Prøv igjen.",
  },
};

/** Sjekker om meldingen er backend sin kreditt/quota-feil – brukes for å beholde eksakt tekst i stedet for generisk «service». */
function erKredittMelding(msg: string): boolean {
  if (!msg || typeof msg !== "string") return false;
  const lower = msg.toLowerCase();
  return (
    msg.includes("kreditt") ||
    msg.includes("oppbrukt") ||
    lower.includes("insufficient_quota")
  );
}

/** Sjekker om meldingen ser ut som rå teknisk feil – da skal vi ikke bruke den ukritisk i banner. */
function erTekniskFeilmelding(msg: string): boolean {
  if (!msg || typeof msg !== "string") return true;
  const lower = msg.toLowerCase();
  return (
    lower.includes("internal server error") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("typeerror") ||
    /\b500\b|\b502\b|\b503\b/.test(msg)
  );
}

function classifyKIError(message: string, status?: number): KIErrorCategory {
  const lower = message.trim().toLowerCase();
  if (
    status === 401 ||
    lower.includes("logge inn på nytt") ||
    lower.includes("ikke autentisert") ||
    lower.includes("ingen jwt")
  )
    return "auth";
  if (
    lower.includes("anthropic_api_key") ||
    lower.includes("ingen ai-leverandør tilgjengelig") ||
    lower.includes("ikke konfigurert")
  )
    return "config";
  if (
    status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("for mange forespørsler")
  )
    return "rate_limit";
  if (
    status === 504 ||
    lower.includes("timeout") ||
    lower.includes("tok for lang tid")
  )
    return "timeout";
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    lower.includes("overbelastet") ||
    lower.includes("utilgjengelig") ||
    lower.includes("server")
  )
    return "service";
  return "unknown";
}

function categoryFromErrorName(name: string): KIErrorCategory | undefined {
  if (name === "KIAuthError") return "auth";
  if (name === "KIConfigError") return "config";
  if (name === "KIRateLimitError") return "rate_limit";
  if (name === "KITimeoutError") return "timeout";
  if (name === "KIServiceError") return "service";
  return undefined;
}

function getDisplayMessageForCategory(
  category: KIErrorCategory,
  context: "chat" | "dokument"
): string {
  return DISPLAY_MESSAGES[category][context];
}

function lagKIError(melding: string, status?: number): Error {
  const normalisert = melding.trim();
  // Behold backend sin kredittmelding – ikke klassifiser 503 som generell «service» og overskriv
  if (erKredittMelding(normalisert)) {
    return new KIServiceError(normalisert);
  }
  const category = classifyKIError(normalisert, status);
  const message =
    category === "unknown"
      ? normalisert || "Uventet feil fra KI-tjenesten."
      : getDisplayMessageForCategory(category, "chat");

  switch (category) {
    case "auth":
      return new KIAuthError(message);
    case "config":
      return new KIConfigError(message);
    case "rate_limit":
      return new KIRateLimitError(message);
    case "timeout":
      return new KITimeoutError(message);
    case "service":
      return new KIServiceError(message);
    default:
      return new Error(message);
  }
}

/** Kontekst for brukervennlig feilmelding (chat vs dokumentanalyse). */
export type KIErrorContext = "chat" | "dokument";

/** Brukervennlig feilmelding for toast/banner – bruker samme klassifisering som lagKIError. */
export function getKIErrorMessage(
  error: Error,
  context: KIErrorContext = "chat"
): string {
  const msg = error.message;
  if (erKredittMelding(msg)) return msg;

  const category = categoryFromErrorName(error.name);
  if (category) return getDisplayMessageForCategory(category, context);
  if (msg.includes("for stor") || msg.includes("413"))
    return "Filen er for stor. Maksimal filstørrelse er 15 MB.";
  if (msg.includes("filtype") || msg.includes("støttes ikke"))
    return "Filtypen støttes ikke. Prøv PDF, Word, eller tekstfiler.";
  if (
    msg.includes("Internal Server Error") ||
    msg.includes("500") ||
    msg.includes("Server Error") ||
    msg.includes("serveren")
  )
    return "Noe gikk galt på serveren. Prøv igjen om litt, eller forenkle spørsmålet ditt.";
  return msg || getDisplayMessageForCategory("unknown", context);
}

/** Banner-innhold for tilkoblingsfeil – bruker samme DISPLAY_MESSAGES som getKIErrorMessage. */
export function getKIBannerForError(error: Error): {
  melding: string;
  type: "error" | "warning";
} | null {
  const msg = error.message;
  if (erKredittMelding(msg)) return { melding: msg, type: "warning" };

  let category = categoryFromErrorName(error.name);
  if (!category && msg.toLowerCase().includes("overbelastet")) {
    category = "service";
  }
  if (category === "auth" || category === "config" || category === "rate_limit") {
    const melding =
      DISPLAY_MESSAGES[category].banner ??
      getDisplayMessageForCategory(category, "chat");
    return { melding, type: "warning" };
  }
  if (category === "service") {
    // Bruk faktisk melding når den er brukervennlig (f.eks. fra backend), ikke «overbelastet» for alt
    const melding =
      msg && !erTekniskFeilmelding(msg)
        ? msg
        : (DISPLAY_MESSAGES.service.banner ??
          getDisplayMessageForCategory("service", "chat"));
    return { melding, type: "warning" };
  }
  return {
    melding: getKIErrorMessage(error, "chat"),
    type: "error",
  };
}

// Felles feilhåndtering for KI API-responser
async function håndterKIFeilRespons(res: Response): Promise<void> {
  if (res.status === 401) {
    throw lagKIError(
      await parseApiError(
        res,
        "Du må logge inn på nytt for å bruke KI-assistenten.",
      ),
      res.status,
    );
  }
  if (res.status === 413) {
    throw new Error(
      await parseApiError(
        res,
        "For mye data. Prøv med mindre innhold eller start en ny samtale.",
      ),
    );
  }
  if (res.status === 429) {
    throw lagKIError(
      await parseApiError(
        res,
        "For mange forespørsler. Vent litt og prøv igjen.",
      ),
      res.status,
    );
  }
  if (res.status === 503 || res.status === 502) {
    throw lagKIError(
      await parseApiError(
        res,
        "KI-tjenesten er midlertidig utilgjengelig. Prøv igjen om noen minutter.",
      ),
      res.status,
    );
  }
  if (res.status === 504) {
    throw lagKIError(
      await parseApiError(
        res,
        "Forespørselen tok for lang tid. Prøv å forenkle spørsmålet.",
      ),
      res.status,
    );
  }
  if (res.status >= 500) {
    throw lagKIError(
      await parseApiError(
        res,
        "Noe gikk galt på serveren. Prøv igjen om litt, eller forenkle spørsmålet ditt.",
      ),
      res.status,
    );
  }
  if (!res.ok) {
    throw lagKIError(await parseApiError(res));
  }
}

/** Parser KI-respons: SSE (siste data:-linje) eller vanlig JSON. */
async function parseKIResponse<T>(
  res: Response,
  schema: ZodType<T>,
): Promise<T> {
  const contentType = res.headers.get("Content-Type") || "";
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
  const data = await res.json();
  return schema.parse(data);
}

// Felles KI-klient: alle kall (inkl. POST/PUT/DELETE for chat, dokumentanalyse, etc.) får CSRF-header via withCsrfProtection.
async function requestKI<T>(
  endpoint: string,
  schema: ZodType<T>,
  init: RequestInit = {},
  forsoktRefresh = false,
): Promise<T> {
  const protectedInit = withCsrfProtection(init);
  let res: Response;
  try {
    res = await fetch(`/api/ki${endpoint}`, {
      credentials: "include",
      cache: "no-store",
      ...protectedInit,
    });
  } catch {
    throw new KIServiceError(
      "Kunne ikke koble til KI-tjenesten. Sjekk internettforbindelsen din.",
    );
  }

  if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
    try {
      await fornySesjon();
    } catch {
      throw new KIAuthError("Du må logge inn på nytt for å bruke KI-assistenten.");
    }
    return requestKI(endpoint, schema, init, true);
  }

  await håndterKIFeilRespons(res);
  return parseKIResponse(res, schema);
}

// API funksjoner
// POST funksjon for chat (støtter SSE-streaming fra backend)
async function postKI<T>(
  endpoint: string,
  body: unknown,
  schema: ZodType<T>,
  method: "POST" | "PUT" | "DELETE" = "POST",
): Promise<T> {
  return requestKI(endpoint, schema, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// POST funksjon for FormData (brukes av dokumentanalyse)
async function postKIFormData<T>(
  endpoint: string,
  formData: FormData,
  schema: ZodType<T>,
): Promise<T> {
  return requestKI(endpoint, schema, {
    method: "POST",
    body: formData,
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Uventet feil");
}

function assertSuccessfulKIChat(
  data: z.infer<typeof KIChatResponseSchema>,
): z.infer<typeof KIChatResponseSchema> {
  if (!data.suksess) {
    throw lagKIError(
      data.melding || "Kunne ikke få svar fra KI-assistenten. Prøv igjen senere.",
    );
  }

  if (!data.response.trim()) {
    throw new KIServiceError(
      "KI-assistenten returnerte et tomt svar. Prøv igjen.",
    );
  }

  return data;
}

function assertSuccessfulKITestConnection(
  data: z.infer<typeof KIChatResponseSchema>,
): z.infer<typeof KIChatResponseSchema> {
  if (!data.suksess) {
    throw lagKIError(
      data.melding || "Kunne ikke koble til KI-assistenten. Prøv igjen senere.",
    );
  }

  return data;
}

// React query hooks

/** Test tilkobling til KI-tjenesten (GET /test-connection). Brukes for å vise feilmelding i chat hvis KI er utilgjengelig. */
export function useKITestTilkobling(enabled = true) {
  const query = useQuery({
    queryKey: ["ki", "test-connection"],
    queryFn: async () =>
      assertSuccessfulKITestConnection(
        await requestKI("/test-connection", KIChatResponseSchema, {
          method: "GET",
        }),
      ),
    enabled,
    staleTime: 60 * 1000, // 1 minutt
    retry: false,
    // Etter at konto var nede (f.eks. tom for kreditt) og er fylt opp: oppdater tilkoblingsstatus uten at bruker må refreshe
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.status === "error" ? 60_000 : 0), // Ved feil: prøv på nytt hvert 60. sekund
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
    mutationFn: async (request: KIChatRequest) =>
      assertSuccessfulKIChat(
        await postKI("/chat", request, KIChatResponseSchema),
      ),
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
        messages: trimmedMessages
          .filter(
            (m): m is { role: "user" | "assistant"; content: string } =>
              m.role === "user" || m.role === "assistant",
          )
          .map((m) => ({
            role: m.role,
            content: m.content,
          })),
        model: options?.model,
        temperature: options?.temperature,
      };

      void mutation
        .mutateAsync(request)
        .then((data) => {
          options?.onSuccess?.(data);
        })
        .catch((error: unknown) => {
          options?.onError?.(asError(error));
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

function assertSuccessfulDocumentAnalyse(
  data: DocumentAnalyseResponse,
): DocumentAnalyseResponse {
  if (!data.suksess) {
    throw lagKIError(
      data.melding || "Kunne ikke analysere dokumentet. Prøv igjen.",
    );
  }
  if (!data.response.trim()) {
    throw new KIServiceError(
      "Dokumentanalysen returnerte et tomt svar. Prøv igjen.",
    );
  }
  return data;
}

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
      return assertSuccessfulDocumentAnalyse(
        await postKIFormData(
          "/analyze-document",
          formData,
          KIDocumentAnalyseResponseSchema,
        ),
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
      void mutation
        .mutateAsync({ fil, spørsmål, model: options?.model })
        .then((data) => {
          options?.onSuccess?.(data);
        })
        .catch((error: unknown) => {
          options?.onError?.(asError(error));
        });
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
