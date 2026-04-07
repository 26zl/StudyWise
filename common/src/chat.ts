/*
 * Skjemaer og typer for chat-funksjonalitet
 */

import { z } from "zod";
import { KI_MAX_MESSAGE_LENGTH_BACKEND } from "./ki.js";
import { KIChatSourceSchema } from "./ki.js";

const CHAT_TITLE_MAX_LENGTH = 120;
const CHAT_TOPIC_MAX_LENGTH = 40;

function normalizeOptionalText(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const OptionalNullableChatTitleSchema = z.preprocess(
  normalizeOptionalText,
  z.string().max(CHAT_TITLE_MAX_LENGTH, `Tittel må være maks ${CHAT_TITLE_MAX_LENGTH} tegn`).nullable().optional(),
);

const OptionalNullableChatTopicSchema = z.preprocess(
  normalizeOptionalText,
  z.string().max(CHAT_TOPIC_MAX_LENGTH, `Tema må være maks ${CHAT_TOPIC_MAX_LENGTH} tegn`).nullable().optional(),
);

export const CHAT_SHARE_ACCESS_TYPES = ["public", "private"] as const;
export const ChatShareAccessTypeSchema = z.enum(CHAT_SHARE_ACCESS_TYPES);

// Maks antall chat-samtaler som skal vises i historikken
export const ChatMessageSchema = z.object({
  rolle: z.enum(["user", "assistant"]),
  innhold: z
    .string()
    .max(KI_MAX_MESSAGE_LENGTH_BACKEND, `Meldingen kan være maks ${KI_MAX_MESSAGE_LENGTH_BACKEND} tegn`)
    .refine((value) => value.trim().length > 0, "Meldingen kan ikke være tom"),
  kilder: z.array(KIChatSourceSchema).optional(),
});

// Schema for lagring av chat-samtale. title valgfri; brukes for visning (f.eks. avkortet første spørsmål).
export const ChatSaveSchema = z.object({
  messages: z
    .array(ChatMessageSchema)
    .min(1, "Samtalen må inneholde minst én melding")
    .max(200, "Maks 200 meldinger per samtale"),
  title: OptionalNullableChatTitleSchema,
  topic: OptionalNullableChatTopicSchema,
  pinned: z.boolean().optional(),
});

export const ChatShareCreateSchema = z.object({}).strict();

// Felles schema for en enkelt chat-samtale (delt mellom save og historikk)
const ChatEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  topic: z.string().optional(),
  pinned: z.boolean().optional(),
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

// Schema for share-respons (returneres ved deling)
export const ChatShareResponseSchema = z.object({
  shareId: z.string(),
  shareUrl: z.string(),
  expiresAt: z.coerce.date().nullable(),
  accessType: ChatShareAccessTypeSchema,
});

export const SharedChatListItemSchema = z.object({
  shareId: z.string(),
  chatId: z.string(),
  chatTitle: z.string(),
  topic: z.string().optional(),
  shareUrl: z.string(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  isActive: z.boolean(),
  accessType: ChatShareAccessTypeSchema,
  viewCount: z.number().int().nonnegative(),
});

export const SharedChatListResponseSchema = z.object({
  links: z.array(SharedChatListItemSchema),
});

export const SharedChatUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  accessType: ChatShareAccessTypeSchema.optional(),
  expiresAt: z.coerce.date().nullable().optional(),
}).refine(
  (value) =>
    value.isActive !== undefined ||
    value.accessType !== undefined ||
    value.expiresAt !== undefined,
  { message: "Minst ett felt må oppdateres" },
);

export const SharedChatPublicResponseSchema = z.object({
  shareId: z.string(),
  chatTitle: z.string(),
  messages: z.array(ChatMessageSchema).min(1),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
});

export const ChatTopicUpdateSchema = z.object({
  topic: z.preprocess(
    normalizeOptionalText,
    z.string().max(CHAT_TOPIC_MAX_LENGTH, `Tema må være maks ${CHAT_TOPIC_MAX_LENGTH} tegn`).nullable(),
  ),
});

export const ChatPinUpdateSchema = z.object({
  pinned: z.boolean(),
});

export const ChatTitleUpdateSchema = z.object({
  title: z.string().trim().min(1, "Tittel må fylles ut").max(CHAT_TITLE_MAX_LENGTH, `Tittel må være maks ${CHAT_TITLE_MAX_LENGTH} tegn`),
});

export const ChatTopicUpdateResponseSchema = z.object({
  id: z.string(),
  topic: z.string().optional(),
});

export const ChatPinUpdateResponseSchema = z.object({
  id: z.string(),
  pinned: z.boolean(),
});

export const ChatTitleUpdateResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
});
// Type-definisjoner for chat-meldinger og historikk
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSavePayload = z.infer<typeof ChatSaveSchema>;
export type ChatShareCreatePayload = z.infer<typeof ChatShareCreateSchema>;
export type ChatSaveResponse = z.infer<typeof ChatSaveResponseSchema>;
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;
export type ChatShareResponse = z.infer<typeof ChatShareResponseSchema>;
export type SharedChatListItem = z.infer<typeof SharedChatListItemSchema>;
export type SharedChatListResponse = z.infer<typeof SharedChatListResponseSchema>;
export type SharedChatUpdatePayload = z.infer<typeof SharedChatUpdateSchema>;
export type SharedChatPublicResponse = z.infer<typeof SharedChatPublicResponseSchema>;
export type ChatTopicUpdatePayload = z.infer<typeof ChatTopicUpdateSchema>;
export type ChatPinUpdatePayload = z.infer<typeof ChatPinUpdateSchema>;
export type ChatTitleUpdatePayload = z.infer<typeof ChatTitleUpdateSchema>;
export type ChatTopicUpdateResponse = z.infer<typeof ChatTopicUpdateResponseSchema>;
export type ChatPinUpdateResponse = z.infer<typeof ChatPinUpdateResponseSchema>;
export type ChatTitleUpdateResponse = z.infer<typeof ChatTitleUpdateResponseSchema>;
