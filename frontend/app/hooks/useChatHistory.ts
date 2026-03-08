import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import {
  ChatHistoryResponseSchema,
  ChatMessage,
  ChatSavePayload,
  ChatSaveResponseSchema,
} from "common/chat";
import { fornySesjon } from "../auth/auth-api";
// Representasjon av en lagret samtale
export interface SavedChat {
  id: string;
  title: string;
  messages: ChatMessage[];
  timestamp: Date;
}
// Maksimalt antall lagrede samtaler i klienten
const MAX_CHATS = 50;
const CHAT_HISTORY_QUERY_KEY = ["chat-history"] as const;
// Utvidet feiltyper for API-kall
type ApiError = Error & { status?: number; body?: unknown };
// Hjelpefunksjon for å gjøre fetch med JSON-respons og håndtere autentisering
async function fetchJson<T>(
  input: RequestInfo,
  init?: RequestInit,
  forsoktRefresh = false
): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  // 204 No Content – ingen body, unngå JSON-parse
  if (res.status === 204) {
    return undefined as T;
  }
  const data = await res.json().catch(() => ({}));
  if ((res.status === 401 || res.status === 403) && !forsoktRefresh) {
    try {
      await fornySesjon();
    } catch {
      const err = new Error("Ikke autentisert") as ApiError;
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return fetchJson(input, init, true);
  }
  if (!res.ok) {
    const err = new Error((data && (data.melding || data.feil)) || "Uventet feil") as ApiError;
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data as T;
}
// Sjekk om error indikerer manglende autentisering
function erIkkeAutentisert(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as ApiError).status;
  if (status === 401 || status === 403) return true;
  return /ikke autentisert/i.test(error.message) || /jwt/i.test(error.message) || /token/i.test(error.message);
}

async function loadChatHistory(): Promise<SavedChat[]> {
  try {
    const raw = await fetchJson<unknown>("/api/ki/chat/history?limit=20&page=1");
    const parsed = ChatHistoryResponseSchema.parse(raw);
    return parsed.chats
      .slice(0, MAX_CHATS)
      .map((c) => ({ ...c, timestamp: new Date(c.timestamp) }));
  } catch (error) {
    if (erIkkeAutentisert(error)) return [];
    throw error;
  }
}

// Hook for å håndtere chat-historikk
export function useChatHistory() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: CHAT_HISTORY_QUERY_KEY,
    queryFn: loadChatHistory,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
  // Tilgjengelige samtaler
  const chats = data ?? [];
  // Lagre en samtale (ny eller oppdatert)
  const saveChat = async (messages: ChatMessage[], chatId?: string) => {
    if (messages.length === 0) return undefined;
    const body = JSON.stringify({ messages } satisfies ChatSavePayload);
    const endpoint = chatId ? `/api/ki/chat/history/${chatId}` : "/api/ki/chat/history";
    const method = chatId ? "PUT" : "POST";
    try {
      const raw = await fetchJson<unknown>(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = ChatSaveResponseSchema.parse(raw);
      const chat = {
        ...data.chat,
        timestamp: data.chat.timestamp instanceof Date ? data.chat.timestamp : new Date(data.chat.timestamp),
      };
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) => {
        const existing = prev ?? [];
        const updated = [chat, ...existing.filter((c) => c.id !== chat.id)];
        return updated.slice(0, MAX_CHATS);
      });
      return chat.id;
    } catch (error) {
      if (erIkkeAutentisert(error)) return undefined;
      toast.error("Kunne ikke lagre samtalen", {
        description: "Prøv igjen senere.",
      });
      return undefined;
    }
  };
  // Last inn en samtale etter ID
  const loadChat = useCallback((id: string) => chats.find((c) => c.id === id), [chats]);
  // Slett en samtale
  const deleteChat = async (id: string) => {
    try {
      await fetchJson<unknown>("/api/ki/chat/history/" + id, {
        method: "DELETE",
      });
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) =>
        (prev ?? []).filter((c) => c.id !== id)
      );
      toast.success("Samtale slettet");
    } catch (error) {
      if (erIkkeAutentisert(error)) return;
      toast.error("Kunne ikke slette samtalen");
      throw error;
    }
  };
// Slett alle samtaler – viser bekreftelses-toast i midten for brukervennlighet
  const clearAll = useCallback(() => {
    toast("Slett hele samtalehistorikken?", {
      description: "Alle lagrede samtaler fjernes. Dette kan ikke angres.",
      position: "top-center",
      action: {
        label: "Slett",
        onClick: async () => {
          try {
            await fetchJson<unknown>("/api/ki/chat/history", {
              method: "DELETE",
            });
            queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, []);
            toast.success("Samtalehistorikk slettet");
          } catch (error) {
            if (erIkkeAutentisert(error)) return;
            toast.error("Kunne ikke slette historikken");
            throw error;
          }
        },
      },
      cancel: { label: "Avbryt", onClick: () => {} },
    });
  }, [queryClient]);

  return { chats, saveChat, loadChat, deleteChat, clearAll, loading: isLoading };
}

/** Stabil prefetch-funksjon for chat-historikk (bruk i DashboardView) */
export function useChatHistoryPrefetch() {
  const prefetchChatHistory = useCallback((queryClient: QueryClient) => {
    queryClient.prefetchQuery({
      queryKey: CHAT_HISTORY_QUERY_KEY,
      queryFn: loadChatHistory,
      staleTime: 1000 * 60 * 5,
    });
  }, []);

  return { prefetchChatHistory };
}
