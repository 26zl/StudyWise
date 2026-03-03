/*
 * Samlet Canvas-kontekstbygging for KI.
 * Henter alle relevante Canvas-data og formaterer til tekstlig kontekst
 * som kan brukes i KI-prompten. Gjenbrukes av ki.ts.
 */
import { logger } from "../../utils/logger.js";
import { stripHtml } from "../../utils/htmlUtils.js";
import {
  fetchCourses,
  fetchAllAnnouncements,
  fetchTodo,
  fetchUpcomingEvents,
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
    const [emnerResult, kunngjoeringerResult, todoResult, eventsResult] =
      await Promise.allSettled([
        fetchCourses(canvasToken),
        fetchAllAnnouncements(canvasToken),
        fetchTodo(canvasToken),
        fetchUpcomingEvents(canvasToken),
      ]);

    // Behandle resultater, ignorer feil
    const emner = emnerResult.status === "fulfilled" ? emnerResult.value.data : [];
    const kunngjoeringer = kunngjoeringerResult.status === "fulfilled" ? kunngjoeringerResult.value.data : [];
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
          } catch {
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
    const maanedNavn = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
    const ukedag = dagNavn[idag.getDay()];
    const dato = idag.getDate();
    const maaned = maanedNavn[idag.getMonth()];
    const aar = idag.getFullYear();

    // Beregn ukenummer (ISO week)
    const getWeekNumber = (d: Date): number => {
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = date.getUTCDay() || 7;
      date.setUTCDate(date.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    };
    const ukenummer = getWeekNumber(idag);

    // Beregn start og slutt på denne uken (mandag-søndag)
    const startAvUke = new Date(idag);
    const dagIndex = idag.getDay() === 0 ? 6 : idag.getDay() - 1; // Mandag = 0
    startAvUke.setDate(idag.getDate() - dagIndex);
    const sluttAvUke = new Date(startAvUke);
    sluttAvUke.setDate(startAvUke.getDate() + 6);

    deler.push(`\nDAGENS DATO: ${ukedag} ${dato}. ${maaned} ${aar} (uke ${ukenummer})`);
    deler.push(`DENNE UKEN: ${startAvUke.getDate()}. ${maanedNavn[startAvUke.getMonth()]} - ${sluttAvUke.getDate()}. ${maanedNavn[sluttAvUke.getMonth()]} ${sluttAvUke.getFullYear()}`);

    // Emner
    if (emner.length > 0) {
      deler.push("\nEMNER:");
      emner.forEach((e) => deler.push(`- ${e.name}${e.course_code ? ` (${e.course_code})` : ""}`));
    }
    
    // Kunngjøringer med innhold
    if (kunngjoeringer.length > 0) {
      deler.push("\nKUNNGJØRINGER:");
      kunngjoeringer.slice(0, MAX_ANNOUNCEMENTS).forEach((k) => {
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
    // Logger (inkluderer filtrering-statistikk)
    logger.info(
      {
        emnerCount: emner.length,
        kunngjoeringerCount: kunngjoeringer.length,
        todosCount: todos.length,
        todosFiltered: todosRaw.length - todos.length, // Hvor mange ble filtrert bort
        eventsCount: events.length,
        eventsFiltered: eventsRaw.length - events.length, // Hvor mange ble filtrert bort
        modulesCount: totalModules,
        pagesCount: totalPages,
        frontPagesCount: totalFrontPages,
        filesCount: totalFiles,
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
