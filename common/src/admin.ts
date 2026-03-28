/**
 * Delte Zod-skjemaer og typer for admin-API.
 */

import { z } from "zod";
import { AccountDeletionDeletedSchema, AuthProviderSchema, RoleSchema } from "./auth.js";

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

export const AdminSlettBrukerResponseSchema = z.object({
  slettet: z.literal(true),
  deleted: AccountDeletionDeletedSchema,
  providerAccountDeleted: z.boolean(),
  vectorCleanupSucceeded: z.boolean(),
});

const CountSchema = z.number().int().min(0);
const MetricSchema = z.number().min(0);

export const AdminStatsResponseSchema = z.object({
  brukere: z.object({
    totalt: CountSchema,
    admin: CountSchema,
    vanlige: CountSchema,
    medCanvas: CountSchema,
    utenCanvas: CountSchema,
    slettede: CountSchema,
    google: CountSchema,
    microsoft: CountSchema,
    email: CountSchema,
    ukjentProvider: CountSchema,
  }),
  samtaler: z.object({
    totalt: CountSchema,
    bokmerket: CountSchema,
    snittPerBruker: MetricSchema,
  }),
  deling: z.object({
    aktiveLenker: CountSchema,
    inaktiveLenker: CountSchema,
    utlopteLenker: CountSchema,
    lenkerMedVisninger: CountSchema,
    visningerTotalt: CountSchema,
  }),
  oppgaver: z.object({
    oppgaveoppdelinger: CountSchema,
    deloppgaverTotalt: CountSchema,
    fullforteDeloppgaver: CountSchema,
    godkjenteDeloppgaver: CountSchema,
    snittDeloppgaverPerOppdeling: MetricSchema,
  }),
  arbeidsplan: z.object({
    planer: CountSchema,
    blokkerTotalt: CountSchema,
    fullforteBlokker: CountSchema,
    brukereMedPlan: CountSchema,
    fullforingsgrad: MetricSchema,
  }),
  innhold: z.object({
    dokumentfragmenter: CountSchema,
    dokumentfiler: CountSchema,
    dokumentemner: CountSchema,
    brukereMedInnhold: CountSchema,
    tokensTotalt: CountSchema,
    snittChunksPerFil: MetricSchema,
    kursstrukturer: CountSchema,
    canvasOppgaver: CountSchema,
    canvasKunngjoringer: CountSchema,
    canvasModuler: CountSchema,
    canvasModulElementer: CountSchema,
  }),
  sync: z.object({
    brukereMedSyncData: CountSchema,
    brukereMedFerskSync24t: CountSchema,
    brukereMedGammelSync7d: CountSchema,
    canvasBrukereUtenSyncData: CountSchema,
  }),
  revisjon: z.object({
    hendelserTotalt: CountSchema,
    feilTotalt: CountSchema,
    hendelser24t: CountSchema,
    feil24t: CountSchema,
    admin24t: CountSchema,
    auth24t: CountSchema,
    integration24t: CountSchema,
    ki24t: CountSchema,
    privacy24t: CountSchema,
    profile24t: CountSchema,
    security24t: CountSchema,
  }),
  kvalitet: z.object({
    orphanedSamtaler: CountSchema,
    orphanedOppgaveoppdelinger: CountSchema,
    orphanedDokumentfragmenter: CountSchema,
    orphanedArbeidsplaner: CountSchema,
    orphanedCanvasStrukturer: CountSchema,
    orphanedCanvasBrukere: CountSchema,
    delingerUtenEier: CountSchema,
  }),
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
