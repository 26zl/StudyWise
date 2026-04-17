/**
 * Admin API hooks — React Query hooks for admin-endepunkter.
 * Brukes kun av admin-panelet (AdminSection).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuditResponseSchema,
  AdminBrukerListeResponseSchema,
  AdminEndreRolleResponseSchema,
  AdminEndreRolleSchema,
  AdminFeedbackResponseSchema,
  AdminLangsmithDailyMetricsResponseSchema,
  AdminLangsmithOverviewResponseSchema,
  AdminLangsmithRunDetailSchema,
  AdminMaintenanceFullTextBackfillResponseSchema,
  AdminMaintenanceCleanupOrphanedResponseSchema,
  AdminMaintenanceRebuildEmbeddingsResponseSchema,
  AdminMaintenanceForceCanvasResyncResponseSchema,
  AdminMaintenanceCleanExpiredSharesResponseSchema,
  AdminMaintenanceCleanOldChatsResponseSchema,
  AdminMaintenanceEncryptionStatusResponseSchema,
  AdminMaintenanceReencryptResponseSchema,
  AdminMaintenanceDatabaseHealthResponseSchema,
  AdminBrukerDetaljSchema,
  AdminContactMessageListResponseSchema,
  AdminContactMessageSchema,
  AdminLockUserResponseSchema,
  AdminUnlockUserResponseSchema,
  AdminLangsmithRunsResponseSchema,
  AdminQueueJobsResponseSchema,
  AdminQueueOverviewResponseSchema,
  AdminQueueStateResponseSchema,
  AdminRedisInfoResponseSchema,
  AdminRedisPrefixesResponseSchema,
  AdminRedisRelinkStatesResponseSchema,
  AdminSlettBrukerResponseSchema,
  AdminStatsResponseSchema,
  AdminRevokeSessionsResponseSchema,
  AdminSuccessResponseSchema,
  AdminRedisFlushResultSchema,
} from "common/admin";
import {
  AdminAnnouncementStateSchema,
  DependenciesHealthSchema,
} from "common/system";
import type {
  AdminAuditCategory,
  AdminAuditItem,
  AdminAuditResponse,
  AdminBruker,
  AdminBrukerDetalj,
  AdminBrukerListeResponse,
  AdminContactMessage,
  AdminContactMessageListResponse,
  AdminEndreRollePayload,
  AdminFeedbackItem,
  AdminFeedbackRating,
  AdminFeedbackResponse,
  AdminMaintenanceFullTextBackfillResponse,
  AdminMaintenanceCleanupOrphanedResponse,
  AdminMaintenanceRebuildEmbeddingsResponse,
  AdminMaintenanceForceCanvasResyncResponse,
  AdminMaintenanceCleanExpiredSharesResponse,
  AdminMaintenanceCleanOldChatsResponse,
  AdminMaintenanceEncryptionStatusResponse,
  AdminMaintenanceReencryptResponse,
  AdminMaintenanceDatabaseHealthResponse,
  ContactMessageStatus,
  AdminLangsmithDailyMetricsResponse,
  AdminLangsmithOverviewResponse,
  AdminLangsmithRunDetail,
  AdminLangsmithRunsResponse,
  AdminQueueJob,
  AdminQueueJobsResponse,
  AdminQueueOverviewItem,
  AdminQueueOverviewResponse,
  AdminQueueStateResponse,
  AdminRedisInfoResponse,
  AdminRedisPrefix,
  AdminRedisPrefixesResponse,
  AdminRedisRelinkStateItem,
  AdminRedisRelinkStatesResponse,
  AdminStatsResponse,
  QueueJobStatus,
} from "common/admin";
import { fetchApi } from "../lib/apiClient";
import { createApiError, parseApiErrorBody } from "../lib/errorUtils";

async function throwAdminApiError(
  res: Response,
  fallback: string,
): Promise<never> {
  const { errorCode, errorMessage, payload } = await parseApiErrorBody(res, fallback);
  throw createApiError(
    payload ?? { melding: errorMessage, kode: errorCode },
    errorMessage,
    { apiErrorCode: errorCode },
  );
}

// ── Polling-hjelper for asynkrone vedlikeholdsoperasjoner ────────────────────

/** Polling-intervall for admin-jobber (ms) */
const ADMIN_JOB_POLL_INTERVAL_MS = 3_000;
/** Maks polling-tid (5 minutter) */
const ADMIN_JOB_POLL_TIMEOUT_MS = 300_000;

