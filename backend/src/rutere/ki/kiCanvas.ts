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
  fetchModules,
  fetchPages,
  fetchPage,
  fetchFrontPage,
  fetchFiles,
} from "../canvas/canvasService.js";
import type {
  CanvasCourse,
  CanvasAssignment,
  CanvasModule,
  CanvasPage,
  CanvasFile,
} from "common/canvas";
import pLimit from "p-limit";

// Begrens samtidige kall til Canvas API for å unngå rate limiting
const limit = pLimit(3); // Maks 3 samtidige connections (redusert for stabilitet)

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

    // Konfigurasjon for hvor mye innhold som hentes
    const MAX_ANNOUNCEMENTS = 15;
    const MAX_TODOS = 15;
    const MAX_EVENTS = 15;
    const MAX_PLANNER = 15;
    const MAX_ASSIGNMENTS_PER_COURSE = 15;
    const MAX_MODULES_PER_COURSE = 10;
    const MAX_PAGES_PER_COURSE = 10;
    const MAX_FILES_PER_COURSE = 20;
    const MAX_PAGE_CONTENT_LENGTH = 2000; // Tegn per side

    // Hent oppgaver per emne
    const assignmentsPerCourse = await Promise.all(
      emner.map((course: CanvasCourse) =>
        limit(async (): Promise<{ courseId: number; assignments: CanvasAssignment[] }> => {
          try {
            const res = await fetchAssignments(canvasToken, course.id);
            return { courseId: course.id, assignments: res.data };
          } catch {
            return { courseId: course.id, assignments: [] };
          }
        })
      )
    );

    // Hent moduler per emne (inkluderer modul-items)
    const modulesPerCourse = await Promise.all(
      emner.map((course: CanvasCourse) =>
        limit(async (): Promise<{ courseId: number; modules: CanvasModule[] }> => {
          try {
            const res = await fetchModules(canvasToken, course.id);
            return { courseId: course.id, modules: res.data };
          } catch {
            return { courseId: course.id, modules: [] };
          }
        })
      )
    );

    // Hent sider per emne med innhold
    const pagesPerCourse = await Promise.all(
      emner.map((course: CanvasCourse) =>
        limit(async (): Promise<{ courseId: number; pages: CanvasPage[] }> => {
          try {
            const res = await fetchPages(canvasToken, course.id);
            // Hent innhold for de viktigste sidene
            const pagesWithContent = await Promise.all(
              res.data.slice(0, MAX_PAGES_PER_COURSE).map(async (page) => {
                try {
                  const fullPage = await fetchPage(canvasToken, course.id, page.url || String(page.page_id));
                  return fullPage.data;
                } catch {
                  return page; // Returner metadata uten body hvis innhold feiler
                }
              })
            );
            return { courseId: course.id, pages: pagesWithContent };
          } catch {
            return { courseId: course.id, pages: [] };
          }
        })
      )
    );

    // Hent front page (landing page) per emne
    const frontPagesPerCourse = await Promise.all(
      emner.map((course: CanvasCourse) =>
        limit(async (): Promise<{ courseId: number; frontPage: CanvasPage | null }> => {
          try {
            const res = await fetchFrontPage(canvasToken, course.id);
            return { courseId: course.id, frontPage: res.data };
          } catch {
            return { courseId: course.id, frontPage: null };
          }
        })
      )
    );

    // Hent filer per emne
    const filesPerCourse = await Promise.all(
      emner.map((course: CanvasCourse) =>
        limit(async (): Promise<{ courseId: number; files: CanvasFile[] }> => {
          try {
            const res = await fetchFiles(canvasToken, course.id);
            return { courseId: course.id, files: res.data.slice(0, MAX_FILES_PER_COURSE) };
          } catch {
            return { courseId: course.id, files: [] };
          }
        })
      )
    );

    // Hjelpefunksjon for å strippe HTML
    const stripHtml = (html: string): string => {
      return html
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
    };

    // Bygg kontekst-tekst
    const deler: string[] = ["[CANVAS-DATA START]"];
    
    // Emner
    if (emner.length > 0) {
      deler.push("\nEMNER:");
      emner.forEach((e) => deler.push(`- ${e.name}${e.course_code ? ` (${e.course_code})` : ""}`));
    }
    
    // Kunngjøringer med innhold
    if (kunngjoeringer.length > 0) {
      deler.push("\nKUNNGJØRINGER:");
      kunngjoeringer.slice(0, MAX_ANNOUNCEMENTS).forEach((k) => {
        const dato = k.posted_at ? new Date(k.posted_at).toLocaleDateString("no-NO") : "";
        deler.push(`\n[${k.title}]${dato ? ` (${dato})` : ""}`);
        if (k.message) {
          const content = stripHtml(k.message).substring(0, 500);
          if (content) deler.push(content + (k.message.length > 500 ? "..." : ""));
        }
      });
    }
    
    // Kommende frister
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
    
    // Kommende hendelser
    if (events.length > 0) {
      deler.push("\nKOMMENDE HENDELSER:");
      events.slice(0, MAX_EVENTS).forEach((e) => {
        const start = e.start_at ? new Date(e.start_at).toLocaleDateString("no-NO") : "";
        const navn = e.title || e.context_code || "Hendelse";
        deler.push(`- ${navn}${start ? ` (${start})` : ""}`);
      });
    }
    
    // Planlegger
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
    
    // Oppgaver
    if (assignmentsPerCourse.length > 0) {
      deler.push("\nOPPGAVER:");
      assignmentsPerCourse.forEach(({ courseId, assignments }) => {
        const courseName = emner.find((c) => c.id === courseId)?.name || `Emne ${courseId}`;
        if (assignments.length > 0) {
          deler.push(`\n[${courseName}]`);
          assignments.slice(0, MAX_ASSIGNMENTS_PER_COURSE).forEach((a) => {
            const due = a.due_at ? new Date(a.due_at).toLocaleDateString("no-NO") : "";
            const points = a.points_possible ? ` [${a.points_possible} poeng]` : "";
            deler.push(`- ${a.name}${due ? ` (frist ${due})` : ""}${points}`);
          });
        }
      });
    }
    
    // MODULER OG MODULINNHOLD
    if (modulesPerCourse.length > 0) {
      deler.push("\nMODULER OG INNHOLD:");
      modulesPerCourse.forEach(({ courseId, modules }) => {
        const courseName = emner.find((c) => c.id === courseId)?.name || `Emne ${courseId}`;
        if (modules.length > 0) {
          deler.push(`\n[${courseName}]`);
          modules.slice(0, MAX_MODULES_PER_COURSE).forEach((mod) => {
            deler.push(`\nModul: ${mod.name}`);
            // Modul-items (inkludert i fetchModules via include[]=items)
            if (mod.items && mod.items.length > 0) {
              mod.items.forEach((item) => {
                const itemType = item.type === "Page" ? "Side" 
                  : item.type === "File" ? "Fil"
                  : item.type === "Assignment" ? "Oppgave"
                  : item.type === "Discussion" ? "Diskusjon"
                  : item.type === "ExternalUrl" ? "Lenke"
                  : item.type;
                deler.push(`  - [${itemType}] ${item.title}`);
              });
            }
          });
        }
      });
    }
    
    // FRONT PAGES (Landing pages)
    const frontPagesWithContent = frontPagesPerCourse.filter(fp => fp.frontPage !== null);
    if (frontPagesWithContent.length > 0) {
      deler.push("\nEMNEFORSIDER (Landing Pages):");
      frontPagesWithContent.forEach(({ courseId, frontPage }) => {
        if (frontPage) {
          const courseName = emner.find((c) => c.id === courseId)?.name || `Emne ${courseId}`;
          deler.push(`\n[${courseName} - Forside]`);
          deler.push(`Tittel: ${frontPage.title}`);
          if (frontPage.body) {
            const content = stripHtml(frontPage.body).substring(0, MAX_PAGE_CONTENT_LENGTH);
            if (content) {
              deler.push(content + (frontPage.body.length > MAX_PAGE_CONTENT_LENGTH ? "..." : ""));
            }
          }
        }
      });
    }
    
    // FILER
    const coursesWithFiles = filesPerCourse.filter(fc => fc.files.length > 0);
    if (coursesWithFiles.length > 0) {
      deler.push("\nFILER I EMNER:");
      coursesWithFiles.forEach(({ courseId, files }) => {
        const courseName = emner.find((c) => c.id === courseId)?.name || `Emne ${courseId}`;
        deler.push(`\n[${courseName}]`);
        files.forEach((file) => {
          const sizeMb = file.size ? ` (${(file.size / 1024 / 1024).toFixed(1)} MB)` : "";
          const mimeType = file.mime_type || file.mime_class || "";
          const contentType = mimeType ? ` [${mimeType}]` : "";
          deler.push(`  - ${file.display_name || file.filename}${contentType}${sizeMb}`);
        });
      });
    }
    
    // SIDEINNHOLD
    if (pagesPerCourse.length > 0) {
      deler.push("\nSIDEINNHOLD:");
      pagesPerCourse.forEach(({ courseId, pages }) => {
        const courseName = emner.find((c) => c.id === courseId)?.name || `Emne ${courseId}`;
        if (pages.length > 0) {
          deler.push(`\n[${courseName}]`);
          pages.forEach((page) => {
            deler.push(`\nSide: ${page.title}`);
            if (page.body) {
              const content = stripHtml(page.body).substring(0, MAX_PAGE_CONTENT_LENGTH);
              if (content) {
                deler.push(content + (page.body.length > MAX_PAGE_CONTENT_LENGTH ? "..." : ""));
              }
            }
          });
        }
      });
    }
    
    // Avslutt kontekst
    deler.push("\n---");
    deler.push("Dette er Canvas-dataene dine inkludert moduler, forsider, filer og sideinnhold.");
    deler.push("Hvis informasjonen du leter etter ikke finnes her, finnes den heller ikke i Canvas.");
    deler.push("[CANVAS-DATA SLUTT]");
    
    // Tell total innhold
    const totalModules = modulesPerCourse.reduce((sum, c) => sum + c.modules.length, 0);
    const totalPages = pagesPerCourse.reduce((sum, c) => sum + c.pages.length, 0);
    const totalAssignments = assignmentsPerCourse.reduce((sum, c) => sum + c.assignments.length, 0);
    const totalFrontPages = frontPagesPerCourse.filter(fp => fp.frontPage !== null).length;
    const totalFiles = filesPerCourse.reduce((sum, c) => sum + c.files.length, 0);
    
    logger.info(
      {
        emnerCount: emner.length,
        kunngjoeringerCount: kunngjoeringer.length,
        todosCount: todos.length,
        eventsCount: events.length,
        plannerCount: planner.length,
        modulesCount: totalModules,
        pagesCount: totalPages,
        frontPagesCount: totalFrontPages,
        filesCount: totalFiles,
        assignmentsCount: totalAssignments,
        contextLength: deler.join("\n").length,
      },
      "Canvas-kontekst bygget for KI (komplett med alt innhold)"
    );
    return deler.join("\n");
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av Canvas-data for KI");
    return "[CANVAS STATUS: Kunne ikke hente Canvas-data. Hvis brukeren spør om Canvas-innhold, informer dem om at det oppstod en teknisk feil.]";
  }
}
