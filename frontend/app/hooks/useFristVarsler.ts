/*
 * Frist-varsler hook
 * Viser toast-varsler for oppgaver med nærliggende deadlines
 * Bruker sessionStorage for å unngå gjentatte varsler per sesjon
 */

import { useEffect, useRef } from "react";
import { showToast } from "../components/Toaster";
import type { AssignmentMedEmne } from "../canvas/canvas-api";
import { FRIST_VINDU_TIMER, klassifiserFrist, formaterTid, type FristStatus } from "../lib/fristUtils";

const STORAGE_KEY = "studywise:frist-varsler";
const SJEKK_INTERVALL_MS = 15 * 60 * 1000; // 15 minutter
const MAKS_TOASTS = 3;

interface FristOppgave {
  id: number;
  navn: string;
  emne: string;
  timerIgjen: number;
  status: FristStatus;
}

/** Hent allerede varslete oppgave-IDer fra sessionStorage */
function hentVarslet(): Set<number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch {
    return new Set();
  }
}

/** Lagre varslet oppgave-ID i sessionStorage */
function lagreVarslet(ider: Set<number>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...ider]));
  } catch {
    // sessionStorage kan feile i private browsing
  }
}

/** Finn oppgaver med nærliggende frister */
function finnNærligendeFrister(oppgaver: AssignmentMedEmne[]): FristOppgave[] {
  const nå = Date.now();
  const resultater: FristOppgave[] = [];

  for (const oppgave of oppgaver) {
    if (!oppgave.due_at) continue;

    const frist = new Date(oppgave.due_at).getTime();
    const timerIgjen = (frist - nå) / (1000 * 60 * 60);

    // Ignorer oppgaver som allerede er forfalt eller mer enn vinduet unna
    if (timerIgjen < 0 || timerIgjen > FRIST_VINDU_TIMER) continue;

    const status = klassifiserFrist(timerIgjen);
    // Legg til i resultatene
    resultater.push({
      id: oppgave.id,
      navn: oppgave.name,
      emne: oppgave.course_name,
      timerIgjen,
      status,
    });
  }

  // Sorter mest presserende først
  resultater.sort((a, b) => a.timerIgjen - b.timerIgjen);
  return resultater;
}

/**
 * Hook som viser toast-varsler for oppgaver med nærliggende frister.
 * Sjekker ved mount og deretter hvert 15. minutt.
 */
export function useFristVarsler(oppgaver: AssignmentMedEmne[] | undefined) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!oppgaver || oppgaver.length === 0) return;

    const sjekkFrister = () => {
      const nærliggende = finnNærligendeFrister(oppgaver);
      if (nærliggende.length === 0) return;

      const varslet = hentVarslet();
      const ikkVarslet = nærliggende.filter((o) => !varslet.has(o.id));
      if (ikkVarslet.length === 0) return;

      // Vis maks MAKS_TOASTS, mest presserende først
      const aVise = ikkVarslet.slice(0, MAKS_TOASTS);

      for (const oppgave of aVise) {
        const tidTekst = formaterTid(oppgave.timerIgjen);
        const beskrivelse = `${oppgave.emne} - ${tidTekst} igjen`;

        if (oppgave.status === "kritisk") {
          showToast.error(`Frist snart: ${oppgave.navn}`, beskrivelse);
        } else if (oppgave.status === "snart") {
          showToast.warning(`Frist nærmer seg: ${oppgave.navn}`, beskrivelse);
        } else {
          showToast.info(`Kommende frist: ${oppgave.navn}`, beskrivelse);
        }

        varslet.add(oppgave.id);
      }

      lagreVarslet(varslet);
    };

    // Sjekk ved mount (med liten forsinkelse slik at UI rekker å rendres)
    const timeout = setTimeout(sjekkFrister, 2000);

    // Sjekk periodisk
    intervalRef.current = setInterval(sjekkFrister, SJEKK_INTERVALL_MS);

    return () => {
      clearTimeout(timeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [oppgaver]);
}
