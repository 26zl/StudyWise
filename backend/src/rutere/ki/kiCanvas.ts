/*
 * Samlet Canvas-kontekstbygging for KI.
 * Henter alle relevante Canvas-data og formaterer til tekstlig kontekst
 * som kan brukes i KI-prompten. Gjenbrukes av ki.ts.
 */
import { logger } from "../../utils/logger.js";
import {
  fetchCourses,
  fetchAllAnnouncements,
  fetchTodo,
  fetchUpcomingEvents,
  fetchPlannerItems,
  fetchAssignments,
} from "../canvas/canvasService.js";
import type {
  CanvasCourse,
  CanvasAssignment,
} from "common/canvas";
import pLimit from "p-limit";

// Begrens samtidige kall til Canvas API for å unngå rate limiting
const limit = pLimit(5); // Maks 5 samtidige connections

// Feilhåndtering dersom canvas token ikke er satt
export async function byggKiCanvasKontekst(canvasToken: string | undefined): Promise<string> {
  if (!canvasToken) {
    return `[CANVAS STATUS: Brukeren har IKKE lagt inn Canvas API-token.
Du kan IKKE svare på spørsmål om brukerens emner, frister, kunngjøringer eller annet Canvas-innhold.
Hvis brukeren spør om Canvas-data, må du informere dem om at de må legge inn Canvas API-token i Innstillinger for å få tilgang til denne funksjonaliteten.]`;
  }

  try {
    // Hent hoveddata parallelt
    const [emnerResult, kunngjoeringerResult, todoResult, eventsResult, plannerResult] =
      await Promise.allSettled([
        fetchCourses(canvasToken),
        fetchAllAnnouncements(canvasToken),
        fetchTodo(canvasToken),
        fetchUpcomingEvents(canvasToken),
        fetchPlannerItems(canvasToken, {}),
      ]);

    // Behandle resultater, ignorer feil
    const emner = emnerResult.status === "fulfilled" ? emnerResult.value.data : [];
    const kunngjoeringer = kunngjoeringerResult.status === "fulfilled" ? kunngjoeringerResult.value.data : [];
    const todos = todoResult.status === "fulfilled" ? todoResult.value.data : [];
    const events = eventsResult.status === "fulfilled" ? eventsResult.value.data : [];
    const planner = plannerResult.status === "fulfilled" ? plannerResult.value.data : [];

    // Hent oppgaver og moduler per emne sekvensielt (antall emner begrenset av Canvas API)
    // for å unngå for mange parallelle kall og rate limiting
    // må nok tweakes
    const MAX_ANNOUNCEMENTS = 10;
    const MAX_TODOS = 10;
    const MAX_EVENTS = 10;
    const MAX_PLANNER = 10;
    const MAX_ASSIGNMENTS_PER_COURSE = 10;
    const MAX_PAGES = 10;
    const MAX_FILES = 10;

    // Hent oppgaver per emne
    const assignmentsPerCourse = await Promise.all(
      emner.map((course: CanvasCourse) =>
        limit(async (): Promise<{ courseId: number; assignments: CanvasAssignment[] }> => {
          const res = await fetchAssignments(canvasToken, course.id);
          return { courseId: course.id, assignments: res.data };
        })
      )
    );
    
    // OPTIMISERING FOR KI: Skip moduler, sider, filer - de tar for lang tid å hente
    // KI trenger bare emner, oppgaver, kunngjøringer, frister - ikke detaljer
    const samletSider: { courseId: number; moduleName: string; title: string; url?: string }[] = [];
    const samletFiler: { courseId: number; moduleName: string; name: string; size?: number }[] = [];

    // Henter canvas data for KI
    const deler: string[] = ["[CANVAS-DATA START]"];
    if (emner.length > 0) {
      deler.push("\nEMNER:");
      emner.forEach((e) => deler.push(`- ${e.name}${e.course_code ? ` (${e.course_code})` : ""}`));
    }
    if (kunngjoeringer.length > 0) {
      deler.push("\nKUNNGJØRINGER:");
      kunngjoeringer.slice(0, MAX_ANNOUNCEMENTS).forEach((k) => {
        const dato = k.posted_at ? new Date(k.posted_at).toLocaleDateString("no-NO") : "";
        deler.push(`- ${k.title}${dato ? ` (${dato})` : ""}`);
      });
    }
    if (todos.length > 0) {
      deler.push("\nKOMMANDE FRISTER:");
      todos.slice(0, MAX_TODOS).forEach((t) => {
        if (t.assignment) {
          const fristStr = t.assignment.due_at;
          const frist = fristStr ? new Date(fristStr) : null;
          const dagerIgjen = frist ? Math.ceil((frist.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
          deler.push(
            `- ${t.assignment.name}${frist ? ` - Frist: ${frist.toLocaleDateString("no-NO")}${dagerIgjen !== null ? ` (${dagerIgjen} dager)` : ""}` : ""
            }`
          );
        }
      });
    }
    if (events.length > 0) {
      deler.push("\nKOMMENDE HENDELSER:");
      events.slice(0, MAX_EVENTS).forEach((e) => {
        const start = e.start_at ? new Date(e.start_at).toLocaleDateString("no-NO") : "";
        const navn = e.title || e.context_code || "Hendelse";
        deler.push(`- ${navn}${start ? ` (${start})` : ""}`);
      });
    }
    if (planner.length > 0) {
      deler.push("\nPLANLEGGER:");
      planner.slice(0, MAX_PLANNER).forEach((p) => {
        const start = p.plannable_date
          ? new Date(p.plannable_date).toLocaleDateString("no-NO")
          : p.plannable?.due_at
            ? new Date(p.plannable.due_at).toLocaleDateString("no-NO")
            : "";
        const courseName = p.course_id ? emner.find((c) => c.id === p.course_id)?.name : undefined;
        const navn = p.plannable?.title || p.plannable_type || "Item";
        const prefix = courseName ? `${courseName}: ` : "";
        deler.push(`- ${prefix}${navn}${start ? ` (${start})` : ""}`);
      });
    }
    if (assignmentsPerCourse.length > 0) {
      deler.push("\nOPPGAVER:");
      assignmentsPerCourse.forEach(({ courseId, assignments }) => {
        const courseName = emner.find((c) => c.id === courseId)?.name || `Emne ${courseId}`;
        assignments.slice(0, MAX_ASSIGNMENTS_PER_COURSE).forEach((a) => {
          const due = a.due_at ? new Date(a.due_at).toLocaleDateString("no-NO") : "";
          deler.push(`- ${courseName}: ${a.name}${due ? ` (frist ${due})` : ""}`);
        });
      });
    }
    if (samletSider.length > 0) {
      deler.push("\nSIDER:");
      samletSider.slice(0, MAX_PAGES).forEach((s) => {
        const courseName = emner.find((c) => c.id === s.courseId)?.name || `Emne ${s.courseId}`;
        deler.push(`- ${courseName} > ${s.moduleName}: ${s.title}`);
      });
    }
    if (samletFiler.length > 0) {
      deler.push("\nFILER:");
      samletFiler.slice(0, MAX_FILES).forEach((f) => {
        const courseName = emner.find((c) => c.id === f.courseId)?.name || `Emne ${f.courseId}`;
        const sizeMb = typeof f.size === "number" ? ` (~${Math.round(f.size / 1024 / 1024)} MB)` : "";
        deler.push(`- ${courseName} > ${f.moduleName}: ${f.name}${sizeMb}`);
      });
    }
    // Avslutt kontekst
    deler.push("\n[CANVAS-DATA SLUTT]");
    logger.info(
      {
        emnerCount: emner.length,
        kunngjoeringerCount: kunngjoeringer.length,
        todosCount: todos.length,
        eventsCount: events.length,
        plannerCount: planner.length,
      },
      "Canvas-kontekst bygget for KI"
    );
    return deler.join("\n");
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av Canvas-data for KI");
    return "[CANVAS STATUS: Kunne ikke hente Canvas-data. Hvis brukeren spør om Canvas-innhold, informer dem om at det oppstod en teknisk feil.]";
  }
}
