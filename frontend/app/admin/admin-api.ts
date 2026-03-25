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
  AdminSlettBrukerResponseSchema,
  AdminStatsResponseSchema,
} from "common/admin";
import type {
  AdminAuditItem,
  AdminAuditResponse,
  AdminBruker,
  AdminBrukerListeResponse,
  AdminEndreRollePayload,
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

export type { AdminBruker, AdminStatsResponse, AdminAuditItem };
