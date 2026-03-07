/*
 * Skjemaer og typer for chat-funksjonalitet
 */

import { z } from "zod";
import { KI_MAX_MESSAGE_LENGTH_BACKEND } from "./ki.js";

// Maks antall chat-samtaler som skal vises i historikken
export const ChatMessageSchema = z.object({
  rolle: z.enum(["user", "assistant"]),
  innhold: z.string().min(1).max(KI_MAX_MESSAGE_LENGTH_BACKEND),
});

// Schema for lagring av chat-samtale
export const ChatSaveSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  messages: z.array(ChatMessageSchema).min(1).max(200),
});

// Schema for respons ved POST/PUT chat (én samtale)
export const ChatSaveResponseSchema = z.object({
  chat: z.object({
    id: z.string(),
    title: z.string(),
    messages: z.array(ChatMessageSchema),
    timestamp: z.coerce.date(),
  }),
});

// Schema for chat-historikk API-respons
export const ChatHistoryResponseSchema = z.object({
  chats: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      messages: z.array(ChatMessageSchema),
      timestamp: z.coerce.date(),
    }),
  ),
  meta: z
    .object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      pages: z.number(),
    })
    .optional(),
});
// Hjelpefunksjon for å mappe unike nøkler til farger
export const ChatHistoryListSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    messages: z.array(ChatMessageSchema),
    timestamp: z.coerce.date(),
  }),
);
// Type-definisjoner for chat-meldinger og historikk
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSavePayload = z.infer<typeof ChatSaveSchema>;
export type ChatSaveResponse = z.infer<typeof ChatSaveResponseSchema>;
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;
