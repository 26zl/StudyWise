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

// Schema for lagring av chat-samtale. title valgfri; brukes for visning (f.eks. avkortet første spørsmål).
export const ChatSaveSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(200),
  title: z.string().max(120).optional().nullable(),
});

// Felles schema for en enkelt chat-samtale (delt mellom save og historikk)
const ChatEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(ChatMessageSchema),
  timestamp: z.coerce.date(),
});

// Schema for respons ved POST/PUT chat (én samtale)
export const ChatSaveResponseSchema = z.object({
  chat: ChatEntrySchema,
});

// Schema for chat-historikk API-respons
export const ChatHistoryResponseSchema = z.object({
  chats: z.array(ChatEntrySchema),
  meta: z
    .object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      pages: z.number(),
    })
    .optional(),
});
// Type-definisjoner for chat-meldinger og historikk
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSavePayload = z.infer<typeof ChatSaveSchema>;
export type ChatSaveResponse = z.infer<typeof ChatSaveResponseSchema>;
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;
