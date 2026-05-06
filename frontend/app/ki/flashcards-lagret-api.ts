/*
 * API-klient og React Query-hooks for lagrede flashcard-sett.
 * Ingen AI-kall; kun CRUD + registrering av øvelsesøkter.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LagreFlashcardSettRequestSchema,
  LagredeFlashcardSettResponseSchema,
  LagretFlashcardSettResponseSchema,
  RegistrerFlashcardOktRequestSchema,
  type LagreFlashcardSettRequest,
  type LagretFlashcardSett,
  type RegistrerFlashcardOktRequest,
} from "common/flashcardsLagret";
import { fetchApi } from "../lib/apiClient";
import { parseApiError } from "../lib/errorUtils";

export const FLASHCARDS_LAGRET_QUERY_KEY = ["flashcards", "lagrede"] as const;

async function hentLagredeSett(): Promise<LagretFlashcardSett[]> {
  const res = await fetchApi("/api/flashcards/lagrede", { method: "GET" });
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke hente lagrede flashcard-sett"));
  }
  const data = LagredeFlashcardSettResponseSchema.parse(await res.json());
  return data.sett;
}

async function lagreSett(request: LagreFlashcardSettRequest): Promise<LagretFlashcardSett> {
  const parsed = LagreFlashcardSettRequestSchema.parse(request);
  const res = await fetchApi("/api/flashcards/lagrede", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke lagre flashcard-sett"));
  }
  const data = LagretFlashcardSettResponseSchema.parse(await res.json());
  return data.sett;
}

async function slettSett(id: string): Promise<void> {
  const res = await fetchApi(`/api/flashcards/lagrede/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(await parseApiError(res, "Kunne ikke slette lagret flashcard-sett"));
  }
}

async function registrerOkt(
  id: string,
  request: RegistrerFlashcardOktRequest,
): Promise<LagretFlashcardSett> {
  const parsed = RegistrerFlashcardOktRequestSchema.parse(request);
  const res = await fetchApi(`/api/flashcards/lagrede/${encodeURIComponent(id)}/okt`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke registrere økt"));
  }
  const data = LagretFlashcardSettResponseSchema.parse(await res.json());
  return data.sett;
}

// React Query hooks
export function useLagredeFlashcardSett() {
  return useQuery({
    queryKey: FLASHCARDS_LAGRET_QUERY_KEY,
    queryFn: hentLagredeSett,
    staleTime: 1000 * 30,
  });
}

export function useLagreFlashcardSett() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: lagreSett,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLASHCARDS_LAGRET_QUERY_KEY });
    },
  });
}

export function useSlettLagretFlashcardSett() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: slettSett,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FLASHCARDS_LAGRET_QUERY_KEY });
    },
  });
}

export function useRegistrerFlashcardOkt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: RegistrerFlashcardOktRequest }) =>
      registrerOkt(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData([...FLASHCARDS_LAGRET_QUERY_KEY, updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: FLASHCARDS_LAGRET_QUERY_KEY });
    },
  });
}
