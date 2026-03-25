/**
 * Admin API hooks — React Query hooks for admin-endepunkter.
 * Brukes kun av admin-panelet (AdminSection).
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "../lib/apiClient";

// ── Typer ───────────────────────────────────────────────────────────────────

interface AdminBruker {
  id: string;
  email: string;
  rolle: string;
  brukernavn?: string;
  fornavn?: string;
  etternavn?: string;
  harCanvasToken: boolean;
  authProvider?: string;
  opprettet: string;
}

interface AdminBrukerListeResponse {
  brukere: AdminBruker[];
  total: number;
  limit: number;
  offset: number;
}

interface AdminStatsResponse {
  brukere: {
    totalt: number;
    admin: number;
    vanlige: number;
    medCanvas: number;
  };
  samtaler: number;
  oppgaveoppdelinger: number;
  embeddings: number;
}

interface AdminAuditItem {
  id: string;
  action: string;
  category: string;
  outcome: string;
  actorUserId: string;
  targetUserId?: string;
  role?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface AdminAuditResponse {
  items: AdminAuditItem[];
  total: number;
  limit: number;
  offset: number;
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export function useAdminStats() {
  return useQuery({
    queryKey: ["admin", "statistikk"],
    queryFn: async (): Promise<AdminStatsResponse> => {
      const res = await fetchApi("/api/admin/statistikk");
      if (!res.ok) throw new Error("Kunne ikke hente statistikk");
      return res.json();
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
      return res.json();
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
      return res.json();
    },
    staleTime: 15_000,
  });
}

export function useEndreRolle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ brukerId, rolle }: { brukerId: string; rolle: string }) => {
      const res = await fetchApi(`/api/admin/brukere/${brukerId}/rolle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rolle }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.melding || data.feil || "Kunne ikke endre rolle");
      }
      return res.json();
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
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "brukere"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "statistikk"] });
    },
  });
}

export type { AdminBruker, AdminStatsResponse, AdminAuditItem };