/**
 * Sender POST til maintenance-endepunkt (202 Accepted),
 * poller /maintenance/status til jobben er ferdig,
 * henter resultat fra /maintenance/result/:op.
 */
async function submitAndPollMaintenanceOp<T>(
  op: string,
  postPath: string,
  resultSchema: { parse: (data: unknown) => T },
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const init: RequestInit = { method: options?.method ?? "POST" };
  if (options?.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(options.body);
  }

  const submitRes = await fetchApi(postPath, init);

  // 4xx-feil (validering, rate limit, lås) returneres fortsatt synkront
  if (!submitRes.ok) {
    await throwAdminApiError(submitRes, "Vedlikeholdsoperasjon feilet");
  }

  // 202 Accepted — poll for resultat
  const startTime = Date.now();
  while (Date.now() - startTime < ADMIN_JOB_POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, ADMIN_JOB_POLL_INTERVAL_MS));

    const statusRes = await fetchApi("/api/admin/maintenance/status");
    if (!statusRes.ok) continue;

    const statusData = (await statusRes.json()) as {
      ops: Record<string, { running: boolean; cooldownUntil: string | null }>;
    };

    // Jobben kjører fortsatt
    if (statusData.ops[op]?.running) continue;

    // Ferdig — hent resultat
    const resultRes = await fetchApi(`/api/admin/maintenance/result/${op}`);
    if (!resultRes.ok) {
      throw new Error("Kunne ikke hente resultat for vedlikeholdsoperasjon.");
    }

    const resultData = await resultRes.json();

    // Sjekk om bakgrunnsjobben feilet
    if (resultData.suksess === false && resultData.error) {
      throw new Error(resultData.error);
    }

    return resultSchema.parse(resultData);
  }

  throw new Error("Vedlikeholdsoperasjonen tok for lang tid. Sjekk status manuelt.");
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin", "statistikk"],
    queryFn: async (): Promise<AdminStatsResponse> => {
      const res = await fetchApi("/api/admin/statistikk");
      if (!res.ok) throw new Error("Kunne ikke hente statistikk");
      return AdminStatsResponseSchema.parse(await res.json());
    },
    staleTime: 30_000,
  });
}

export function useBackfillFullText() {
  return useMutation({
    mutationFn: (): Promise<AdminMaintenanceFullTextBackfillResponse> =>
      submitAndPollMaintenanceOp(
        "backfill-fulltext",
        "/api/admin/maintenance/backfill-fulltext",
        AdminMaintenanceFullTextBackfillResponseSchema,
      ),
  });
}

export function useLangsmithOverview() {
  return useQuery({
    queryKey: ["admin", "langsmith", "overview"],
    queryFn: async (): Promise<AdminLangsmithOverviewResponse> => {
      const res = await fetchApi("/api/admin/langsmith/overview");
      if (!res.ok) throw new Error("Kunne ikke hente LangSmith-overview");
      return AdminLangsmithOverviewResponseSchema.parse(await res.json());
    },
    staleTime: 60_000,
  });
}

export function useDailyMetrics(days = 30) {
  return useQuery({
    queryKey: ["admin", "langsmith", "daily-metrics", days],
    queryFn: async (): Promise<AdminLangsmithDailyMetricsResponse["data"]> => {
      const res = await fetchApi(`/api/admin/langsmith/daily-metrics?days=${days}`);
      if (!res.ok) throw new Error("Kunne ikke hente daglige LangSmith-målinger");
      const parsed = AdminLangsmithDailyMetricsResponseSchema.parse(await res.json());
      return parsed.data;
    },
    staleTime: 60_000,
  });
}

