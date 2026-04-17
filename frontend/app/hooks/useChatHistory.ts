/**
 * useChatHistory – hook for å hente, lagre, laste og slette KI-chat-historikk.
 * Bruker React Query for liste fra API og oppdaterer cache optimistisk ved save/delete.
 */

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { showToast, toast } from "@/app/components/ui/Toaster";
import { useLanguage } from "@/app/i18n";
import { useUIStore } from "@/app/store/uiStore";
import {
  ChatHistoryResponseSchema,
  ChatMessage,
  ChatPinUpdateResponseSchema,
  ChatSavePayload,
  ChatSaveResponseSchema,
  ChatTitleUpdateResponseSchema,
  ChatTopicUpdateResponseSchema,
  CHAT_TITLE_MAX_LENGTH,
} from "common/chat";
import { fetchAuthedJson } from "../lib/apiClient";
import { SessionExpiredError } from "../lib/errors";

/** Representasjon av en lagret samtale (id, tittel, meldinger, tidsstempel). */
export interface SavedChat {
  id: string;
  title: string;
  topic?: string;
  pinned?: boolean;
  messages: ChatMessage[];
  timestamp: Date;
}

const MAX_CHATS = 50;
const CHAT_HISTORY_QUERY_KEY = ["chat-history"] as const;

type ApiError = Error & { status?: number; body?: unknown };

/** Valgfrie innstillinger for saveChat: stille modus (ingen toast) og antall retries ved 5xx. */
type SaveChatOptions = {
  silent?: boolean;
  retryCount?: number;
};

/** Tynt lag over fetchAuthedJson som beriker feil med status/body for retry-logikk. */
async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  try {
    const { data } = await fetchAuthedJson(input, init);
    return data as T;
  } catch (error) {
    // Berik feil med status/body slik at erIkkeAutentisert() og shouldRetrySave() fungerer
    if (error instanceof Error && !("status" in error)) {
      const apiErr = error as ApiError;
      if (error instanceof SessionExpiredError) {
        apiErr.status = 401;
      }
    }
    throw error;
  }
}

function erIkkeAutentisert(error: unknown) {
  if (error instanceof SessionExpiredError) return true;
  if (!(error instanceof Error)) return false;
  const status = (error as ApiError).status;
  if (status === 401) return true;
  return /ikke autentisert/i.test(error.message) || /jwt/i.test(error.message) || /token/i.test(error.message);
}

/** Avgjør om saveChat skal prøve på nytt (kun ved 5xx). */
function shouldRetrySave(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as ApiError).status;
  if (status === undefined) return true;
  return status >= 500;
}

