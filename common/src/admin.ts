/**
 * Delte Zod-skjemaer og typer for admin-API.
 */

import { z } from "zod";
import { AccountDeletionDeletedSchema, AuthProvidersArraySchema, RoleSchema } from "./auth.js";

const PaginationQueryValueSchema = z.string().trim().max(6).regex(/^\d+$/);

export const AdminBrukereStatusFilterSchema = z.enum([
  "all",
  "active",
  "locked",
  "deleted",
]);

export const AdminBrukereQuerySchema = z.object({
  limit: PaginationQueryValueSchema.optional(),
  offset: PaginationQueryValueSchema.optional(),
  search: z.string().trim().max(200).optional(),
  status: AdminBrukereStatusFilterSchema.optional(),
});

export const AdminBrukerSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  rolle: RoleSchema,
  brukernavn: z.string().optional(),
  fornavn: z.string().optional(),
  etternavn: z.string().optional(),
  harCanvasToken: z.boolean(),
  authProviders: AuthProvidersArraySchema.optional(),
  opprettet: z.coerce.date(),
  /** Lock status — admin kan sperre kontoer uten å slette dem (engelsk feltnavn for konsistens med Mongoose-modellen). */
  locked: z.boolean(),
  lockedAt: z.coerce.date().optional(),
  lockedReason: z.string().max(500).optional(),
  /** Soft-delete tidspunkt — kun synlig når status=deleted eller status=all i admin-listen. */
  deletedAt: z.coerce.date().optional(),
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

export const AdminLockUserSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const AdminLockUserResponseSchema = z.object({
  id: z.string(),
  locked: z.literal(true),
  lockedAt: z.coerce.date(),
  lockedReason: z.string().max(500).optional(),
});

export const AdminUnlockUserResponseSchema = z.object({
  id: z.string(),
  locked: z.literal(false),
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
  kunnskapsbase: z.object({
    baser: CountSchema,
    lenker: CountSchema,
    filer: CountSchema,
    chunks: CountSchema,
    brukereMedBase: CountSchema,
    crawledeLenker: CountSchema,
    feiledeLenker: CountSchema,
    snittBaserPerBruker: MetricSchema,
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
    orphanedKunnskapsbaser: CountSchema,
    orphanedKBChunks: CountSchema,
  }),
});

export const AdminAuditQuerySchema = z.object({
  limit: PaginationQueryValueSchema.optional(),
  offset: PaginationQueryValueSchema.optional(),
  category: z.string().trim().max(50).optional(),
  outcome: z.enum(["success", "failure"]).optional(),
  /** Filter på targetUserId — for å hente errors knyttet til en spesifikk bruker. */
  targetUserId: z.string().trim().max(64).optional(),
  /** Filter på actorUserId — komplementært til targetUserId. */
  actorUserId: z.string().trim().max(64).optional(),
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
export type AdminBrukereStatusFilter = z.infer<typeof AdminBrukereStatusFilterSchema>;

// ── Kontakt-innboks (admin) ─────────────────────────────────────────────────

export const ContactMessageStatusSchema = z.enum(["unread", "read", "replied"]);

export const AdminContactMessageSchema = z.object({
  id: z.string(),
  navn: z.string(),
  epost: z.string().email(),
  emne: z.string(),
  melding: z.string(),
  sideUrl: z.string().optional(),
  requestId: z.string().optional(),
  attachmentCount: z.number().int().min(0),
  attachmentSummary: z
    .array(
      z.object({
        filnavn: z.string(),
        sizeBytes: z.number().int().min(0),
        mimeType: z.string(),
      }),
    )
    .optional(),
  status: ContactMessageStatusSchema,
  statusChangedBy: z.string().optional(),
  statusChangedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
});

export const AdminContactMessageListResponseSchema = z.object({
  meldinger: z.array(AdminContactMessageSchema),
  total: z.number().int().min(0),
  unread: z.number().int().min(0),
  limit: z.number().int().min(0),
  offset: z.number().int().min(0),
});

export const AdminContactMessageQuerySchema = z.object({
  limit: PaginationQueryValueSchema.optional(),
  offset: PaginationQueryValueSchema.optional(),
  status: ContactMessageStatusSchema.or(z.literal("all")).optional(),
});

export const AdminContactMessageUpdateSchema = z.object({
  status: ContactMessageStatusSchema,
});

export type AdminContactMessage = z.infer<typeof AdminContactMessageSchema>;
export type AdminContactMessageListResponse = z.infer<typeof AdminContactMessageListResponseSchema>;
export type AdminContactMessageQuery = z.infer<typeof AdminContactMessageQuerySchema>;
export type AdminContactMessageUpdate = z.infer<typeof AdminContactMessageUpdateSchema>;
export type ContactMessageStatus = z.infer<typeof ContactMessageStatusSchema>;

// ── Brukerdetalj-modal (admin) ──────────────────────────────────────────────
// Privacy-prinsipp: ALDRI innhold (chat, dokumenter, Canvas-data, tokens).
// Kun aggregerte tall + status + tidsstempel + de siste audit-handlingene.

export const AdminBrukerDetaljAuditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  category: z.string(),
  outcome: z.string(),
  createdAt: z.coerce.date(),
});

