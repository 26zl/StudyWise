/*
 * Samlet Canvas-kontekstbygging for KI.
 * Henter alle relevante Canvas-data og formaterer til tekstlig kontekst
 * som kan brukes i KI-prompten. Gjenbrukes av ki.ts.
 */
import { logger } from "../../utils/logger.js";
import { stripHtml } from "../../utils/htmlUtils.js";
import { getWeekNumber } from "common/dateUtils";
import {
  fetchCoursesForKI,
  fetchAllAnnouncements,
  fetchTodo,
  fetchUpcomingEvents,
  fetchAssignments,
  fetchModules,
  fetchPages,
  fetchPage,
  fetchFrontPage,
  fetchFiles,
  fetchFileMetadata,
  fetchPdfContent,
  type CanvasCourseForKI,
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

/** Maks filstørrelse vi laster ned for PDF-ekstraksjon (5 MB) */
const MAX_PDF_FILE_SIZE = 5 * 1024 * 1024;

/**
 * Trimmer Canvas-kontekst progressivt til den er under maxChars tegn.
 * Fjerner seksjoner i prioritert rekkefølge (minst viktig først).
 */
export function trimCanvasKontekst(kontekst: string, maxChars = 120000): string {
  if (kontekst.length <= maxChars) return kontekst;

  let trimmed = kontekst;

  // Prioritert rekkefølge for fjerning (minst viktig → mest viktig)
  // MODULER OG INNHOLD er mest verdifull — fjernes sist, kun om absolutt nødvendig
  const sections = [
    { name: "SIDEINNHOLD", pattern: /\nSIDEINNHOLD:[\s\S]*?(?=\n(?:PDF-FILINNHOLD|EMNEFORSIDER|FILER I EMNER|MODULER OG INNHOLD|---)|$)/ },
    { name: "FILER I EMNER", pattern: /\nFILER I EMNER:[\s\S]*?(?=\n(?:SIDEINNHOLD|PDF-FILINNHOLD|EMNEFORSIDER|MODULER OG INNHOLD|---)|$)/ },
    { name: "PDF-FILINNHOLD", pattern: /\nPDF-FILINNHOLD:[\s\S]*?(?=\n(?:SIDEINNHOLD|EMNEFORSIDER|FILER I EMNER|MODULER OG INNHOLD|---)|$)/ },
    { name: "EMNEFORSIDER", pattern: /\nEMNEFORSIDER \(Landing Pages\):[\s\S]*?(?=\n(?:FILER I EMNER|SIDEINNHOLD|PDF-FILINNHOLD|MODULER OG INNHOLD|---)|$)/ },
    { name: "OPPGAVER", pattern: /\nOPPGAVER:[\s\S]*?(?=\n(?:MODULER|EMNEFORSIDER|FILER|SIDEINNHOLD|PDF-FILINNHOLD|---)|$)/ },
    { name: "MODULER OG INNHOLD", pattern: /\nMODULER OG INNHOLD:[\s\S]*?(?=\n(?:EMNEFORSIDER|FILER I EMNER|SIDEINNHOLD|PDF-FILINNHOLD|---)|$)/ },
  ];

  for (const section of sections) {
    if (trimmed.length <= maxChars) break;
    const before = trimmed.length;
    trimmed = trimmed.replace(section.pattern, `\n${section.name}: [Fjernet for å spare plass]`);
    if (trimmed.length < before) {
      logger.info(
        { section: section.name, removed: before - trimmed.length, remaining: trimmed.length },
        "trimCanvasKontekst: Fjernet seksjon",
      );
    }
  }

  // Sikkerhetsnett: hard cutoff
  if (trimmed.length > maxChars) {
    logger.warn(
      { originalLength: kontekst.length, trimmedLength: trimmed.length, maxChars },
      "trimCanvasKontekst: Hard cutoff nødvendig",
    );
    trimmed = trimmed.substring(0, maxChars) + "\n...[Kontekst kuttet for å spare plass]\n[CANVAS-DATA SLUTT]";
  }

  return trimmed;
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
    const twoWeeksFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

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

    // Dato-formatering
    const formaterDatoMedTid = (isoString: string | null | undefined): string => {
      if (!isoString) return "";
      const d = new Date(isoString);
      const dato = d.toLocaleDateString("no-NO", { timeZone: "Europe/Oslo" });
      const tid = d.toLocaleTimeString("no-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit" });
      return `${dato} kl. ${tid}`;
    };

    // Bygg kompakt kontekst
    const deler: string[] = ["[CANVAS-DATA START] (lett kontekst)"];

    // Dagens dato
    const idag = new Date();
    const dagNavn = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
    const månedNavn = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
    deler.push(`\nDAGENS DATO: ${dagNavn[idag.getDay()]} ${idag.getDate()}. ${månedNavn[idag.getMonth()]} ${idag.getFullYear()} (uke ${getWeekNumber(idag)})`);

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

    const idag = new Date();
    const dagNavn = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
    const månedNavn = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
    deler.push(`\nDAGENS DATO: ${dagNavn[idag.getDay()]} ${idag.getDate()}. ${månedNavn[idag.getMonth()]} ${idag.getFullYear()}`);

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

// Feilhåndtering dersom canvas token ikke er satt
export async function byggKiCanvasKontekst(canvasToken: string | undefined): Promise<string> {
  if (!canvasToken) {
    return `[CANVAS STATUS: Brukeren har IKKE lagt inn Canvas API-token.
Du kan IKKE svare på spørsmål om brukerens emner, frister, kunngjøringer eller annet Canvas-innhold.
Hvis brukeren spør om Canvas-data, må du informere dem om at de må legge inn Canvas API-token i Innstillinger for å få tilgang til denne funksjonaliteten.]`;
  }

  try {
    // Hent hoveddata parallelt
    const [emnerResult, kunngjøringerResult, todoResult, eventsResult] =
      await Promise.allSettled([
        fetchCoursesForKI(canvasToken),
        fetchAllAnnouncements(canvasToken),
        fetchTodo(canvasToken),
        fetchUpcomingEvents(canvasToken),
      ]);

    // Behandle resultater, ignorer feil
    const emner = emnerResult.status === "fulfilled" ? emnerResult.value.data : [];
    const kunngjøringer = kunngjøringerResult.status === "fulfilled" ? kunngjøringerResult.value.data : [];
    const todosRaw = todoResult.status === "fulfilled" ? todoResult.value.data : [];
    const eventsRaw = eventsResult.status === "fulfilled" ? eventsResult.value.data : [];

    // Bygg Set med aktive emne-IDer for filtrering
    const activeCoursIds = new Set(emner.map((c) => c.id));

    // Filtrer todos til kun aktive emner
    // Beholder items uten course_id (bruker-nivå) eller der course_id er i aktive emner
    const todos = todosRaw.filter((todo) => {
      if (!todo.course_id) return true; // Bruker-nivå todos
      return activeCoursIds.has(todo.course_id);
    });

    // Filtrer events til kun aktive emner
    // context_code er på formatet "course_123" eller "user_456"
    const events = eventsRaw.filter((event) => {
      if (!event.context_code) return true; // Ingen kontekst = vis
      if (!event.context_code.startsWith("course_")) return true; // Bruker-events = vis
      const courseIdMatch = event.context_code.match(/^course_(\d+)$/);
      if (!courseIdMatch) return true; // Ukjent format = vis
      const courseId = parseInt(courseIdMatch[1], 10);
      return activeCoursIds.has(courseId);
    });

    // Konfigurasjon for hvor mye innhold som hentes
    const MAX_ANNOUNCEMENTS = 15;
    const MAX_TODOS = 15;
    const MAX_EVENTS = 15;
    const MAX_ASSIGNMENTS_PER_COURSE = 15;
    const MAX_MODULES_PER_COURSE = 10;
    const MAX_PAGES_PER_COURSE = 10;
    const MAX_FILES_PER_COURSE = 20;
    const MAX_PAGE_CONTENT_LENGTH = 2000; // Tegn per side
    
    // Beregn semestergrenser for filtrering
    // Vår: 1. januar - 30. juni, Høst: 1. august - 31. desember
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-11
    
    // Bestem nåværende semester
    let semesterStart: Date;
    let semesterEnd: Date;
    if (currentMonth >= 0 && currentMonth <= 5) {
      // Vårsemester (januar-juni)
      semesterStart = new Date(currentYear, 0, 1); // 1. januar
      semesterEnd = new Date(currentYear, 6, 31); // 31. juli (litt margin)
    } else {
      // Høstsemester (august-desember)
      semesterStart = new Date(currentYear, 7, 1); // 1. august
      semesterEnd = new Date(currentYear + 1, 0, 31); // 31. januar neste år (litt margin)
    }

    // Hent oppgaver per emne - kun kommende/aktuelle
    const assignmentsPerCourse = await Promise.all(
      emner.map((course: CanvasCourse) =>
        limit(async (): Promise<{ courseId: number; assignments: CanvasAssignment[] }> => {
          try {
            // Hent kun oppgaver som er relevante (upcoming = ikke forfalt ennå)
            const res = await fetchAssignments(canvasToken, course.id, { bucket: "future" });
            // Filtrer også på semester og ekskluder irrelevante oppgaver
            const filteredAssignments = res.data.filter((a) => {
              // Ekskluder spesifikke test-oppgaver som ikke er relevante
              if (a.name?.toLowerCase().includes("test i kildebruk")) return false;
              
              if (!a.due_at) return true; // Inkluder oppgaver uten frist
              const dueDate = new Date(a.due_at);
              return dueDate >= semesterStart && dueDate <= semesterEnd;
            });
            return { courseId: course.id, assignments: filteredAssignments };
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
    // Feil håndteres gracefully med try/catch - negativ caching i canvasUtils hjelper ved gjentatte kall
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
          } catch (err) {
            const courseName = course.name || `Emne ${course.id}`;
            logger.warn({ courseId: course.id, courseName, err }, "Kunne ikke hente filer for emne (bruker modul-fallback)");
            return { courseId: course.id, files: [] };
          }
        })
      )
    );

    // Hjelpefunksjon for konsistent datoformatering med norsk tidssone
    const formaterDato = (isoString: string | null | undefined): string => {
      if (!isoString) return "";
      const d = new Date(isoString);
      return d.toLocaleDateString("no-NO", { timeZone: "Europe/Oslo" });
    };

    const formaterDatoMedTid = (isoString: string | null | undefined): string => {
      if (!isoString) return "";
      const d = new Date(isoString);
      const dato = d.toLocaleDateString("no-NO", { timeZone: "Europe/Oslo" });
      const tid = d.toLocaleTimeString("no-NO", { timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit" });
      return `${dato} kl. ${tid}`;
    };

    // Beregn dager igjen fra midnatt til midnatt (norsk tid)
    const beregnDagerIgjen = (isoString: string | null | undefined): number | null => {
      if (!isoString) return null;
      const frist = new Date(isoString);
      const now = new Date();
      // Konverter begge til midnatt i norsk tid for riktig sammenligning
      const fristDato = new Date(frist.toLocaleDateString("en-CA", { timeZone: "Europe/Oslo" }));
      const idagDato = new Date(now.toLocaleDateString("en-CA", { timeZone: "Europe/Oslo" }));
      const diffMs = fristDato.getTime() - idagDato.getTime();
      return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    };

    // Bygg kontekst-tekst
    const deler: string[] = ["[CANVAS-DATA START]"];

    // Legg til dagens dato eksplisitt så AI vet hva "denne uken" betyr
    const idag = new Date();
    const dagNavn = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
    const månedNavn = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
    const ukedag = dagNavn[idag.getDay()];
    const dato = idag.getDate();
    const måned = månedNavn[idag.getMonth()];
    const år = idag.getFullYear();

    const ukenummer = getWeekNumber(idag);

    // Beregn start og slutt på denne uken (mandag-søndag)
    const startAvUke = new Date(idag);
    const dagIndex = idag.getDay() === 0 ? 6 : idag.getDay() - 1; // Mandag = 0
    startAvUke.setDate(idag.getDate() - dagIndex);
    const sluttAvUke = new Date(startAvUke);
    sluttAvUke.setDate(startAvUke.getDate() + 6);

    deler.push(`\nDAGENS DATO: ${ukedag} ${dato}. ${måned} ${år} (uke ${ukenummer})`);
    deler.push(`DENNE UKEN: ${startAvUke.getDate()}. ${månedNavn[startAvUke.getMonth()]} - ${sluttAvUke.getDate()}. ${månedNavn[sluttAvUke.getMonth()]} ${sluttAvUke.getFullYear()}`);

    // Emner
    if (emner.length > 0) {
      deler.push("\nEMNER:");
      emner.forEach((e) => {
        const avsluttet = (e as CanvasCourseForKI).__completed ? " [Avsluttet]" : "";
        deler.push(`- ${e.name}${e.course_code ? ` (${e.course_code})` : ""}${avsluttet}`);
      });
    }
    
    // Kunngjøringer med innhold
    if (kunngjøringer.length > 0) {
      deler.push("\nKUNNGJØRINGER:");
      kunngjøringer.slice(0, MAX_ANNOUNCEMENTS).forEach((k) => {
        const dato = formaterDato(k.posted_at);
        deler.push(`\n[${k.title}]${dato ? ` (${dato})` : ""}`);
        if (k.message) {
          const content = stripHtml(k.message).substring(0, 500);
          if (content) deler.push(content + (k.message.length > 500 ? "..." : ""));
        }
      });
    }
    
    // Kommende frister - kun fra nåværende semester
    // Filtrer todos til kun de med frist i inneværende semester eller uten frist
    const relevantTodos = todos.filter((t) => {
      // Ekskluder spesifikke test-oppgaver
      if (t.assignment?.name?.toLowerCase().includes("test i kildebruk")) return false;
      
      if (!t.assignment?.due_at) return true; // Inkluder uten frist
      const dueDate = new Date(t.assignment.due_at);
      return dueDate >= semesterStart && dueDate <= semesterEnd;
    });
    
    if (relevantTodos.length > 0) {
      deler.push("\nKOMMANDE FRISTER:");
      relevantTodos.slice(0, MAX_TODOS).forEach((t) => {
        if (t.assignment) {
          const fristStr = t.assignment.due_at;
          const fristFormatert = formaterDatoMedTid(fristStr);
          const dagerIgjen = beregnDagerIgjen(fristStr);
          let dagerTekst = "";
          if (dagerIgjen !== null) {
            if (dagerIgjen < 0) {
              dagerTekst = ` (${Math.abs(dagerIgjen)} dager siden - FORFALT)`;
            } else if (dagerIgjen === 0) {
              dagerTekst = " (I DAG!)";
            } else if (dagerIgjen === 1) {
              dagerTekst = " (I MORGEN!)";
            } else {
              dagerTekst = ` (${dagerIgjen} dager igjen)`;
            }
          }
          deler.push(
            `- ${t.assignment.name}${fristFormatert ? ` - Frist: ${fristFormatert}${dagerTekst}` : ""}`
          );
        }
      });
    }
    
    // Kommende hendelser
    if (events.length > 0) {
      deler.push("\nKOMMENDE HENDELSER:");
      events.slice(0, MAX_EVENTS).forEach((e) => {
        const start = formaterDatoMedTid(e.start_at);
        const navn = e.title || e.context_code || "Hendelse";
        deler.push(`- ${navn}${start ? ` (${start})` : ""}`);
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
            const due = formaterDatoMedTid(a.due_at);
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

    // PDF-FILINNHOLD — hent tekst fra PDF-filer i emnene
    // Strategi: Bruk modul-items som primær kilde (mer pålitelig enn /courses/{id}/files
    // som kan returnere 403 for noen emner). Hent maks PDFer per emne for spredning.
    const MAX_PDFS_TOTAL = 10;
    // Samle ALLE File-items (ikke bare PDFer) — PDF-filter skjer i metadata-steget.
    // Høyere grenser her fordi ikke alle filer er PDFer.
    const MAX_FILE_CANDIDATES_PER_COURSE = 6;
    const MAX_FILE_CANDIDATES_TOTAL = 40;
    const pdfCandidates: Array<{ courseId: number; contentId: number; title: string; moduleName?: string }> = [];
    const seenFileIds = new Set<number>();

    // Samle fil-kandidater fra modul-items (primær kilde — fungerer selv uten /files tilgang).
    // Canvas module items av type "File" har content_id = Canvas file ID.
    // Vi filtrerer IKKE på filnavn/tittel her — titler er display-navn, ikke filnavn.
    // PDF-sjekk skjer i metadata-steget (mime_type).
    const perCoursePdfCount = new Map<number, number>();
    for (const { courseId, modules } of modulesPerCourse) {
      for (const mod of modules) {
        for (const item of mod.items ?? []) {
          const currentCount = perCoursePdfCount.get(courseId) || 0;
          if (
            item.type === "File" &&
            item.content_id &&
            !seenFileIds.has(item.content_id) &&
            currentCount < MAX_FILE_CANDIDATES_PER_COURSE &&
            pdfCandidates.length < MAX_FILE_CANDIDATES_TOTAL
          ) {
            pdfCandidates.push({
              courseId,
              contentId: item.content_id,
              title: item.title,
              moduleName: mod.name,
            });
            seenFileIds.add(item.content_id);
            perCoursePdfCount.set(courseId, currentCount + 1);
          }
        }
      }
    }

    logger.info(
      {
        fileCandidatesFromModules: pdfCandidates.length,
        coursesWithCandidates: perCoursePdfCount.size,
        totalModulesScanned: modulesPerCourse.reduce((s, c) => s + c.modules.length, 0),
      },
      "Fil-kandidater samlet fra modul-items (før metadata/PDF-filter)",
    );

    // Fallback: Sjekk også course files listing for PDFer som ikke er i moduler
    if (pdfCandidates.length < MAX_FILE_CANDIDATES_TOTAL) {
      for (const { courseId, files } of filesPerCourse) {
        const currentCount = perCoursePdfCount.get(courseId) || 0;
        if (currentCount >= MAX_FILE_CANDIDATES_PER_COURSE) continue;
        for (const file of files) {
          if (pdfCandidates.length >= MAX_FILE_CANDIDATES_TOTAL) break;
          if (seenFileIds.has(file.id)) continue;
          const isPdf = file.mime_type === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf");
          if (isPdf && file.size <= MAX_PDF_FILE_SIZE) {
            pdfCandidates.push({ courseId, contentId: file.id, title: file.display_name || file.filename });
            seenFileIds.add(file.id);
            perCoursePdfCount.set(courseId, (perCoursePdfCount.get(courseId) || 0) + 1);
          }
        }
      }
    }

    logger.info(
      { totalCandidates: pdfCandidates.length, fromModules: pdfCandidates.filter(c => c.moduleName).length, fromCourseFiles: pdfCandidates.filter(c => !c.moduleName).length, courses: perCoursePdfCount.size },
      "Totale fil-kandidater (moduler + course files) før metadata/PDF-filter",
    );

    // Hent metadata for alle fil-kandidater og filtrer til kun PDFer
    const pdfFiles: Array<{ courseId: number; file: CanvasFile }> = [];
    if (pdfCandidates.length > 0) {
      const metadataResults = await Promise.all(
        pdfCandidates.map(({ courseId, contentId, title }) =>
          limit(async () => {
            try {
              const { data: fileMeta } = await fetchFileMetadata(canvasToken!, contentId);
              // Sjekk at filen faktisk er en PDF (modul-titler inneholder ikke filtype)
              const isPdf =
                fileMeta.mime_type === "application/pdf" ||
                (fileMeta.filename || "").toLowerCase().endsWith(".pdf") ||
                (fileMeta.display_name || "").toLowerCase().endsWith(".pdf");
              if (!isPdf) {
                logger.debug({ contentId, title, mimeType: fileMeta.mime_type }, "Hopper over ikke-PDF fil fra modul");
                return null;
              }
              if (fileMeta.size > MAX_PDF_FILE_SIZE) {
                logger.info({ contentId, title, size: fileMeta.size }, "PDF for stor etter metadata-sjekk");
                return null;
              }
              return { courseId, file: fileMeta };
            } catch (err) {
              logger.warn({ contentId, title, err }, "Kunne ikke hente filmetadata");
              return null;
            }
          }),
        ),
      );
      for (const result of metadataResults) {
        if (result) {
          pdfFiles.push(result);
          if (pdfFiles.length >= MAX_PDFS_TOTAL) break;
        }
      }
    }

    logger.info(
      { pdfFileCount: pdfFiles.length, candidatesChecked: pdfCandidates.length },
      "PDF-filer etter metadata-filtrering (klar for tekstekstraksjon)",
    );

    if (pdfFiles.length > 0) {
      const pdfResults = await Promise.all(
        pdfFiles.map(({ courseId, file }) =>
          limit(async () => {
            const result = await fetchPdfContent(canvasToken, file);
            return { courseId, file, result };
          }),
        ),
      );

      const successfulPdfs = pdfResults.filter((r) => r.result !== null);
      if (successfulPdfs.length > 0) {
        deler.push("\nPDF-FILINNHOLD:");
        for (const { courseId, file, result } of successfulPdfs) {
          const courseName = emner.find((c) => c.id === courseId)?.name || `Emne ${courseId}`;
          const truncLabel = result!.truncated ? " (forkortet)" : "";
          deler.push(`\n--- FILINNHOLD START: ${file.display_name || file.filename} [${courseName}]${truncLabel} ---`);
          deler.push(result!.content);
          deler.push(`--- FILINNHOLD SLUTT: ${file.display_name || file.filename} ---`);
        }
      }
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
    deler.push("Dette er Canvas-dataene dine inkludert moduler, forsider, filer, PDF-innhold og sideinnhold.");
    deler.push("Hvis informasjonen du leter etter ikke finnes her, finnes den heller ikke i Canvas.");
    deler.push("[CANVAS-DATA SLUTT]");
    
    // Tell total innhold
    const totalModules = modulesPerCourse.reduce((sum, c) => sum + c.modules.length, 0);
    const totalPages = pagesPerCourse.reduce((sum, c) => sum + c.pages.length, 0);
    const totalAssignments = assignmentsPerCourse.reduce((sum, c) => sum + c.assignments.length, 0);
    const totalFrontPages = frontPagesPerCourse.filter(fp => fp.frontPage !== null).length;
    const totalFiles = filesPerCourse.reduce((sum, c) => sum + c.files.length, 0);
    const totalPdfsExtracted = pdfFiles.length;
    // Logger (inkluderer filtrering-statistikk)
    logger.info(
      {
        emnerCount: emner.length,
        kunngjøringerCount: kunngjøringer.length,
        todosCount: todos.length,
        todosFiltered: todosRaw.length - todos.length,
        eventsCount: events.length,
        eventsFiltered: eventsRaw.length - events.length,
        modulesCount: totalModules,
        pagesCount: totalPages,
        frontPagesCount: totalFrontPages,
        filesCount: totalFiles,
        pdfsExtracted: totalPdfsExtracted,
        assignmentsCount: totalAssignments,
        contextLength: deler.join("\n").length,
      },
      "Canvas-kontekst bygget for KI (filtrert til aktive emner)"
    );
    return deler.join("\n");
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av Canvas-data for KI");
    return "[CANVAS STATUS: Kunne ikke hente Canvas-data. Hvis brukeren spør om Canvas-innhold, informer dem om at det oppstod en teknisk feil.]";
  }
}