export function useRuns(page = 1, status = "all", intent = "") {
  return useQuery({
    queryKey: ["admin", "langsmith", "runs", page, status, intent],
    queryFn: async (): Promise<AdminLangsmithRunsResponse> => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("status", status);
      if (intent.trim().length > 0) params.set("intent", intent.trim());
      const res = await fetchApi(`/api/admin/langsmith/runs?${params.toString()}`);
      if (!res.ok) throw new Error("Kunne ikke hente LangSmith-runs");
      return AdminLangsmithRunsResponseSchema.parse(await res.json());
    },
    staleTime: 30_000,
  });
}

export function useRunDetail(runId: string | null) {
  return useQuery({
    queryKey: ["admin", "langsmith", "run-detail", runId],
    queryFn: async (): Promise<AdminLangsmithRunDetail> => {
      const res = await fetchApi(`/api/admin/langsmith/runs/${runId}`);
      if (!res.ok) throw new Error("Kunne ikke hente LangSmith run-detaljer");
      return AdminLangsmithRunDetailSchema.parse(await res.json());
    },
    enabled: Boolean(runId),
    staleTime: 30_000,
  });
}

export function useClearLangsmithCache() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchApi("/api/admin/langsmith/clear-cache", { method: "POST" });
      if (!res.ok) throw new Error("Kunne ikke tømme LangSmith-cache");
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "langsmith"] });
    },
  });
}

export type AdminBrukereStatusFilter = "all" | "active" | "locked" | "deleted";

export function useAdminBrukere(
  params: {
    limit?: number;
    offset?: number;
    search?: string;
    status?: AdminBrukereStatusFilter;
  } = {},
) {
  const { limit = 50, offset = 0, search, status = "active" } = params;
  return useQuery({
    queryKey: ["admin", "brukere", { limit, offset, search, status }],
    queryFn: async (): Promise<AdminBrukerListeResponse> => {
      const sp = new URLSearchParams();
      sp.set("limit", String(limit));
      sp.set("offset", String(offset));
      if (search) sp.set("search", search);
      if (status) sp.set("status", status);
      const res = await fetchApi(`/api/admin/brukere?${sp.toString()}`);
      if (!res.ok) throw new Error("Kunne ikke hente brukere");
      return AdminBrukerListeResponseSchema.parse(await res.json());
    },
    staleTime: 15_000,
  });
}

export function useAdminAudit(
  params: {
    limit?: number;
    offset?: number;
    category?: AdminAuditCategory;
    outcome?: "success" | "failure";
    targetUserId?: string;
    actorUserId?: string;
    from?: string;
    to?: string;
  } = {},
) {
  const { limit = 50, offset = 0, category, outcome, targetUserId, actorUserId, from, to } = params;
  return useQuery({
    queryKey: ["admin", "audit", { limit, offset, category, outcome, targetUserId, actorUserId, from, to }],
    queryFn: async (): Promise<AdminAuditResponse> => {
      const sp = new URLSearchParams();
      sp.set("limit", String(limit));
      sp.set("offset", String(offset));
      if (category) sp.set("category", category);
      if (outcome) sp.set("outcome", outcome);
      if (targetUserId) sp.set("targetUserId", targetUserId);
      if (actorUserId) sp.set("actorUserId", actorUserId);
      if (from) sp.set("from", from);
      if (to) sp.set("to", to);
      const res = await fetchApi(`/api/admin/audit?${sp.toString()}`);
      if (!res.ok) throw new Error("Kunne ikke hente revisjonslogg");
      return AdminAuditResponseSchema.parse(await res.json());
    },
    staleTime: 15_000,
  });
}

