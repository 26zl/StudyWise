/**
 * Delte Zod-skjemaer og typer for admin-API.
 */

import { z } from "zod";
import { AuthProviderSchema, RoleSchema } from "./auth.js";

export const PaginationQueryValueSchema = z.string().trim().max(6).regex(/^\d+$/);

export const AdminBrukereQuerySchema = z.object({
  limit: PaginationQueryValueSchema.optional(),
  offset: PaginationQueryValueSchema.optional(),
  search: z.string().trim().max(200).optional(),
});

export const AdminBrukerSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  rolle: RoleSchema,
  brukernavn: z.string().optional(),
  fornavn: z.string().optional(),
  etternavn: z.string().optional(),
  harCanvasToken: z.boolean(),
  authProvider: AuthProviderSchema.optional(),
  opprettet: z.coerce.date(),
});

export const AdminBrukerListeResponseSchema = z.object({
  brukere: z.array(AdminBrukerSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
});

export const AdminEndreRolleSchema = z.object({
  rolle: RoleSchema,
});

export const AdminEndreRolleResponseSchema = z.object({
  id: z.string(),
  rolle: RoleSchema,
});

export const AdminDeletedSchema = z.object({
  user: z.boolean(),
  chatHistory: z.number().int().min(0),
  taskBreakdown: z.number().int().min(0),
  contentEmbedding: z.number().int().min(0),
  canvasUser: z.number().int().min(0),
  arbeidsplan: z.number().int().min(0),
});

export const AdminSlettBrukerResponseSchema = z.object({
  slettet: z.literal(true),
  deleted: AdminDeletedSchema,
  providerAccountDeleted: z.boolean(),
});

export const AdminStatsResponseSchema = z.object({
  brukere: z.object({
    totalt: z.number().int().min(0),
    admin: z.number().int().min(0),
    vanlige: z.number().int().min(0),
    medCanvas: z.number().int().min(0),
  }),
  samtaler: z.number().int().min(0),
  oppgaveoppdelinger: z.number().int().min(0),
  embeddings: z.number().int().min(0),
});

export const AdminAuditQuerySchema = z.object({
  limit: PaginationQueryValueSchema.optional(),
  offset: PaginationQueryValueSchema.optional(),
  category: z.string().trim().max(50).optional(),
});

export const AdminAuditItemSchema = z.object({
  id: z.string(),
  action: z.string(),
  category: z.string(),
  outcome: z.string(),
  actorUserId: z.string(),
  targetUserId: z.string().optional(),
  role: RoleSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.coerce.date(),
});

export const AdminAuditResponseSchema = z.object({
  items: z.array(AdminAuditItemSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
});

export type AdminBrukereQuery = z.infer<typeof AdminBrukereQuerySchema>;
export type AdminBruker = z.infer<typeof AdminBrukerSchema>;
export type AdminBrukerListeResponse = z.infer<typeof AdminBrukerListeResponseSchema>;
export type AdminEndreRollePayload = z.infer<typeof AdminEndreRolleSchema>;
export type AdminEndreRolleResponse = z.infer<typeof AdminEndreRolleResponseSchema>;
export type AdminSlettBrukerResponse = z.infer<typeof AdminSlettBrukerResponseSchema>;
export type AdminStatsResponse = z.infer<typeof AdminStatsResponseSchema>;
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;
export type AdminAuditItem = z.infer<typeof AdminAuditItemSchema>;
export type AdminAuditResponse = z.infer<typeof AdminAuditResponseSchema>;