export const AdminBrukerDetaljSchema = z.object({
  // ── Identitet ─────────────────────────────────────────────────────────────
  id: z.string(),
  email: z.string().email(),
  brukernavn: z.string().optional(),
  fornavn: z.string().optional(),
  etternavn: z.string().optional(),
  rolle: RoleSchema,
  opprettet: z.coerce.date(),
  oppdatert: z.coerce.date(),

  // ── Auth-status ───────────────────────────────────────────────────────────
  clerkId: z.string().optional(),
  clerkEnv: z.string().optional(),
  clerkProfileSyncedAt: z.coerce.date().optional(),
  authProviders: AuthProvidersArraySchema.optional(),
  mfaEnabled: z.boolean(),
  oauthAccountCount: z.number().int().min(0),

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  locked: z.boolean(),
  lockedAt: z.coerce.date().optional(),
  lockedReason: z.string().optional(),
  lockedBy: z.string().optional(),
  deleted: z.boolean(),
  deletedAt: z.coerce.date().optional(),

  // ── Canvas-tilkobling (status, IKKE token eller data) ─────────────────────
  canvasConnected: z.boolean(),
  canvasBaseUrl: z.string().optional(),
  canvasUserCached: z.boolean(),

  // ── Aktivitetstellinger (privacy-trygt — null innhold) ────────────────────
  counts: z.object({
    chatHistory: z.number().int().min(0),
    sharedChats: z.number().int().min(0),
    taskBreakdowns: z.number().int().min(0),
    arbeidsplaner: z.number().int().min(0),
    contentEmbeddings: z.number().int().min(0),
    canvasStructures: z.number().int().min(0),
    knowledgeBases: z.number().int().min(0),
    knowledgeBaseChunks: z.number().int().min(0),
    webPushSubscriptions: z.number().int().min(0),
  }),

  // ── Sync-konflikter (typer + tidspunkt, ikke detaljer) ────────────────────
  syncConflictCount: z.number().int().min(0),
  syncConflictTypes: z.array(z.string()).optional(),

  // ── Siste 20 audit-rader (privacy-fri shape) ─────────────────────────────
  recentAuditEntries: z.array(AdminBrukerDetaljAuditEntrySchema),
  auditFailureCount30d: z.number().int().min(0),

  // ── Notion-eksport-status (kun "har konfigurert", ikke nøkkel) ────────────
  notionConfigured: z.boolean(),

  // ── Cookie/UI-preferanser (kun konfigurasjon, ikke historikk) ─────────────
  language: z.string().optional(),
  theme: z.string().optional(),
});

export type AdminBrukerDetalj = z.infer<typeof AdminBrukerDetaljSchema>;
export type AdminBrukerDetaljAuditEntry = z.infer<typeof AdminBrukerDetaljAuditEntrySchema>;
export type AdminBruker = z.infer<typeof AdminBrukerSchema>;
export type AdminBrukerListeResponse = z.infer<typeof AdminBrukerListeResponseSchema>;
export type AdminEndreRollePayload = z.infer<typeof AdminEndreRolleSchema>;
export type AdminEndreRolleResponse = z.infer<typeof AdminEndreRolleResponseSchema>;
export type AdminLockUserPayload = z.infer<typeof AdminLockUserSchema>;
export type AdminLockUserResponse = z.infer<typeof AdminLockUserResponseSchema>;
export type AdminUnlockUserResponse = z.infer<typeof AdminUnlockUserResponseSchema>;
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

// ── BullMQ-køer (admin) ─────────────────────────────────────────────────────

export const QueueJobStatusSchema = z.enum([
  "waiting",
  "active",
  "delayed",
  "completed",
  "failed",
  "paused",
]);