export function useEndreRolle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ brukerId, rolle }: { brukerId: string; rolle: AdminEndreRollePayload["rolle"] }) => {
      const payload = AdminEndreRolleSchema.parse({ rolle });
      const res = await fetchApi(`/api/admin/brukere/${brukerId}/rolle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke endre rolle");
      }
      return AdminEndreRolleResponseSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "brukere"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

export function useRevokeUserSessions() {
  return useMutation({
    mutationFn: async (brukerId: string) => {
      const res = await fetchApi(`/api/admin/brukere/${brukerId}/revoke-sessions`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke logge ut sesjoner");
      }
      return AdminRevokeSessionsResponseSchema.parse(await res.json());
    },
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: async (brukerId: string) => {
      const res = await fetchApi(`/api/admin/brukere/${brukerId}/resend-verification`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke sende verifiseringsepost");
      }
      return AdminSuccessResponseSchema.parse(await res.json());
    },
  });
}

export function useLockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { brukerId: string; reason?: string }) => {
      const res = await fetchApi(`/api/admin/brukere/${input.brukerId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: input.reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke låse brukeren");
      }
      return AdminLockUserResponseSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "brukere"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

export function useUnlockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (brukerId: string) => {
      const res = await fetchApi(`/api/admin/brukere/${brukerId}/unlock`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke låse opp brukeren");
      }
      return AdminUnlockUserResponseSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "brukere"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

export function useSlettBruker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (brukerId: string) => {
      const res = await fetchApi(`/api/admin/brukere/${brukerId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke slette bruker");
      }
      return AdminSlettBrukerResponseSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "brukere"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

// ── BullMQ-køer ─────────────────────────────────────────────────────────────

export function useQueueOverview() {
  return useQuery({
    queryKey: ["admin", "queues", "overview"],
    queryFn: async (): Promise<AdminQueueOverviewResponse> => {
      const res = await fetchApi("/api/admin/queues/overview");
      if (!res.ok) throw new Error("Kunne ikke hente kø-oversikt");
      return AdminQueueOverviewResponseSchema.parse(await res.json());
    },
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useQueueJobs(
  queueName: string | null,
  status: QueueJobStatus = "failed",
  limit = 25,
) {
  return useQuery({
    queryKey: ["admin", "queues", queueName, "jobs", status, limit],
    enabled: !!queueName,
    queryFn: async (): Promise<AdminQueueJobsResponse> => {
      const params = new URLSearchParams({ status, limit: String(limit) });
      const res = await fetchApi(
        `/api/admin/queues/${encodeURIComponent(queueName!)}/jobs?${params}`,
      );
      if (!res.ok) throw new Error("Kunne ikke hente jobs");
      return AdminQueueJobsResponseSchema.parse(await res.json());
    },
    refetchInterval: 10_000,
  });
}

export function useRetryQueueJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { queueName: string; jobId: string }) => {
      const res = await fetchApi(
        `/api/admin/queues/${encodeURIComponent(input.queueName)}/jobs/${encodeURIComponent(input.jobId)}/retry`,
        { method: "POST" },
      );
      if (!res.ok) {
        await throwAdminApiError(res, "Retry feilet");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "queues"] });
    },
  });
}

export function usePauseQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (queueName: string): Promise<AdminQueueStateResponse> => {
      const res = await fetchApi(
        `/api/admin/queues/${encodeURIComponent(queueName)}/pause`,
        { method: "POST" },
      );
      if (!res.ok) {
        await throwAdminApiError(res, "Kunne ikke pause kø");
      }
      return AdminQueueStateResponseSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "queues"] });
    },
  });
}

export function useResumeQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (queueName: string): Promise<AdminQueueStateResponse> => {
      const res = await fetchApi(
        `/api/admin/queues/${encodeURIComponent(queueName)}/resume`,
        { method: "POST" },
      );
      if (!res.ok) {
        await throwAdminApiError(res, "Kunne ikke starte køen igjen");
      }
      return AdminQueueStateResponseSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "queues"] });
    },
  });
}

export function useRemoveQueueJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { queueName: string; jobId: string }) => {
      const res = await fetchApi(
        `/api/admin/queues/${encodeURIComponent(input.queueName)}/jobs/${encodeURIComponent(input.jobId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        await throwAdminApiError(res, "Sletting feilet");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "queues"] });
    },
  });
}

