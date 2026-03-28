/*
 * Arbeidsplan API Client
 * React Query hooks for å håndtere arbeidsplaner
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "../lib/apiClient";
import { parseApiError } from "../lib/errorUtils";
import {
  ArbeidsplanDeleteResponseSchema,
  ArbeidsplanProgressResponseSchema,
  ArbeidsplanResponseSchema,
  type Arbeidsplan,
  type ArbeidsplanProgress,
  type CreateArbeidsplan,
  UKEDAGER,
} from "common/arbeidsplan";
export const DAYS_ORDER: string[] = [...UKEDAGER];
export type { StudyBlock, Arbeidsplan } from "common/arbeidsplan";
export type ProgressStats = ArbeidsplanProgress;

// Delte Tailwind-klasser for arbeidsplan-komponenter
export const PRIORITY_COLORS = {
  high: "bg-red-100 dark:bg-red-900/20 border-red-300 dark:border-red-700 text-red-700 dark:text-red-300",
  medium: "bg-yellow-100 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300",
  low: "bg-green-100 dark:bg-green-900/20 border-green-300 dark:border-green-700 text-green-700 dark:text-green-300",
} as const;

export const PRIORITY_LABELS: Record<string, string> = {
  high: "Høy",
  medium: "Medium",
  low: "Lav",
};

// API funksjoner
async function fetchArbeidsplan(url: string): Promise<Arbeidsplan | null> {
  const res = await fetchApi(url, { method: "GET" });

  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke hente arbeidsplan"));
  }

  const json = await res.json();
  const validated = ArbeidsplanResponseSchema.parse(json);
  return validated.data as Arbeidsplan | null;
}

async function createArbeidsplan(data: CreateArbeidsplan): Promise<Arbeidsplan> {
  const res = await fetchApi("/api/arbeidsplan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke opprette arbeidsplan"));
  }

  const json = await res.json();
  const validated = ArbeidsplanResponseSchema.parse(json);
  return validated.data as Arbeidsplan;
}

async function updateBlock(
  planId: string,
  blockIndex: number,
  completed: boolean
): Promise<Arbeidsplan> {
  const res = await fetchApi(`/api/arbeidsplan/${planId}/block`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blockIndex, completed }),
  });

  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke oppdatere studieblokk"));
  }

  const json = await res.json();
  const validated = ArbeidsplanResponseSchema.parse(json);
  return validated.data as Arbeidsplan;
}

async function deleteArbeidsplan(planId: string): Promise<void> {
  const res = await fetchApi(`/api/arbeidsplan/${planId}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke slette arbeidsplan"));
  }
  ArbeidsplanDeleteResponseSchema.parse(await res.json());
}

async function fetchProgress(): Promise<ArbeidsplanProgress> {
  const res = await fetchApi("/api/arbeidsplan/stats/progress", { method: "GET" });

  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke hente fremgangsstatistikk"));
  }

  const json = await res.json();
  const validated = ArbeidsplanProgressResponseSchema.parse(json);
  return validated.data;
}

// React Query Hooks

/**
 * Hent gjeldende ukes arbeidsplan
 */
export function useCurrentArbeidsplan() {
  return useQuery({
    queryKey: ["arbeidsplan", "current"],
    queryFn: () => fetchArbeidsplan("/api/arbeidsplan/current"),
    staleTime: 1000 * 60 * 5, // 5 minutter
  });
}

/**
 * Opprett eller oppdater arbeidsplan
 */
export function useCreateArbeidsplan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createArbeidsplan,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["arbeidsplan"] });
      queryClient.setQueryData(["arbeidsplan", "current"], data);
    },
  });
}

/**
 * Toggle fullført-status på en studieblokk
 */
export function useToggleBlockCompletion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      planId,
      blockIndex,
      completed,
    }: {
      planId: string;
      blockIndex: number;
      completed: boolean;
    }) => updateBlock(planId, blockIndex, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["arbeidsplan"] });
    },
  });
}

/**
 * Slett en arbeidsplan
 */
export function useDeleteArbeidsplan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteArbeidsplan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["arbeidsplan"] });
    },
  });
}

/**
 * Hent fremdriftsstatistikk
 */
export function useProgressStats() {
  return useQuery({
    queryKey: ["arbeidsplan", "progress"],
    queryFn: fetchProgress,
    staleTime: 1000 * 30, // 30 sekunder
    refetchInterval: 1000 * 60, // Refresh hvert minutt
  });
}
