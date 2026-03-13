/*
 * Skjemaer og typer for chat-funksjonalitet
 */

import { z } from "zod";
import { KI_MAX_MESSAGE_LENGTH_BACKEND } from "./ki.js";

// Maks antall chat-samtaler som skal vises i historikken
export const ChatMessageSchema = z.object({
  rolle: z.enum(["user", "assistant"]),
  innhold: z
    .string()
    .min(1, "Meldingen kan ikke være tom")
    .max(KI_MAX_MESSAGE_LENGTH_BACKEND, `Meldingen kan være maks ${KI_MAX_MESSAGE_LENGTH_BACKEND} tegn`),
});

// Schema for lagring av chat-samtale. title valgfri; brukes for visning (f.eks. avkortet første spørsmål).
export const ChatSaveSchema = z.object({
  messages: z
    .array(ChatMessageSchema)
    .min(1, "Samtalen må inneholde minst én melding")
    .max(200, "Maks 200 meldinger per samtale"),
  title: z.string().max(120, "Tittel må være maks 120 tegn").optional().nullable(),
});

export const ChatShareCreateSchema = z.object({
  shareMode: z.enum(["full_chat"]).default("full_chat"),
});

const ChatShareTypeSchema = z.enum(["full_chat"]);

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

// Schema for delt chat-respons (offentlig, kun lesbar)
export const SharedChatResponseSchema = z.object({
  title: z.string(),
  messages: z.array(ChatMessageSchema).min(1),
  sharedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  shareType: ChatShareTypeSchema.default("full_chat"),
});

// Schema for share-respons (returneres ved deling)
export const ChatShareResponseSchema = z.object({
  shareToken: z.string(),
  shareUrl: z.string(),
  expiresAt: z.coerce.date(),
  shareType: ChatShareTypeSchema.default("full_chat"),
});
// Type-definisjoner for chat-meldinger og historikk
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSavePayload = z.infer<typeof ChatSaveSchema>;
export type ChatShareCreatePayload = z.infer<typeof ChatShareCreateSchema>;
export type ChatSaveResponse = z.infer<typeof ChatSaveResponseSchema>;
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;
export type SharedChatResponse = z.infer<typeof SharedChatResponseSchema>;
export type ChatShareResponse = z.infer<typeof ChatShareResponseSchema>;
