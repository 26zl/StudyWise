import { z } from "zod";

export const ChatMessageSchema = z.object({
  rolle: z.enum(["user", "assistant"]),
<<<<<<< HEAD
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
=======
  innhold: z.string().min(1).max(4000),
});

export const ChatSaveSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  messages: z.array(ChatMessageSchema).min(1).max(200),
});

export const ChatHistoryResponseSchema = z.object({
  chats: z.array(z.object({
    id: z.string(),
    title: z.string(),
    messages: z.array(ChatMessageSchema),
    timestamp: z.coerce.date(),
  })),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    pages: z.number(),
  }).optional(),
});

export const ChatHistoryListSchema = z.array(z.object({
  id: z.string(),
  title: z.string(),
  messages: z.array(ChatMessageSchema),
  timestamp: z.coerce.date(),
}));

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatSavePayload = z.infer<typeof ChatSaveSchema>;
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;
>>>>>>> c38f7beed287a901aea825ad8a6571efb9520eb4