// ── Redis-admin ─────────────────────────────────────────────────────────────

export function useRedisInfo() {
  return useQuery({
    queryKey: ["admin", "redis", "info"],
    queryFn: async (): Promise<AdminRedisInfoResponse> => {
      const res = await fetchApi("/api/admin/redis/info");
      if (!res.ok) throw new Error("Kunne ikke hente Redis-info");
      return AdminRedisInfoResponseSchema.parse(await res.json());
    },
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}

export function useRedisPrefixes() {
  return useQuery({
    queryKey: ["admin", "redis", "prefixes"],
    queryFn: async (): Promise<AdminRedisPrefixesResponse> => {
      const res = await fetchApi("/api/admin/redis/prefixes");
      if (!res.ok) throw new Error("Kunne ikke hente Redis-prefiks");
      return AdminRedisPrefixesResponseSchema.parse(await res.json());
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useRedisFlushPrefix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (prefix: string) => {
      const res = await fetchApi("/api/admin/redis/flush", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix }),
      });
      if (!res.ok) {
        await throwAdminApiError(res, "Kunne ikke tømme prefix");
      }
      return AdminRedisFlushResultSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "redis"] });
    },
  });
}

export function useRedisRelinkStates() {
  return useQuery({
    queryKey: ["admin", "redis", "relink-states"],
    queryFn: async (): Promise<AdminRedisRelinkStatesResponse> => {
      const res = await fetchApi("/api/admin/redis/relink-states");
      if (!res.ok) throw new Error("Kunne ikke hente relink-states");
      return AdminRedisRelinkStatesResponseSchema.parse(await res.json());
    },
    refetchInterval: 15_000,
  });
}

export function useClearRedisRelinkState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      // Bruker adminBrukere-endepunktet som verifiserer at brukeren finnes
      // og har konsistent audit-logging.
      const res = await fetchApi(
        `/api/admin/brukere/${encodeURIComponent(userId)}/relink-guard`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        await throwAdminApiError(res, "Kunne ikke tømme relink-state");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "redis"] });
    },
  });
}

// ── Brukerdetalj-modal ──────────────────────────────────────────────────────

export function useAdminBrukerDetalj(brukerId: string | null) {
  return useQuery({
    queryKey: ["admin", "brukere", "detalj", brukerId],
    enabled: !!brukerId,
    queryFn: async (): Promise<AdminBrukerDetalj> => {
      const res = await fetchApi(`/api/admin/brukere/${brukerId}/detalj`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke hente brukerdetalj");
      }
      return AdminBrukerDetaljSchema.parse(await res.json());
    },
    staleTime: 10_000,
  });
}

// ── Kontakt-innboks ─────────────────────────────────────────────────────────

export function useAdminContactMessages(
  params: {
    limit?: number;
    offset?: number;
    status?: ContactMessageStatus | "all";
    errorId?: string;
  } = {},
) {
  const { limit = 25, offset = 0, status = "all", errorId } = params;
  return useQuery({
    queryKey: ["admin", "contact-messages", { limit, offset, status, errorId: errorId ?? null }],
    queryFn: async (): Promise<AdminContactMessageListResponse> => {
      const sp = new URLSearchParams();
      sp.set("limit", String(limit));
      sp.set("offset", String(offset));
      sp.set("status", status);
      if (errorId && errorId.trim().length > 0) {
        sp.set("errorId", errorId.trim());
      }
      const res = await fetchApi(`/api/admin/contact/messages?${sp.toString()}`);
      if (!res.ok) throw new Error("Kunne ikke hente kontaktmeldinger");
      return AdminContactMessageListResponseSchema.parse(await res.json());
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useUpdateContactMessageStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; status: ContactMessageStatus }) => {
      const res = await fetchApi(`/api/admin/contact/messages/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: input.status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke oppdatere status");
      }
      return AdminContactMessageSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "contact-messages"] });
    },
  });
}

export function useDeleteContactMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchApi(`/api/admin/contact/messages/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke slette melding");
      }
      return AdminSuccessResponseSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "contact-messages"] });
    },
  });
}

