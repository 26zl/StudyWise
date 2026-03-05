/*
 * Canvas-utils – delte hjelpefunksjoner for Canvas-data i frontend.
 * Alle filer som trenger slik logikk bør importere herfra.
 */

import type { AssignmentMedEmne } from "./canvas-api";

/** Sjekk om en oppgave er innlevert (submitted, graded eller pending_review) */
export function erInnlevert(oppgave: AssignmentMedEmne): boolean {
    const ws = oppgave.submission?.workflow_state;
    return ws === "submitted" || ws === "graded" || ws === "pending_review";
}

/** Formater emne workflow_state til lesbar status (f.eks. "available" → "aktiv") */
export function formaterEmneStatus(workflowState?: string | null): string {
    if (!workflowState) return "ukjent";
    if (workflowState === "available") return "aktiv";
    return workflowState;
}
