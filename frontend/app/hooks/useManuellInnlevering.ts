/*
 * Manuell innlevering – database-synket tilstand for manuelt markerte oppgaver.
 * Bruker /me som autoritativ kilde og oppdaterer via /preferences.
 */

import { useMemo, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQueryClient } from "@tanstack/react-query";
import {
  AUTH_ME_QUERY_KEY,
  useMeg,
  useOppdaterManuellInnleveringState,
} from "@/app/auth/auth-api";
import type { MeResponse } from "common/auth";
import {
  createDefaultManuellInnleveringState,
  normalizeManuellInnleveringState,
} from "common/auth";

function byggNesteState(
  ferdigeIds: readonly number[],
  assignmentId: number,
) {
  const finnes = ferdigeIds.includes(assignmentId);
  return normalizeManuellInnleveringState({
    ferdigeIds: finnes
      ? ferdigeIds.filter((id) => id !== assignmentId)
      : [...ferdigeIds, assignmentId],
  });
}

/** Hook som returnerer et Set for rask oppslag + toggle-funksjon. */
export function useManuellInnlevering() {
  const queryClient = useQueryClient();
  const { isLoaded, userId } = useAuth();
  const { data: me } = useMeg({ enabled: isLoaded && !!userId });
  const { mutate } = useOppdaterManuellInnleveringState();

  const manuellInnleveringState =
    me?.user?.manuellInnleveringState ?? createDefaultManuellInnleveringState();
  const ferdigeIds = manuellInnleveringState.ferdigeIds;
  const ferdigeIdSet = useMemo(() => new Set(ferdigeIds), [ferdigeIds]);

  const toggleFerdig = useCallback(
    (assignmentId: number) => {
      if (!userId) return;

      const currentState = normalizeManuellInnleveringState(
        queryClient.getQueryData<MeResponse>(AUTH_ME_QUERY_KEY)?.user
          ?.manuellInnleveringState ?? manuellInnleveringState,
      );
      const nesteState = byggNesteState(currentState.ferdigeIds, assignmentId);
      const forrigeMe = queryClient.getQueryData<MeResponse>(AUTH_ME_QUERY_KEY);

      queryClient.setQueryData<MeResponse | undefined>(
        AUTH_ME_QUERY_KEY,
        (current) =>
          current
            ? {
                ...current,
                user: {
                  ...current.user,
                  manuellInnleveringState: nesteState,
                },
              }
            : current,
      );

      mutate(nesteState, {
        onError: () => {
          queryClient.setQueryData(AUTH_ME_QUERY_KEY, forrigeMe);
        },
      });
    },
    [manuellInnleveringState, mutate, queryClient, userId],
  );

  return { ferdigeIdSet, toggleFerdig };
}
