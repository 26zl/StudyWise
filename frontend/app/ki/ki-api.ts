/*
 * KI API klient for frontend
 * Håndterer kommunikasjon med backend API for AI funksjonalitet
 * Henter zod schemas fra common for validering av data
 */

import type { ZodType } from "zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KIChatResponseSchema,
  KIDocumentAnalyseResponseSchema,
  KIOppsummeringResponseSchema,
  KI_MAX_MESSAGE_LENGTH_FRONTEND,
  TaskBreakdownGenerateRequestSchema,
  TaskBreakdownResponseSchema,
  WeeklyPlanGenerateRequestSchema,
  WeeklyPlanSuggestionResponseSchema,
  type KIChatRequest,
  type KIDocumentAnalyseResponse,
  type KIOppsummeringResponse,
  type SubTask,
  type TaskBreakdownGenerateRequest,
  type WeeklyPlanGenerateRequest,
} from "common/ki";
import { parseApiError, identifiserFeiltype, type FeilType } from "../lib/errorUtils";
import { fetchApi } from "../lib/apiClient";
import { ForbiddenError } from "../lib/errors";

// Eksporter typer
export type { KIChatResponse, KIMessage } from "common/ki";

// Støttede filtyper for dokumentopplasting (inkluderer bilder for OCR)
export const SUPPORTED_FILE_TYPES = [
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".xlsx",
  ".txt",
  ".md",
  ".csv",
  // Kodefiler
  ".java", ".js", ".ts", ".jsx", ".tsx",
  ".py", ".html", ".css", ".scss", ".sql",
  ".cpp", ".c", ".h", ".cs", ".go", ".rs",
  ".php", ".rb", ".swift", ".kt",
  ".xml", ".json", ".yaml", ".yml",
  ".sh", ".bash", ".ps1", ".r", ".m", ".dart",
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

/** Mapper generell FeilType til KI-spesifikk kategori. */
function feilTypeToKICategory(type: FeilType): KIErrorCategory {
  switch (type) {
    case "auth":
    case "token":
      return "auth";
    case "rate_limit":
      return "rate_limit";
    case "timeout":
      return "timeout";
    case "server":
    case "network":
      return "service";
    default:
      return "unknown";
  }
}

/** Klassifiserer KI-feil: sjekker KI-spesifikke error.name og config-meldinger, deretter delegerer til delt identifiserFeiltype. */
function classifyKIError(
  message: string,
  status?: number,
  errorName?: string,
): KIErrorCategory {
  // KI-spesifikk: sjekk error.name for spesialiserte feilklasser
  if (errorName === "KIConfigError") return "config";

  // KI-spesifikk: sjekk for konfigurasjonsfeil i meldingsinnhold
  const lower = message.trim().toLowerCase();
  if (
    lower.includes("anthropic_api_key") ||
    lower.includes("ingen ai-leverandør tilgjengelig") ||
    lower.includes("ikke konfigurert")
  )
    return "config";

  // Bruk delt feilklassifiserer for alt annet
  const feilType = identifiserFeiltype(
    errorName ? Object.assign(new Error(message), { name: errorName }) : message,
    status,
  );
  return feilTypeToKICategory(feilType);
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
  const category = classifyKIError(normalisert, status, undefined);
  if (
    (category === "service" || category === "config") &&
    normalisert &&
    !erTekniskFeilmelding(normalisert)
  ) {
    return category === "config"
      ? new KIConfigError(normalisert)
      : new KIServiceError(normalisert);
  }
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

  const category = classifyKIError(msg, undefined, error.name);
  if (
    (category === "service" || category === "config") &&
    msg &&
    !erTekniskFeilmelding(msg)
  ) {
    return msg;
  }
  if (category !== "unknown") return getDisplayMessageForCategory(category, context);
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

  const category = classifyKIError(msg, undefined, error.name);
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

function tryDecodeSSEPayload(dataLine: string): string | null {
  if (typeof globalThis.atob !== "function") {
    return null;
  }

  try {
    const binary = globalThis.atob(dataLine);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function parseSSEPayload<T>(dataLine: string, schema: ZodType<T>): T {
  const decoded = tryDecodeSSEPayload(dataLine);
  const json = decoded ?? dataLine;
  return schema.parse(JSON.parse(json));
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
    return parseSSEPayload(lastData, schema);
  }
  const data = await res.json();
  return schema.parse(data);
}

// Felles KI-klient: alle kall går via fetchApi slik at auth-header og CSRF holdes konsistent.
async function requestKI<T>(
  endpoint: string,
  schema: ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetchApi(`/api/ki${endpoint}`, init);
  } catch {
    throw new KIServiceError(
      "Kunne ikke koble til KI-tjenesten. Sjekk internettforbindelsen din.",
    );
  }

  if (res.status === 401 || res.status === 403) {
    if (res.status === 401) {
      throw new KIAuthError("Du må logge inn på nytt for å bruke KI-assistenten.");
    }
    throw new ForbiddenError(
      await parseApiError(res, "Du har ikke tilgang til KI-assistenten."),
    );
  }

  await håndterKIFeilRespons(res);
  return parseKIResponse(res, schema);
}

// Timeout for langvarige KI-kall (ukeplangenerator kan ta 1–2 min)
const KI_LONG_REQUEST_TIMEOUT_MS = 120_000;

// API funksjoner
// POST funksjon for chat (støtter SSE-streaming fra backend)
async function postKI<T>(
  endpoint: string,
  body: unknown,
  schema: ZodType<T>,
  method: "POST" | "PUT" | "DELETE" = "POST",
  extraInit?: RequestInit,
): Promise<T> {
  return requestKI(endpoint, schema, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...extraInit,
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

async function deleteKI<T>(endpoint: string, schema: ZodType<T>): Promise<T> {
  return requestKI(endpoint, schema, {
    method: "DELETE",
  });
}

// Enkel POST-hjelper for ikke-KI endepunkter (quiz/flashcards) slik at vi treffer riktig backend-rute.
async function postGeneriskApi<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchApi(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 401 || res.status === 403) {
    throw new ForbiddenError(
      await parseApiError(res, "Du har ikke tilgang til denne handlingen."),
    );
  }

  if (res.status === 429) {
    throw new Error(
      await parseApiError(
        res,
        "For mange forespørsler. Vent litt og prøv igjen.",
      ),
    );
  }

  if (!res.ok) {
    throw new Error(
      await parseApiError(
        res,
        "Noe gikk galt med genereringen. Prøv igjen om et øyeblikk.",
      ),
    );
  }

  const data = await res.json();
  return schema.parse(data);
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

/**
 * Streaming KI-chat som leser SSE-strøm fra backend incrementalt med getReader().
 * Returnerer fullstendig validert KIChatResponseSchema-respons.
 */
export async function streamKIChat(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options: {
    model?: string;
    temperature?: number;
    signal?: AbortSignal;
    explanationLevel?: string;
  } = {},
): Promise<z.infer<typeof KIChatResponseSchema>> {
  const trimmedMessages = trimMessages(messages).filter(
    (m): m is { role: "user" | "assistant"; content: string } =>
      m.role === "user" || m.role === "assistant",
  );

  const request: KIChatRequest = {
    messages: trimmedMessages,
    model: options.model,
    temperature: options.temperature,
    ...(options.explanationLevel && { explanationLevel: options.explanationLevel as KIChatRequest["explanationLevel"] }),
  };

  const requestInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  };

  let res: Response;
  try {
    res = await fetchApi("/api/ki/chat", requestInit);
  } catch {
    throw new KIServiceError(
      "Kunne ikke koble til KI-tjenesten. Sjekk internettforbindelsen din.",
    );
  }

  if (res.status === 401) {
    throw new KIAuthError(
      "Du må logge inn på nytt for å bruke KI-assistenten.",
    );
  }
  if (res.status === 403) {
    throw new ForbiddenError(
      await parseApiError(res, "Du har ikke tilgang til KI-assistenten."),
    );
  }

  await håndterKIFeilRespons(res);

  const contentType = res.headers.get("Content-Type") || "";
  if (!contentType.includes("text/event-stream")) {
    return assertSuccessfulKIChat(await parseKIResponse(res, KIChatResponseSchema));
  }

  if (!res.body) {
    throw new KIServiceError("Ingen svarstrøm fra serveren.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastDataLine: string | null = null;

  // Abort-signalet fra fetch() propagerer ikke til body-strømmen etter at
  // headere er mottatt (SSE sender headere umiddelbart). Lytt eksplisitt
  // på abort og kanseller leseren manuelt for å sikre at avbryt-knappen fungerer.
  const onAbort = () => { reader.cancel().catch(() => {}); };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    // Les HTTP body incrementalt chunk for chunk
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Prosesser alle komplette SSE-linjer i nåværende buffer
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          lastDataLine = line.slice(6);
        }
      }
    }
  } catch (err) {
    // Kanseller strømmen ved feil slik at nettleseren frigir TCP-forbindelsen
    await res.body.cancel().catch(() => {});
    throw err;
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  // Bruker avbrøt — kast tidlig uten misvisende feilmelding
  if (options.signal?.aborted) {
    throw new DOMException("Forespørselen ble avbrutt", "AbortError");
  }

  // Tøm eventuelle gjenværende bytes fra TextDecoder
  buffer += decoder.decode();
  if (buffer.startsWith("data: ") && buffer !== "data: [DONE]") {
    lastDataLine = buffer.slice(6);
  }

  if (!lastDataLine) {
    throw new KIServiceError("Ingen respons mottatt fra KI-tjenesten.");
  }

  return assertSuccessfulKIChat(parseSSEPayload(lastDataLine, KIChatResponseSchema));
}

// React query hooks

const TASK_BREAKDOWN_QUERY_KEY = ["ki", "task-breakdown"] as const;

export function useTaskBreakdown(assignmentId?: string) {
  return useQuery({
    queryKey: [...TASK_BREAKDOWN_QUERY_KEY, assignmentId],
    queryFn: async () => {
      if (!assignmentId) {
        return TaskBreakdownResponseSchema.parse({ subtasks: [] });
      }
      return requestKI(
        `/task-breakdown/${encodeURIComponent(assignmentId)}`,
        TaskBreakdownResponseSchema,
        { method: "GET" },
      );
    },
    enabled: Boolean(assignmentId),
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });
}

/** Rå API-funksjon for oppgavedeling — kan brukes utenfor React-komponent livssyklus. */
export async function generateTaskBreakdownApi(
  assignmentId: string,
  request: TaskBreakdownGenerateRequest,
) {
  const parsedRequest = TaskBreakdownGenerateRequestSchema.parse(request);
  return postKI(
    `/task-breakdown/${encodeURIComponent(assignmentId)}/generate`,
    parsedRequest,
    TaskBreakdownResponseSchema,
  );
}

/** Rå API-funksjon for lagring av oppgavedeling — kan brukes utenfor React-komponent livssyklus. */
export async function saveTaskBreakdownApi(
  assignmentId: string,
  subtasks: SubTask[],
) {
  return postKI(
    `/task-breakdown/${encodeURIComponent(assignmentId)}`,
    { subtasks },
    TaskBreakdownResponseSchema,
  );
}

/** Rå API-funksjon for ukeplangenerering — kan brukes utenfor React-komponent livssyklus. */
export async function generateWeeklyPlanApi(request: WeeklyPlanGenerateRequest) {
  const parsedRequest = WeeklyPlanGenerateRequestSchema.parse(request);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KI_LONG_REQUEST_TIMEOUT_MS);
  try {
    return await postKI(
      "/weekly-plan/generate",
      parsedRequest,
      WeeklyPlanSuggestionResponseSchema,
      "POST",
      { signal: controller.signal },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function useSaveTaskBreakdown() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      assignmentId,
      subtasks,
    }: {
      assignmentId: string;
      subtasks: SubTask[];
    }) =>
      postKI(
        `/task-breakdown/${encodeURIComponent(assignmentId)}`,
        { subtasks },
        TaskBreakdownResponseSchema,
      ),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        [...TASK_BREAKDOWN_QUERY_KEY, variables.assignmentId],
        data,
      );
    },
  });
}

