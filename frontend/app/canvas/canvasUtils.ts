/*
 * Canvas-utils – delte hjelpefunksjoner for Canvas-data i frontend.
 * Alle filer som trenger slik logikk bør importere herfra.
 */

import { isCanvasAssignmentSubmitted } from "common/canvas";
import type { AssignmentMedEmne } from "./canvas-api";

/** Sjekk om en oppgave er innlevert (submitted, graded eller pending_review) */
export function erInnlevert(oppgave: AssignmentMedEmne): boolean {
    return isCanvasAssignmentSubmitted(oppgave);
}
