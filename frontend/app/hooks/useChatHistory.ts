import { useState, useEffect } from "react";

export interface SavedChat {
  id: string;
  title: string;
  messages: Array<{
    rolle: "user" | "assistant";
    innhold: string;
  }>;
  timestamp: Date;
}

const STORAGE_KEY = "studywise-chat-history";
const MAX_CHATS = 20;

export function useChatHistory() {
  const [chats, setChats] = useState<SavedChat[]>([]);

  // Last fra localStorage ved mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Konverter timestamp strings tilbake til Date
        const withDates = parsed.map((chat: any) => ({
          ...chat,
          timestamp: new Date(chat.timestamp),
        }));
        setChats(withDates);
      }
    } catch (error) {
      console.error("Kunne ikke laste chat history:", error);
    }
  }, []);

  // Lagre til localStorage når chats endres
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
    } catch (error) {
      console.error("Kunne ikke lagre chat history:", error);
    }
  }, [chats]);

  const saveChat = (messages: Array<{ rolle: "user" | "assistant"; innhold: string }>) => {
    if (messages.length === 0) return;

    // Generer title fra første brukermelding
    const firstUserMessage = messages.find((m) => m.rolle === "user");
    const title = firstUserMessage
      ? firstUserMessage.innhold.slice(0, 50) + (firstUserMessage.innhold.length > 50 ? "..." : "")
      : "Ny samtale";

    const newChat: SavedChat = {
      id: Date.now().toString(),
      title,
      messages,
      timestamp: new Date(),
    };

    setChats((prev) => [newChat, ...prev].slice(0, MAX_CHATS));
  };

  const loadChat = (id: string) => {
    return chats.find((c) => c.id === id);
  };

  const deleteChat = (id: string) => {
    setChats((prev) => prev.filter((c) => c.id !== id));
  };

  const clearAll = () => {
    if (confirm("Er du sikker på at du vil slette hele samtalehistorikken?")) {
      setChats([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return { chats, saveChat, loadChat, deleteChat, clearAll };
} 