export function useReplyContactMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; melding: string }) => {
      const res = await fetchApi(`/api/admin/contact/messages/${input.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ melding: input.melding }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke sende svar");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "contact-messages"] });
    },
  });
}

// ── Vedlikehold (admin) ────────────────────────────────────────────────────

export function useCleanupOrphaned() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<AdminMaintenanceCleanupOrphanedResponse> =>
      submitAndPollMaintenanceOp(
        "cleanup-orphaned",
        "/api/admin/maintenance/cleanup-orphaned",
        AdminMaintenanceCleanupOrphanedResponseSchema,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

export function useRebuildEmbeddings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<AdminMaintenanceRebuildEmbeddingsResponse> =>
      submitAndPollMaintenanceOp(
        "rebuild-embeddings",
        "/api/admin/maintenance/rebuild-embeddings",
        AdminMaintenanceRebuildEmbeddingsResponseSchema,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

export function useForceCanvasResync() {
  return useMutation({
    mutationFn: (): Promise<AdminMaintenanceForceCanvasResyncResponse> =>
      submitAndPollMaintenanceOp(
        "force-canvas-resync",
        "/api/admin/maintenance/force-canvas-resync",
        AdminMaintenanceForceCanvasResyncResponseSchema,
      ),
  });
}

export function useCleanExpiredShares() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<AdminMaintenanceCleanExpiredSharesResponse> =>
      submitAndPollMaintenanceOp(
        "clean-expired-shares",
        "/api/admin/maintenance/clean-expired-shares",
        AdminMaintenanceCleanExpiredSharesResponseSchema,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

export function useCleanOldChats() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dager: number): Promise<AdminMaintenanceCleanOldChatsResponse> =>
      submitAndPollMaintenanceOp(
        "clean-old-chats",
        "/api/admin/maintenance/clean-old-chats",
        AdminMaintenanceCleanOldChatsResponseSchema,
        { body: { dager } },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

export function useMaintenanceStatus() {
  return useQuery({
    queryKey: ["admin", "maintenance", "status"],
    queryFn: async (): Promise<{ ops: Record<string, { running: boolean; cooldownUntil: string | null }> }> => {
      const res = await fetchApi("/api/admin/maintenance/status");
      if (!res.ok) throw new Error("Kunne ikke hente vedlikeholdsstatus");
      return res.json();
    },
    // Poll raskt (5s) kun mens en operasjon faktisk kjører; ellers sjeldent (30s)
    // slik at admin-fanen ikke belaster dynoen når det ikke foregår noe.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 30_000;
      const noeKjører = Object.values(data.ops).some((op) => op?.running);
      return noeKjører ? 5_000 : 30_000;
    },
    staleTime: 5_000,
  });
}

export function useEncryptionStatus() {
  return useQuery({
    queryKey: ["admin", "maintenance", "encryption-status"],
    queryFn: async (): Promise<AdminMaintenanceEncryptionStatusResponse> => {
      const res = await fetchApi("/api/admin/maintenance/encryption-status");
      if (!res.ok) throw new Error("Kunne ikke hente krypteringsstatus");
      return AdminMaintenanceEncryptionStatusResponseSchema.parse(await res.json());
    },
    staleTime: 60_000,
  });
}

export function useReencryptTokens() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<AdminMaintenanceReencryptResponse> =>
      submitAndPollMaintenanceOp(
        "reencrypt-tokens",
        "/api/admin/maintenance/reencrypt-tokens",
        AdminMaintenanceReencryptResponseSchema,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "maintenance", "encryption-status"] });
    },
  });
}

export function useDatabaseHealth() {
  return useQuery({
    queryKey: ["admin", "maintenance", "database-health"],
    queryFn: async (): Promise<AdminMaintenanceDatabaseHealthResponse> => {
      const res = await fetchApi("/api/admin/maintenance/database-health");
      if (!res.ok) throw new Error("Kunne ikke hente databasehelse");
      return AdminMaintenanceDatabaseHealthResponseSchema.parse(await res.json());
    },
    staleTime: 60_000,
  });
}

// ── Feedback (admin) ────────────────────────────────────────────────────────

export function useAdminFeedback(
  params: {
    rating?: AdminFeedbackRating;
    limit?: number;
  } = {},
) {
  const { rating = "down", limit = 100 } = params;
  return useQuery({
    queryKey: ["admin", "feedback", { rating, limit }],
    queryFn: async (): Promise<AdminFeedbackResponse> => {
      const sp = new URLSearchParams();
      sp.set("rating", rating);
      sp.set("limit", String(limit));
      const res = await fetchApi(`/api/admin/feedback?${sp.toString()}`);
      if (!res.ok) throw new Error("Kunne ikke hente feedback");
      return AdminFeedbackResponseSchema.parse(await res.json());
    },
    staleTime: 10_000,
  });
}

// ─── System status + announcement ────────────────────────────────────────────

export function useDependenciesHealth() {
  return useQuery({
    queryKey: ["admin", "dependencies-health"],
    queryFn: async () => {
      const res = await fetchApi("/health/dependencies");
      if (!res.ok) throw new Error("Kunne ikke hente avhengighetshelse");
      return DependenciesHealthSchema.parse(await res.json());
    },
    // Auto-refresh hvert 30. sekund så admin ser live status.
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useAdminAnnouncement() {
  return useQuery({
    queryKey: ["admin", "announcement"],
    queryFn: async () => {
      // AdminAnnouncementStateSchema tillater tom `melding` når active=false.
      // SystemAnnouncementSchema (brukt av public banner) krever min(1) og ville
      // feilet parse på "ingen melding publisert"-responsen fra backend.
      const res = await fetchApi("/api/admin/announcement");
      if (!res.ok) throw new Error("Kunne ikke hente systemmelding");
      return AdminAnnouncementStateSchema.parse(await res.json());
    },
    staleTime: 10_000,
  });
}

export function usePublishAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      severity: "info" | "warning" | "critical";
      melding: string;
      dismissible: boolean;
    }) => {
      const res = await fetchApi("/api/admin/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await res.text());
      return AdminAnnouncementStateSchema.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "announcement"] });
      void queryClient.invalidateQueries({ queryKey: ["announcement"] });
    },
  });
}

export function useClearAnnouncement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchApi("/api/admin/announcement", { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(await res.text());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "announcement"] });
      void queryClient.invalidateQueries({ queryKey: ["announcement"] });
    },
  });
}

export type {
  AdminAuditCategory,
  AdminBruker,
  AdminStatsResponse,
  AdminAuditItem,
  AdminFeedbackItem,
  AdminFeedbackRating,
  AdminMaintenanceFullTextBackfillResponse,
  AdminMaintenanceCleanupOrphanedResponse,
  AdminMaintenanceRebuildEmbeddingsResponse,
  AdminMaintenanceForceCanvasResyncResponse,
  AdminMaintenanceCleanExpiredSharesResponse,
  AdminMaintenanceCleanOldChatsResponse,
  AdminMaintenanceEncryptionStatusResponse,
  AdminMaintenanceReencryptResponse,
  AdminMaintenanceDatabaseHealthResponse,
  AdminLangsmithOverviewResponse,
  AdminLangsmithRunsResponse,
  AdminLangsmithRunDetail,
  AdminQueueJob,
  AdminQueueOverviewItem,
  QueueJobStatus,
  AdminRedisInfoResponse,
  AdminRedisPrefix,
  AdminRedisRelinkStateItem,
  AdminContactMessage,
  ContactMessageStatus,
  AdminBrukerDetalj,
};
