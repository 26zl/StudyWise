import { z } from "zod";

export const ChatMessageSchema = z.object({
  rolle: z.enum(["user", "assistant"]),
  innhold: z.string(),
});

export const ChatSaveSchema = z.object({
  title: z.string().optional(),
  messages: z.array(ChatMessageSchema),
});

export const ChatHistoryResponseSchema = z.object({
  chats: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      messages: z.array(ChatMessageSchema),
      timestamp: z.union([z.string(), z.date()]),
    })
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

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSavePayload = z.infer<typeof ChatSaveSchema>;
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>; 