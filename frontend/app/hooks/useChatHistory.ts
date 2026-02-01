import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChatHistoryResponseSchema,
  ChatMessage,
  ChatSavePayload,
} from "common/chat";
import { fornySesjon } from "../auth/auth-api";

export interface SavedChat {
  id: string;
  title: string;
  messages: ChatMessage[];
  timestamp: Date;
}

const MAX_CHATS = 50;
const CHAT_HISTORY_QUERY_KEY = ["chat-history"] as const;

type ApiError = Error & { status?: number; body?: unknown };

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

function erIkkeAutentisert(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as ApiError).status;
  if (status === 401 || status === 403) return true;
  return /ikke autentisert/i.test(error.message) || /jwt/i.test(error.message) || /token/i.test(error.message);
}

export function useChatHistory() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: CHAT_HISTORY_QUERY_KEY,
    queryFn: async () => {
      try {
        const raw = await fetchJson<unknown>(
          "/api/ki/chat/history?limit=20&page=1"
        );
        const parsed = ChatHistoryResponseSchema.parse(raw);
        return parsed.chats
          .slice(0, MAX_CHATS)
          .map((c) => ({ ...c, timestamp: new Date(c.timestamp) }));
      } catch (error) {
        if (erIkkeAutentisert(error)) return [];
        throw error;
      }
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const chats = data ?? [];

  const saveChat = async (messages: ChatMessage[], chatId?: string) => {
    if (messages.length === 0) return undefined;
    const body = JSON.stringify({ messages } satisfies ChatSavePayload);
    const endpoint = chatId ? `/api/ki/chat/history/${chatId}` : "/api/ki/chat/history";
    const method = chatId ? "PUT" : "POST";
    try {
      const data = await fetchJson<{ chat: SavedChat }>(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body,
      });
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) => {
        const existing = prev ?? [];
        const updated = [
          { ...data.chat, timestamp: new Date(data.chat.timestamp) },
          ...existing.filter((c) => c.id !== data.chat.id),
        ];
        return updated.slice(0, MAX_CHATS);
      });
      return data.chat.id;
    } catch (error) {
      if (erIkkeAutentisert(error)) return undefined;
      // Ikke la lagring feile hele UI-et; logg i dev og svelg
      if (process.env.NODE_ENV !== "production") {
        console.warn("Klarte ikke lagre chat:", error);
      }
      return undefined;
    }
  };

  const loadChat = (id: string) => chats.find((c) => c.id === id);

  const deleteChat = async (id: string) => {
    try {
      await fetch("/api/ki/chat/history/" + id, { method: "DELETE", credentials: "include" });
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) =>
        (prev ?? []).filter((c) => c.id !== id)
      );
    } catch (error) {
      if (erIkkeAutentisert(error)) return;
      throw error;
    }
  };

  const clearAll = async () => {
    if (!confirm("Er du sikker på at du vil slette hele samtalehistorikken?")) return;
    try {
      await fetch("/api/ki/chat/history", { method: "DELETE", credentials: "include" });
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, []);
    } catch (error) {
      if (erIkkeAutentisert(error)) return;
      throw error;
    }
  };

  return { chats, saveChat, loadChat, deleteChat, clearAll, loading: isLoading };
}
 