export function useDeleteTaskBreakdown() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ assignmentId }: { assignmentId: string }) =>
      deleteKI(
        `/task-breakdown/${encodeURIComponent(assignmentId)}`,
        TaskBreakdownResponseSchema,
      ),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        [...TASK_BREAKDOWN_QUERY_KEY, variables.assignmentId],
        data,
      );
    },
  });
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

/** Rå API-funksjon for oppsummering — kan brukes utenfor React-komponent livssyklus. */
export async function generateOppsummeringApi(
  tekst: string,
  type: "tldr" | "handlinger" | "begge" = "begge",
) {
  return postKI("/oppsummering", { tekst, type }, KIOppsummeringResponseSchema);
}

// --- Quiz/Flashcards API ---
import {
  QuizGenerateRequestSchema,
  QuizGenerateResponseSchema,
  FlashcardsGenerateRequestSchema,
  FlashcardsGenerateResponseSchema,
  type QuizGenerateRequest,
  type QuizGenerateResponse,
  type FlashcardsGenerateRequest,
  type FlashcardsGenerateResponse,
} from "common/ki";

export type { QuizGenerateRequest, QuizGenerateResponse, FlashcardsGenerateRequest, FlashcardsGenerateResponse };

/** Rå API-funksjon for quiz-generering. */
export async function generateQuizApi(request: QuizGenerateRequest, signal?: AbortSignal): Promise<QuizGenerateResponse> {
  const validated = QuizGenerateRequestSchema.parse(request);
  return postGeneriskApi("/api/quiz/generate", validated, QuizGenerateResponseSchema, signal);
}

/** Rå API-funksjon for flashcard-generering. */
export async function generateFlashcardsApi(request: FlashcardsGenerateRequest, signal?: AbortSignal): Promise<FlashcardsGenerateResponse> {
  const validated = FlashcardsGenerateRequestSchema.parse(request);
  return postGeneriskApi("/api/flashcards/generate", validated, FlashcardsGenerateResponseSchema, signal);
}
