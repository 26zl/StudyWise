/*
 * API-klient og React Query-hooks for lagrede quizer.
 * Ingen AI-kall; kun CRUD + registrering av forsøk.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LagreQuizRequestSchema,
  LagredeQuizerResponseSchema,
  LagretQuizResponseSchema,
  RegistrerQuizForsokRequestSchema,
  type LagreQuizRequest,
  type LagretQuiz,
  type RegistrerQuizForsokRequest,
} from "common/quizLagret";
import { fetchApi } from "../lib/apiClient";
import { parseApiError } from "../lib/errorUtils";

export const QUIZ_LAGRET_QUERY_KEY = ["quiz", "lagrede"] as const;

async function hentLagredeQuizer(): Promise<LagretQuiz[]> {
  const res = await fetchApi("/api/quiz/lagrede", { method: "GET" });
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke hente lagrede quizer"));
  }
  const data = LagredeQuizerResponseSchema.parse(await res.json());
  return data.quizer;
}

async function lagreQuiz(request: LagreQuizRequest): Promise<LagretQuiz> {
  const parsed = LagreQuizRequestSchema.parse(request);
  const res = await fetchApi("/api/quiz/lagrede", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke lagre quiz"));
  }
  const data = LagretQuizResponseSchema.parse(await res.json());
  return data.quiz;
}

async function slettLagretQuiz(id: string): Promise<void> {
  const res = await fetchApi(`/api/quiz/lagrede/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    throw new Error(await parseApiError(res, "Kunne ikke slette lagret quiz"));
  }
}

async function registrerForsok(
  id: string,
  request: RegistrerQuizForsokRequest,
): Promise<LagretQuiz> {
  const parsed = RegistrerQuizForsokRequestSchema.parse(request);
  const res = await fetchApi(`/api/quiz/lagrede/${encodeURIComponent(id)}/forsok`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(parsed),
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res, "Kunne ikke registrere forsøk"));
  }
  const data = LagretQuizResponseSchema.parse(await res.json());
  return data.quiz;
}

// React Query hooks
export function useLagredeQuizer() {
  return useQuery({
    queryKey: QUIZ_LAGRET_QUERY_KEY,
    queryFn: hentLagredeQuizer,
    staleTime: 1000 * 30,
  });
}

export function useLagreQuiz() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: lagreQuiz,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUIZ_LAGRET_QUERY_KEY });
    },
  });
}

export function useSlettLagretQuiz() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: slettLagretQuiz,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QUIZ_LAGRET_QUERY_KEY });
    },
  });
}

export function useRegistrerQuizForsok() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: RegistrerQuizForsokRequest }) =>
      registrerForsok(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData([...QUIZ_LAGRET_QUERY_KEY, updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: QUIZ_LAGRET_QUERY_KEY });
    },
  });
}
