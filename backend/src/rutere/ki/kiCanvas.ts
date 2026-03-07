/*
 * Samlet Canvas-kontekstbygging for KI.
 * Henter alle relevante Canvas-data og formaterer til tekstlig kontekst
 * som kan brukes i KI-prompten. Gjenbrukes av ki.ts.
 */
import { logger } from "../../utils/logger.js";
import { stripHtml } from "../../utils/htmlUtils.js";
import { getWeekNumber, TWO_WEEKS_MS } from "common/dateUtils";
import {
  fetchCoursesForKI,
  fetchTodo,
  fetchUpcomingEvents,
  fetchAssignments,
  fetchModules,
  fetchPage,
  fetchFileMetadata,
  fetchPdfContent,
  MAX_PDF_FILE_SIZE,
  type CanvasCourseForKI,
} from "../canvas/canvasService.js";
import type {
  CanvasCourse,
} from "common/canvas";
import pLimit from "p-limit";

// Begrens samtidige kall til Canvas API for å unngå rate limiting
const limit = pLimit(3);

const DAG_NAVN = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const MÅNED_NAVN = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

function formaterDatoMedTid(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  const dato = d.toLocaleDateString("no-NO", { timeZone: "Europe/Oslo" });
  const tid = d.toLocaleTimeString("no-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit" });
  return `${dato} kl. ${tid}`;
}

function dagensDatoStreng(includeWeek = false): string {
  const idag = new Date();
  const base = `${DAG_NAVN[idag.getDay()]} ${idag.getDate()}. ${MÅNED_NAVN[idag.getMonth()]} ${idag.getFullYear()}`;
  return includeWeek ? `${base} (uke ${getWeekNumber(idag)})` : base;
}

/**
 * Lett Canvas-kontekst: kun emnenavn + kommende frister (neste 14 dager).
 * Brukes for enkel Canvas-relaterte spørsmål ("hvilke fag har jeg", "neste frist").
 * Mål: ~2 000 tokens i stedet for ~50 000.
 */
export async function byggLettCanvasKontekst(canvasToken: string): Promise<string> {
  try {
    const [emnerResult, todoResult, eventsResult] = await Promise.allSettled([
      fetchCoursesForKI(canvasToken),
      fetchTodo(canvasToken),
      fetchUpcomingEvents(canvasToken),
    ]);

    const emner = emnerResult.status === "fulfilled" ? emnerResult.value.data : [];
    const todosRaw = todoResult.status === "fulfilled" ? todoResult.value.data : [];
    const eventsRaw = eventsResult.status === "fulfilled" ? eventsResult.value.data : [];

    const activeCoursIds = new Set(emner.map((c) => c.id));

    // Filtrer todos til kun aktive emner
    const todos = todosRaw.filter((todo) => {
      if (!todo.course_id) return true;
      return activeCoursIds.has(todo.course_id);
    });

    // Filtrer events til kun aktive emner
    const events = eventsRaw.filter((event) => {
      if (!event.context_code) return true;
      if (!event.context_code.startsWith("course_")) return true;
      const courseIdMatch = event.context_code.match(/^course_(\d+)$/);
      if (!courseIdMatch) return true;
      return activeCoursIds.has(parseInt(courseIdMatch[1], 10));
    });

    // Hent oppgaver for kommende frister (kun aktive emner, kun fremtidige)
    const now = new Date();
    const twoWeeksFromNow = new Date(now.getTime() + TWO_WEEKS_MS);

    const assignmentsPerCourse = await Promise.all(
      emner.slice(0, 20).map((course: CanvasCourse) =>
        limit(async () => {
          try {
            const res = await fetchAssignments(canvasToken, course.id, { bucket: "future" });
            return {
              courseId: course.id,
              courseName: course.name,
              assignments: res.data.filter((a) => {
                if (!a.due_at) return false;
                const d = new Date(a.due_at);
                return d >= now && d <= twoWeeksFromNow;
              }),
            };
          } catch {
            return { courseId: course.id, courseName: course.name, assignments: [] };
          }
        })
      )
    );

    // Bygg kompakt kontekst
    const deler: string[] = ["[CANVAS-DATA START] (lett kontekst)"];
    deler.push(`\nDAGENS DATO: ${dagensDatoStreng(true)}`);

    // Emner
    if (emner.length > 0) {
      deler.push("\nEMNER:");
      emner.forEach((e) => {
        const avsluttet = (e as CanvasCourseForKI).__completed ? " [Avsluttet]" : "";
        deler.push(`- ${e.name}${e.course_code ? ` (${e.course_code})` : ""}${avsluttet}`);
      });
    }

    // Kommende innleveringer (neste 14 dager)
    const alleKommende = assignmentsPerCourse
      .flatMap(({ courseName, assignments }) =>
        assignments.map((a) => ({ name: a.name, courseName, dueAt: a.due_at }))
      )
      .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());

    if (alleKommende.length > 0) {
      deler.push("\nKOMMENDE INNLEVERINGER (neste 14 dager):");
      for (const a of alleKommende.slice(0, 15)) {
        deler.push(`- ${a.name} | ${a.courseName} | Frist: ${formaterDatoMedTid(a.dueAt)}`);
      }
    }

    // Todos
    if (todos.length > 0) {
      deler.push("\nGJØREMÅL:");
      todos.slice(0, 10).forEach((todo) => {
        const name = todo.assignment?.name || "Ukjent";
        deler.push(`- ${name}${todo.assignment?.due_at ? ` (frist: ${formaterDatoMedTid(todo.assignment.due_at)})` : ""}`);
      });
    }

    // Events
    if (events.length > 0) {
      deler.push("\nKOMMENDE HENDELSER:");
      events.slice(0, 10).forEach((event) => {
        deler.push(`- ${event.title}${event.start_at ? ` (${formaterDatoMedTid(event.start_at)})` : ""}`);
      });
    }

    deler.push("\n---");
    deler.push("Dette er en lett Canvas-oversikt (emner + frister). For detaljert innhold (moduler, PDF-er, sider), be brukeren stille et mer spesifikt spørsmål.");
    deler.push("[CANVAS-DATA SLUTT]");

    const kontekst = deler.join("\n");
    logger.info(
      { emnerCount: emner.length, kommendeFrister: alleKommende.length, contextLength: kontekst.length },
      "Lett Canvas-kontekst bygget (~2k tokens)",
    );

    return kontekst;
  } catch (error) {
    logger.error({ err: error }, "Feil ved bygging av lett Canvas-kontekst");
    return "[CANVAS STATUS: Kunne ikke hente Canvas-data. Prøv igjen.]";
  }
}

