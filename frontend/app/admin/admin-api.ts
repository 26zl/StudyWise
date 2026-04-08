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
  AdminLangsmithDailyMetricsResponseSchema,
  AdminLangsmithOverviewResponseSchema,
  AdminLangsmithRunDetailSchema,
  AdminBrukerDetaljSchema,
  AdminContactMessageListResponseSchema,
  AdminContactMessageSchema,
  AdminLockUserResponseSchema,
  AdminUnlockUserResponseSchema,
  AdminLangsmithRunsResponseSchema,
  AdminQueueJobsResponseSchema,
  AdminQueueOverviewResponseSchema,
  AdminRedisInfoResponseSchema,
  AdminRedisPrefixesResponseSchema,
  AdminRedisRelinkStatesResponseSchema,
  AdminSlettBrukerResponseSchema,
  AdminStatsResponseSchema,
} from "common/admin";
import type {
  AdminAuditItem,
  AdminAuditResponse,
  AdminBruker,
  AdminBrukerDetalj,
  AdminBrukerListeResponse,
  AdminContactMessage,
  AdminContactMessageListResponse,
  AdminEndreRollePayload,
  ContactMessageStatus,
  AdminLangsmithDailyMetricsResponse,
  AdminLangsmithOverviewResponse,
  AdminLangsmithRunDetail,
  AdminLangsmithRunsResponse,
  AdminQueueJob,
  AdminQueueJobsResponse,
  AdminQueueOverviewItem,
  AdminQueueOverviewResponse,
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
    category?: string;
    outcome?: "success" | "failure";
    targetUserId?: string;
    actorUserId?: string;
  } = {},
) {
  const { limit = 50, offset = 0, category, outcome, targetUserId, actorUserId } = params;
  return useQuery({
    queryKey: ["admin", "audit", { limit, offset, category, outcome, targetUserId, actorUserId }],
    queryFn: async (): Promise<AdminAuditResponse> => {
      const sp = new URLSearchParams();
      sp.set("limit", String(limit));
      sp.set("offset", String(offset));
      if (category) sp.set("category", category);
      if (outcome) sp.set("outcome", outcome);
      if (targetUserId) sp.set("targetUserId", targetUserId);
      if (actorUserId) sp.set("actorUserId", actorUserId);
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
      return res.json() as Promise<{ success: true; revoked: number }>;
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
      return res.json() as Promise<{ success: true }>;
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

export function useClearRelinkGuard() {
  return useMutation({
    mutationFn: async (brukerId: string) => {
      const res = await fetchApi(
        `/api/admin/brukere/${brukerId}/relink-guard`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke tømme relink-guard");
      }
      return res.json();
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
      return res.json() as Promise<{ prefix: string; deletedCount: number }>;
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
      const res = await fetchApi(
        `/api/admin/redis/relink-state/${encodeURIComponent(userId)}`,
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
  params: { limit?: number; offset?: number; status?: ContactMessageStatus | "all" } = {},
) {
  const { limit = 25, offset = 0, status = "all" } = params;
  return useQuery({
    queryKey: ["admin", "contact-messages", { limit, offset, status }],
    queryFn: async (): Promise<AdminContactMessageListResponse> => {
      const sp = new URLSearchParams();
      sp.set("limit", String(limit));
      sp.set("offset", String(offset));
      sp.set("status", status);
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
      return res.json() as Promise<{ success: true }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "contact-messages"] });
    },
  });
}

export type {
  AdminBruker,
  AdminStatsResponse,
  AdminAuditItem,
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
