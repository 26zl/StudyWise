/**
 * Delte Zod-skjemaer og typer for admin-API.
 */

import { z } from "zod";
import { AccountDeletionDeletedSchema, AuthProviderSchema, RoleSchema } from "./auth.js";

const PaginationQueryValueSchema = z.string().trim().max(6).regex(/^\d+$/);

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
  varsler: z.object({
    pushAbonnementer: CountSchema,
    brukereMedPush: CountSchema,
    snittEnheterPerBruker: MetricSchema,
  }),
  integrasjoner: z.object({
    brukereMedNotion: CountSchema,
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

export const AdminLangsmithPeriodSchema = z.object({
  runs: CountSchema,
  inputTokens: CountSchema,
  outputTokens: CountSchema,
  totalTokens: CountSchema,
});

export const AdminLangsmithDailyTokensSchema = z.object({
  date: z.string().min(1),
  inputTokens: CountSchema,
  outputTokens: CountSchema,
});

export const AdminLangsmithIntentSchema = z.object({
  runs: CountSchema,
  tokens: CountSchema,
});

export const AdminLangsmithStatsResponseSchema = z.object({
  period: z.object({
    days7: AdminLangsmithPeriodSchema,
    days30: AdminLangsmithPeriodSchema,
  }),
  dailyTokens: z.array(AdminLangsmithDailyTokensSchema),
  avgLatencyMs: z.number().min(0),
  errorRate: z.number().min(0).max(1),
  byIntent: z.record(z.string(), AdminLangsmithIntentSchema),
});

export const AdminLangsmithOverviewResponseSchema = z.object({
  totalRuns24h: CountSchema,
  totalRuns7d: CountSchema,
  totalTokens24h: CountSchema,
  totalTokens7d: CountSchema,
  avgLatencyMs: MetricSchema,
  errorRatePercent: MetricSchema,
});

export const AdminLangsmithDailyMetricSchema = z.object({
  date: z.string().min(1),
  inputTokens: CountSchema,
  outputTokens: CountSchema,
  avgLatencyMs: MetricSchema,
});

export const AdminLangsmithDailyMetricsResponseSchema = z.object({
  days: z.number().int().min(1),
  data: z.array(AdminLangsmithDailyMetricSchema),
});

export const AdminLangsmithRunSchema = z.object({
  id: z.string(),
  timestamp: z.string().min(1),
  model: z.string(),
  intent: z.string(),
  user: z.string(),
  course: z.string(),
  inputTokens: CountSchema,
  outputTokens: CountSchema,
  totalTokens: CountSchema,
  latencyMs: CountSchema,
  status: z.enum(["success", "error"]),
});

export const AdminLangsmithRunsResponseSchema = z.object({
  runs: z.array(AdminLangsmithRunSchema),
  total: CountSchema,
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});

export const AdminLangsmithRagSourceSchema = z.object({
  fileName: z.string(),
  score: z.number().min(0).optional(),
});

export const AdminLangsmithRunDetailSchema = AdminLangsmithRunSchema.extend({
  promptPreview: z.string(),
  systemPromptPreview: z.string(),
  ragSources: z.array(AdminLangsmithRagSourceSchema),
  outputPreview: z.string(),
  errorMessage: z.string().optional(),
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
export type AdminLangsmithStatsResponse = z.infer<typeof AdminLangsmithStatsResponseSchema>;
export type AdminLangsmithOverviewResponse = z.infer<typeof AdminLangsmithOverviewResponseSchema>;
export type AdminLangsmithDailyMetric = z.infer<typeof AdminLangsmithDailyMetricSchema>;
export type AdminLangsmithDailyMetricsResponse = z.infer<
  typeof AdminLangsmithDailyMetricsResponseSchema
>;
export type AdminLangsmithRun = z.infer<typeof AdminLangsmithRunSchema>;
export type AdminLangsmithRunsResponse = z.infer<typeof AdminLangsmithRunsResponseSchema>;
export type AdminLangsmithRunDetail = z.infer<typeof AdminLangsmithRunDetailSchema>;
