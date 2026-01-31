import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface SavedChatDB {
  _id: string;
  title: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
  messageCount?: number;
}

// Fetch all conversations
async function fetchConversations(): Promise<SavedChatDB[]> {
  const res = await fetch("/api/ki/conversations", {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch conversations");
  const data = await res.json();
  return data.conversations;
}

// Save new conversation
async function saveConversation(messages: Array<{ role: string; content: string }>) {
  const res = await fetch("/api/ki/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error("Failed to save conversation");
  return res.json();
}

// Delete conversation
async function deleteConversation(id: string) {
  const res = await fetch(`/api/ki/conversations/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete conversation");
  return res.json();
}

export function useChatHistoryDB() {
  const queryClient = useQueryClient();

  // Fetch conversations
  const { data: chats = [], isLoading } = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: fetchConversations,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: saveConversation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
  });

  const saveChat = (messages: Array<{ rolle: "user" | "assistant"; innhold: string }>) => {
    // Convert from Norwegian format to API format
    const apiMessages = messages.map((m) => ({
      role: m.rolle,
      content: m.innhold,
    }));
    saveMutation.mutate(apiMessages);
  };

  const loadChat = (id: string) => {
    return chats.find((c) => c._id === id);
  };

  const deleteChat = (id: string) => {
    deleteMutation.mutate(id);
  };

  const clearAll = async () => {
    if (confirm("Er du sikker på at du vil slette hele samtalehistorikken?")) {
      // Delete all conversations one by one
      for (const chat of chats) {
        await deleteMutation.mutateAsync(chat._id);
      }
    }
  };

  return { chats, saveChat, loadChat, deleteChat, clearAll, isLoading };
} 