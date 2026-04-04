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
  AdminLangsmithRunsResponseSchema,
  AdminLangsmithStatsResponseSchema,
  AdminSlettBrukerResponseSchema,
  AdminStatsResponseSchema,
} from "common/admin";
import type {
  AdminAuditItem,
  AdminAuditResponse,
  AdminBruker,
  AdminBrukerListeResponse,
  AdminEndreRollePayload,
  AdminLangsmithDailyMetricsResponse,
  AdminLangsmithOverviewResponse,
  AdminLangsmithRunDetail,
  AdminLangsmithRunsResponse,
  AdminLangsmithStatsResponse,
  AdminStatsResponse,
} from "common/admin";
import { fetchApi } from "../lib/apiClient";

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

export function useAdminLangsmithStats() {
  return useQuery({
    queryKey: ["admin", "langsmith", "stats"],
    queryFn: async (): Promise<AdminLangsmithStatsResponse> => {
      const res = await fetchApi("/api/admin/langsmith/stats");
      if (!res.ok) throw new Error("Kunne ikke hente LangSmith-statistikk");
      return AdminLangsmithStatsResponseSchema.parse(await res.json());
    },
    staleTime: 60_000,
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

export function useAdminBrukere(params: { limit?: number; offset?: number; search?: string } = {}) {
  const { limit = 50, offset = 0, search } = params;
  return useQuery({
    queryKey: ["admin", "brukere", { limit, offset, search }],
    queryFn: async (): Promise<AdminBrukerListeResponse> => {
      const sp = new URLSearchParams();
      sp.set("limit", String(limit));
      sp.set("offset", String(offset));
      if (search) sp.set("search", search);
      const res = await fetchApi(`/api/admin/brukere?${sp.toString()}`);
      if (!res.ok) throw new Error("Kunne ikke hente brukere");
      return AdminBrukerListeResponseSchema.parse(await res.json());
    },
    staleTime: 15_000,
  });
}

export function useAdminAudit(params: { limit?: number; offset?: number; category?: string } = {}) {
  const { limit = 50, offset = 0, category } = params;
  return useQuery({
    queryKey: ["admin", "audit", { limit, offset, category }],
    queryFn: async (): Promise<AdminAuditResponse> => {
      const sp = new URLSearchParams();
      sp.set("limit", String(limit));
      sp.set("offset", String(offset));
      if (category) sp.set("category", category);
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

export type {
  AdminBruker,
  AdminStatsResponse,
  AdminAuditItem,
  AdminLangsmithStatsResponse,
  AdminLangsmithOverviewResponse,
  AdminLangsmithRunsResponse,
  AdminLangsmithRunDetail,
};
