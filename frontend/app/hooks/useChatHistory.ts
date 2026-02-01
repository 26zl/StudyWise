import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChatHistoryResponseSchema,
  ChatMessage,
  ChatSavePayload,
} from "common/chat";

export interface SavedChat {
  id: string;
  title: string;
  messages: ChatMessage[];
  timestamp: Date;
}

const MAX_CHATS = 50;
const CHAT_HISTORY_QUERY_KEY = ["chat-history"] as const;

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && (data.melding || data.feil)) || "Uventet feil");
  }
  return data as T;
}

export function useChatHistory() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: CHAT_HISTORY_QUERY_KEY,
    queryFn: async () => {
      const raw = await fetchJson<unknown>(
        "/api/ki/chat/history?limit=20&page=1"
      );
      const parsed = ChatHistoryResponseSchema.parse(raw);
      return parsed.chats
        .slice(0, MAX_CHATS)
        .map((c) => ({ ...c, timestamp: new Date(c.timestamp) }));
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
  };

  const loadChat = (id: string) => chats.find((c) => c.id === id);

  const deleteChat = async (id: string) => {
    await fetch("/api/ki/chat/history/" + id, { method: "DELETE", credentials: "include" });
    queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, (prev) =>
      (prev ?? []).filter((c) => c.id !== id)
    );
  };

  const clearAll = async () => {
    if (!confirm("Er du sikker pÃ¥ at du vil slette hele samtalehistorikken?")) return;
    await fetch("/api/ki/chat/history", { method: "DELETE", credentials: "include" });
    queryClient.setQueryData<SavedChat[]>(CHAT_HISTORY_QUERY_KEY, []);
  };

  return { chats, saveChat, loadChat, deleteChat, clearAll, loading: isLoading };
}
 