function vent(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Henter chat-liste fra API og normaliserer timestamps. Returnerer [] ved auth-feil. */
async function loadChatHistory(): Promise<SavedChat[]> {
  try {
    const raw = await fetchJson<unknown>(`/api/ki/chat/history?limit=${MAX_CHATS}&page=1`);
    const result = ChatHistoryResponseSchema.safeParse(raw);
    if (!result.success) {
      throw new Error("Uventet format på chat-historikk fra server.");
    }
    return result.data.chats
      .slice(0, MAX_CHATS)
      .map((c) => ({ ...c, timestamp: new Date(c.timestamp) }));
  } catch (error) {
    if (erIkkeAutentisert(error)) return [];
    throw error;
  }
}

export function useChatHistory(enabled = true) {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const currentChatId = useUIStore((state) => state.currentChatId);
  const selectedChatId = useUIStore((state) => state.selectedChatId);
  const setCurrentChatId = useUIStore((state) => state.setCurrentChatId);
  const setSelectedChatId = useUIStore((state) => state.setSelectedChatId);
  const { data, isLoading } = useQuery({
    queryKey: CHAT_HISTORY_QUERY_KEY,
    queryFn: loadChatHistory,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    enabled,
  });

  // Stabiliser array-referansen — `data ?? []` gir ny tom array hver render
  // og trigger unødige re-renders i callbacks som har chats som dep.
  const chats = useMemo(() => data ?? [], [data]);

  /**
   * Lagrer en samtale (POST ny / PUT oppdatering).
   * Oppdaterer React Query-cache og returnerer chat-id. Ved ny chat kan title sendes (f.eks. første 50 tegn av første spørsmål).
   * Støtter retry ved 5xx og silent modus (uten toast).
   */
  const saveChat = useCallback(async (
    messages: ChatMessage[],
    chatId?: string,
    title?: string,
    options?: SaveChatOptions,
  ) => {
    if (messages.length === 0) return undefined;
    const payload: ChatSavePayload = { messages };
    if (title !== undefined) payload.title = title.slice(0, CHAT_TITLE_MAX_LENGTH).trim() || undefined;
    const body = JSON.stringify(payload);
    const endpoint = chatId ? `/api/ki/chat/history/${chatId}` : "/api/ki/chat/history";
    const method = chatId ? "PUT" : "POST";
    const retryCount = options?.retryCount ?? 0;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
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
        const shouldRetry = attempt < retryCount && shouldRetrySave(error);
        if (shouldRetry) {
          await vent(400 * (attempt + 1));
          continue;
        }
        if (!options?.silent) {
          showToast.error(t("chatHistory.saveError"), t("errors.generic.retry"));
        }
        return undefined;
      }
    }
    return undefined;
  }, [queryClient, t]);

  const setChatTopic = useCallback(async (id: string, topic: string) => {
    try {
      const normalizedTopic = topic.trim();
      const raw = await fetchJson<unknown>(`/api/ki/chat/history/${id}/topic`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: normalizedTopic.length > 0 ? normalizedTopic : null }),
      });
      const parsed = ChatTopicUpdateResponseSchema.parse(raw);
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) =>
        (prev ?? []).map((chat) =>
          chat.id === parsed.id ? { ...chat, topic: parsed.topic } : chat,
        ),
      );
      return true;
    } catch (error) {
      if (!erIkkeAutentisert(error)) {
        showToast.error(t("chatHistory.topicUpdateError"));
      }
      return false;
    }
  }, [queryClient, t]);

  const setChatPinned = useCallback(async (id: string, pinned: boolean) => {
    try {
      const raw = await fetchJson<unknown>(`/api/ki/chat/history/${id}/pin`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      const parsed = ChatPinUpdateResponseSchema.parse(raw);
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) =>
        (prev ?? []).map((chat) =>
          chat.id === parsed.id ? { ...chat, pinned: parsed.pinned } : chat,
        ),
      );
      return true;
    } catch (error) {
      if (!erIkkeAutentisert(error)) {
        showToast.error(t("chatHistory.pinUpdateError"));
      }
      return false;
    }
  }, [queryClient, t]);

  const setChatTitle = useCallback(async (id: string, title: string) => {
    try {
      const raw = await fetchJson<unknown>(`/api/ki/chat/history/${id}/title`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const parsed = ChatTitleUpdateResponseSchema.parse(raw);
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) =>
        (prev ?? []).map((chat) =>
          chat.id === parsed.id ? { ...chat, title: parsed.title } : chat,
        ),
      );
      return true;
    } catch (error) {
      if (!erIkkeAutentisert(error)) {
        showToast.error(t("chatHistory.titleUpdateError"));
      }
      return false;
    }
  }, [queryClient, t]);

  /** Returnerer én lagret samtale fra cache etter id, eller undefined. */
  const loadChat = useCallback((id: string) => chats.find((c) => c.id === id), [chats]);

  /** Sletter en samtale i backend og fjerner den fra cache. */
  const deleteChat = useCallback(async (id: string) => {
    try {
      await fetchJson<unknown>("/api/ki/chat/history/" + id, {
        method: "DELETE",
      });
      queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) =>
        (prev ?? []).filter((c) => c.id !== id)
      );
      if (currentChatId === id) {
        setCurrentChatId(null);
      }
      if (selectedChatId === id) {
        setSelectedChatId(null);
      }
      showToast.success(t("chatHistory.deleteSuccess"));
      return true;
    } catch (error) {
      if (erIkkeAutentisert(error)) return false;
      showToast.error(t("chatHistory.deleteError"));
      return false;
    }
  }, [
    currentChatId,
    queryClient,
    selectedChatId,
    setCurrentChatId,
    setSelectedChatId,
    t,
  ]);

  /** Viser bekreftelses-toast; ved "Slett" kalles DELETE mot API og cache tømmes. */
  const clearAll = useCallback(() => {
    toast(t("chatHistory.clearConfirmTitle"), {
      description: t("chatHistory.clearConfirmDescription"),
      position: "top-center",
      action: {
        label: t("common.actions.delete"),
        onClick: async () => {
          try {
            await fetchJson<unknown>("/api/ki/chat/history", {
              method: "DELETE",
            });
            queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, []);
            setCurrentChatId(null);
            setSelectedChatId(null);
            showToast.success(t("chatHistory.clearSuccess"));
          } catch (error) {
            if (erIkkeAutentisert(error)) return;
            showToast.error(t("chatHistory.clearError"));
          }
        },
      },
      cancel: { label: t("common.actions.cancel"), onClick: () => {} },
    });
  }, [queryClient, setCurrentChatId, setSelectedChatId, t]);

  return { chats, saveChat, setChatTopic, setChatPinned, setChatTitle, loadChat, deleteChat, clearAll, loading: isLoading };
}

/** Prefetch av chat-historikk (f.eks. i DashboardView) for raskere visning når bruker åpner chat. */
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
