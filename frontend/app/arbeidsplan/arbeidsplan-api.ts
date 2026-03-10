/*
 * Arbeidsplan API Client
 * React Query hooks for å håndtere arbeidsplaner
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

// Typer
export interface StudyBlock {
  day: string;
  timeSlot: string;
  task: string;
  duration: string;
  priority: "high" | "medium" | "low";
  courseName: string;
  assignmentId?: string;
  completed: boolean;
  completedAt?: string;
}

export interface Arbeidsplan {
  _id: string;
  userId: string;
  week: string;
  weekNumber: number;
  year: number;
  blocks: StudyBlock[];
  totalHours: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressStats {
  totalBlocks: number;
  completedBlocks: number;
  percentage: number;
  totalHours: number;
  completedHours: number;
}

// Response schemas
const ArbeidsplanResponseSchema = z.object({
  suksess: z.boolean(),
  data: z.any().nullable(),
  melding: z.string().optional(),
});

const ProgressResponseSchema = z.object({
  suksess: z.boolean(),
  data: z.object({
    totalBlocks: z.number(),
    completedBlocks: z.number(),
    percentage: z.number(),
    totalHours: z.number(),
    completedHours: z.number(),
  }),
});

// API funksjoner
async function fetchArbeidsplan(url: string): Promise<Arbeidsplan | null> {
  const res = await fetch(url, {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();
  const validated = ArbeidsplanResponseSchema.parse(json);
  return validated.data;
}

async function createArbeidsplan(data: {
  week: string;
  weekNumber: number;
  year: number;
  blocks: StudyBlock[];
  totalHours: number;
}): Promise<Arbeidsplan> {
  const res = await fetch("/api/arbeidsplan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();
  const validated = ArbeidsplanResponseSchema.parse(json);
  return validated.data;
}

async function updateBlock(
  planId: string,
  blockIndex: number,
  completed: boolean
): Promise<Arbeidsplan> {
  const res = await fetch(`/api/arbeidsplan/${planId}/block`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ blockIndex, completed }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();
  const validated = ArbeidsplanResponseSchema.parse(json);
  return validated.data;
}

async function deleteArbeidsplan(planId: string): Promise<void> {
  const res = await fetch(`/api/arbeidsplan/${planId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

async function fetchProgress(): Promise<ProgressStats> {
  const res = await fetch("/api/arbeidsplan/stats/progress", {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = await res.json();
  const validated = ProgressResponseSchema.parse(json);
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
 * Hent arbeidsplan for spesifikk uke
 */
export function useArbeidsplan(year: number, weekNumber: number) {
  return useQuery({
    queryKey: ["arbeidsplan", year, weekNumber],
    queryFn: () => fetchArbeidsplan(`/api/arbeidsplan/${year}/${weekNumber}`),
    staleTime: 1000 * 60 * 5,
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
      // Invalider cache
      queryClient.invalidateQueries({ queryKey: ["arbeidsplan"] });
      // Sett ny data direkte
      queryClient.setQueryData(["arbeidsplan", "current"], data);
      queryClient.setQueryData(
        ["arbeidsplan", data.year, data.weekNumber],
        data
      );
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
      // Invalider alle arbeidsplan queries
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