/**
 * Målrettet Canvas-kontekst: henter kun innhold fra det emnet/modulen brukeren spør om.
 * Reduserer ~48 000 tokens → ~5 000–10 000 tokens for modulspesifikke spørsmål.
 */
export async function byggMålrettetCanvasKontekst(
  canvasToken: string,
  target: { courseHint: string | null; moduleHint: string | null; fileHint: string | null },
): Promise<string> {
  try {
    // 1. Hent alle emner
    const { data: allCourses } = await fetchCoursesForKI(canvasToken);

    // 2. Finn matchende emne
    let matchedCourse: CanvasCourse | undefined;
    if (target.courseHint) {
      const hint = target.courseHint.toLowerCase();
      matchedCourse = allCourses.find((c) =>
        c.name.toLowerCase().includes(hint) ||
        (c.course_code && c.course_code.toLowerCase().includes(hint)),
      );
    }

    // Hvis vi har modulhint men ikke emnehint, søk i alle emner etter modulnavn
    if (!matchedCourse && target.moduleHint) {
      for (const course of allCourses) {
        try {
          const { data: mods } = await fetchModules(canvasToken, course.id);
          const found = mods.some((m) =>
            m.name.toLowerCase().includes(target.moduleHint!.toLowerCase()),
          );
          if (found) {
            matchedCourse = course;
            break;
          }
        } catch {
          // Emnet kan mangle modultilgang — hopp videre
        }
      }
    }

    // Fallback: ingen match → returner lett kontekst (emner + frister)
    if (!matchedCourse) {
      logger.info(
        { target },
        "Målrettet kontekst: Fant ikke matchende emne — faller tilbake til lett kontekst",
      );
      return await byggLettCanvasKontekst(canvasToken);
    }

    // 3. Hent moduler kun for dette emnet
    const { data: modules } = await fetchModules(canvasToken, matchedCourse.id);

    // 4. Finn matchende modul (hvis moduleHint finnes)
    let targetModules = modules;
    if (target.moduleHint) {
      const hint = target.moduleHint.toLowerCase();
      const matched = modules.filter((m) => m.name.toLowerCase().includes(hint));
      if (matched.length > 0) {
        targetModules = matched;
      }
      // Hvis ingen match, bruk alle moduler i emnet (bedre enn ingenting)
    }

    // 5. Bygg kontekst
    const deler: string[] = ["[CANVAS-DATA START] (målrettet kontekst)"];
    deler.push(`\nDAGENS DATO: ${dagensDatoStreng()}`);

    deler.push(`\n=== EMNE: ${matchedCourse.name}${matchedCourse.course_code ? ` (${matchedCourse.course_code})` : ""} ===`);

    // Oppgaver for dette emnet (kommende)
    try {
      const { data: assignments } = await fetchAssignments(canvasToken, matchedCourse.id, { bucket: "future" });
      if (assignments.length > 0) {
        deler.push("\nOPPGAVER:");
        for (const a of assignments.slice(0, 10)) {
          const frist = a.due_at
            ? new Date(a.due_at).toLocaleDateString("no-NO", { timeZone: "Europe/Oslo" })
            : "ingen frist";
          deler.push(`- ${a.name} (frist: ${frist})`);
        }
      }
    } catch {
      // Oppgaver ikke tilgjengelig
    }

    // Moduler med innhold
    deler.push("\nMODULER OG INNHOLD:");
    const MAX_PAGE_CONTENT_LENGTH = 2000;
    const MAX_PDFS_IN_TARGET = 5;
    let pdfCount = 0;

    for (const mod of targetModules) {
      deler.push(`\n--- ${mod.name} ---`);

      if (!mod.items || mod.items.length === 0) continue;

      for (const item of mod.items) {
        if (item.type === "Assignment") {
          deler.push(`  - [Oppgave] ${item.title}`);
        } else if (item.type === "Discussion") {
          deler.push(`  - [Diskusjon] ${item.title}`);
        } else if (item.type === "ExternalUrl") {
          deler.push(`  - [Lenke] ${item.title}`);
        } else if (item.type === "Page" && item.page_url) {
          // Hent sideinnhold
          try {
            const { data: pageData } = await fetchPage(canvasToken, matchedCourse.id, item.page_url);
            if (pageData.body) {
              const content = stripHtml(pageData.body).substring(0, MAX_PAGE_CONTENT_LENGTH);
              deler.push(`\n  [Side: ${item.title}]`);
              if (content) {
                deler.push(`  ${content}${pageData.body.length > MAX_PAGE_CONTENT_LENGTH ? "..." : ""}`);
              }
            } else {
              deler.push(`  - [Side] ${item.title}`);
            }
          } catch {
            deler.push(`  - [Side] ${item.title}`);
          }
        } else if (item.type === "File" && item.content_id && pdfCount < MAX_PDFS_IN_TARGET) {
          // Hent fil-metadata og eventuelt PDF-innhold
          try {
            const { data: fileMeta } = await fetchFileMetadata(canvasToken, item.content_id);
            const isPdf =
              fileMeta.mime_type === "application/pdf" ||
              (fileMeta.filename || "").toLowerCase().endsWith(".pdf");

            if (isPdf && fileMeta.size <= MAX_PDF_FILE_SIZE) {
              const pdfResult = await fetchPdfContent(canvasToken, fileMeta);
              if (pdfResult) {
                pdfCount++;
                const truncLabel = pdfResult.truncated ? " (forkortet)" : "";
                deler.push(`\n  --- FILINNHOLD START: ${fileMeta.display_name || fileMeta.filename}${truncLabel} ---`);
                deler.push(`  ${pdfResult.content}`);
                deler.push(`  --- FILINNHOLD SLUTT: ${fileMeta.display_name || fileMeta.filename} ---`);
              } else {
                deler.push(`  - [Fil] ${item.title}`);
              }
            } else {
              deler.push(`  - [Fil] ${item.title}${fileMeta.mime_type ? ` [${fileMeta.mime_type}]` : ""}`);
            }
          } catch {
            deler.push(`  - [Fil] ${item.title}`);
          }
        } else if (item.type === "File") {
          deler.push(`  - [Fil] ${item.title}`);
        }
      }
    }

    // Vis også liste over ALLE moduler i emnet for kontekst
    if (targetModules.length < modules.length) {
      deler.push(`\nALLE MODULER I ${matchedCourse.name}:`);
      for (const mod of modules) {
        const isTarget = targetModules.some((tm) => tm.id === mod.id);
        deler.push(`  ${isTarget ? "→" : "-"} ${mod.name}${isTarget ? " (detaljert over)" : ""}`);
      }
    }

    deler.push("\n---");
    deler.push("Dette er målrettet Canvas-kontekst for det spesifikke emnet/modulen brukeren spurte om.");
    deler.push("[CANVAS-DATA SLUTT]");

    const kontekst = deler.join("\n");
    logger.info(
      {
        course: matchedCourse.name,
        targetModules: targetModules.map((m) => m.name),
        totalModules: modules.length,
        pdfCount,
        contextLength: kontekst.length,
        target,
      },
      "Målrettet Canvas-kontekst bygget",
    );

    return kontekst;
  } catch (error) {
    logger.error({ err: error, target }, "Feil ved bygging av målrettet Canvas-kontekst");
    return await byggLettCanvasKontekst(canvasToken);
  }
}