export const AdminQueueCountsSchema = z.object({
  waiting: z.number().int().min(0),
  active: z.number().int().min(0),
  delayed: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  paused: z.number().int().min(0),
});

export const AdminQueueOverviewItemSchema = z.object({
  name: z.string(),
  counts: AdminQueueCountsSchema,
  isPaused: z.boolean(),
});

export const AdminQueueOverviewResponseSchema = z.object({
  queues: z.array(AdminQueueOverviewItemSchema),
});

export const AdminQueueJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: QueueJobStatusSchema,
  attemptsMade: z.number().int().min(0),
  maxAttempts: z.number().int().min(0),
  // Job-data uten sensitive felt; vi lar backend bestemme hva som vises
  data: z.record(z.string(), z.unknown()),
  timestamp: z.number().int(),
  processedOn: z.number().int().optional(),
  finishedOn: z.number().int().optional(),
  failedReason: z.string().optional(),
  delay: z.number().int().min(0).optional(),
});

export const AdminQueueJobsResponseSchema = z.object({
  jobs: z.array(AdminQueueJobSchema),
  total: z.number().int().min(0),
});

export const AdminQueueJobsQuerySchema = z.object({
  status: QueueJobStatusSchema.optional(),
  limit: PaginationQueryValueSchema.optional(),
});

export type QueueJobStatus = z.infer<typeof QueueJobStatusSchema>;
export type AdminQueueCounts = z.infer<typeof AdminQueueCountsSchema>;
export type AdminQueueOverviewItem = z.infer<typeof AdminQueueOverviewItemSchema>;
export type AdminQueueOverviewResponse = z.infer<typeof AdminQueueOverviewResponseSchema>;
export type AdminQueueJob = z.infer<typeof AdminQueueJobSchema>;
export type AdminQueueJobsResponse = z.infer<typeof AdminQueueJobsResponseSchema>;
export type AdminQueueJobsQuery = z.infer<typeof AdminQueueJobsQuerySchema>;

// ── Redis-admin ─────────────────────────────────────────────────────────────

export const AdminRedisInfoResponseSchema = z.object({
  connected: z.boolean(),
  dbSizes: z.record(z.string(), z.number().int().min(0)),
  usedMemoryBytes: z.number().int().min(0),
  usedMemoryHuman: z.string(),
  usedMemoryPeakBytes: z.number().int().min(0),
  usedMemoryPeakHuman: z.string(),
  maxMemoryBytes: z.number().int().min(0),
  maxMemoryHuman: z.string(),
  evictionPolicy: z.string(),
  keyspaceHits: z.number().int().min(0),
  keyspaceMisses: z.number().int().min(0),
  hitRate: z.number().min(0).max(1).nullable(),
  connectedClients: z.number().int().min(0),
  redisVersion: z.string(),
  uptimeSeconds: z.number().int().min(0),
});

export const AdminRedisPrefixSchema = z.object({
  prefix: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
  canFlush: z.boolean(),
});

export const AdminRedisPrefixesResponseSchema = z.object({
  prefixes: z.array(AdminRedisPrefixSchema),
});

export const AdminRedisFlushPrefixSchema = z.object({
  prefix: z.string().min(2).max(64),
});

export const AdminRedisFlushResponseSchema = z.object({
  prefix: z.string(),
  deletedCount: z.number().int().min(0),
});

export const AdminRedisRelinkStateItemSchema = z.object({
  userId: z.string(),
  ttlSeconds: z.number().int(),
  count: z.number().int().min(0).optional(),
  env: z.string().optional(),
  ageSeconds: z.number().int().min(0).optional(),
});

export const AdminRedisRelinkStatesResponseSchema = z.object({
  states: z.array(AdminRedisRelinkStateItemSchema),
});

export type AdminRedisInfoResponse = z.infer<typeof AdminRedisInfoResponseSchema>;
export type AdminRedisPrefix = z.infer<typeof AdminRedisPrefixSchema>;
export type AdminRedisPrefixesResponse = z.infer<typeof AdminRedisPrefixesResponseSchema>;
export type AdminRedisFlushResponse = z.infer<typeof AdminRedisFlushResponseSchema>;
export type AdminRedisRelinkStateItem = z.infer<typeof AdminRedisRelinkStateItemSchema>;
export type AdminRedisRelinkStatesResponse = z.infer<typeof AdminRedisRelinkStatesResponseSchema>;
