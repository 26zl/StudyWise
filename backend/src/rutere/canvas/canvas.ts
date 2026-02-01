/*
* Canvas API router
* Håndterer ruter for å kommunisere med Canvas LMS API ved hjelp av brukerens Canvas API-token.
* Inkluderer ruter for å hente brukerinfo, emner, oppgaver, moduler, filer, og andre ressurser fra Canvas.
* Bruker Zod for validering av Canvas API-responser og logger viktige hendelser.
* Eksporterer en Express-router som kan brukes i hovedapplikasjonen.
*/
import { Router } from "express";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  krevCanvasToken,
  hentCanvasKonfig,
  validateCanvasRedirectUrl,
  parseCourseIdFromContext,
  erInnenforKalenderVindu,
} from "./canvasUtils.js";
import { CACHE_TTL } from "./canvasUtils.js";
import { rateLimitCanvas, rateLimitCanvasTung } from "../../middleware/rate-limit.js";
import { noCache } from "../../middleware/no-cache.js";
import { logger } from "../../utils/logger.js";
import { getCache, setCache } from "../../cache/redis.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import { User } from "../../database/models/User.js";
import {
  fetchUserProfile,
  fetchCourses,
  fetchCourse,
  fetchAssignments,
  fetchCourseAnnouncements,
  fetchAllAnnouncements,
  fetchPlannerItems,
  fetchModules,
  fetchModuleItems,
  fetchModuleItem,
  fetchFileMetadata,
  fetchPage,
  fetchDiscussionTopic,
  fetchTodo,
  fetchUpcomingEvents,
  fetchFiles,
  fetchPages,
  fetchFrontPage,
} from "./canvasService.js";
import { CalendarItemsResponseSchema, type CalendarItem } from "common/calendar";

// Feiltype for Canvas HTTP-feil
interface CanvasHttpError extends Error {
  status?: number;
  details?: string;
}

// Oppretter express router
const router = Router();
// Bruk middleware på alle ruter
router.use(noCache);
router.use(krevCanvasToken);
router.use(rateLimitCanvas);

// Endpoints
// GET /whoami - Minimal brukerinfo
router.get("/whoami", async (req, res) => {
  try {
    // Bedre validering av req.user
    if (!req.user?.id) {
      return res.status(401).json({ feil: "Ikke autentisert" });
    }
    const { data: canvasUser } = await fetchUserProfile(req.canvasToken);
    // Er denne Canvas-brukeren allerede koblet til en ANNEN lokal bruker?
    const eksisterendeKobling = await CanvasUser.findOne({ canvasId: canvasUser.id });
    // Sikre toString() på begge sider + null-check
    if (
      eksisterendeKobling && 
      eksisterendeKobling.localUser && 
      eksisterendeKobling.localUser.toString() !== req.user.id.toString()
    ) {
      logger.info({    
        userId: req.user.id,
        existingLocalUser: eksisterendeKobling.localUser.toString(),
        canvasId: canvasUser.id
      }, "Forsøk på å koble til en Canvas-konto som allerede tilhører en annen bruker");
      return res.status(409).json({
        feil: "Konflikt",
        melding: "Denne Canvas-kontoen er allerede koblet til en annen StudyWise-bruker."
      });
    }

    // Lagre eller oppdater bruker i vår egen database (kun canvas data, ikke lokal bruker fra vårt eget auth system)
    // OBS: Dette er ren datasynkronisering. Det bekrefter at Canvas-tokenet virker, men logger ikke brukeren inn i VÅRT system.
    const oppdatertCanvasBruker = await CanvasUser.findOneAndUpdate(
      { canvasId: canvasUser.id }, // Finn basert på canvasId
      {
        canvasId: canvasUser.id,
        name: canvasUser.name,
        sortableName: canvasUser.sortable_name,
        shortName: canvasUser.short_name,
        avatarUrl: canvasUser.avatar_url,
        firstName: canvasUser.first_name,
        lastName: canvasUser.last_name,
        locale: canvasUser.locale,
        effectiveLocale: canvasUser.effective_locale,
        permissions: {
          canUpdateName: canvasUser.permissions?.can_update_name,
          canUpdateAvatar: canvasUser.permissions?.can_update_avatar,
          limitParentAppWebAccess: canvasUser.permissions?.limit_parent_app_web_access,
        },
        canvasUserCreatedAt: canvasUser.created_at ? new Date(canvasUser.created_at) : undefined,
        localUser: req.user.id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true } // Opprett hvis ikke finnes
    );
    if (oppdatertCanvasBruker?._id) {
      await User.findByIdAndUpdate(req.user.id, { canvasUser: oppdatertCanvasBruker._id });
    }
    logger.info({ userId: canvasUser.id }, "Canvas /whoami endpoint kalt og bruker synkronisert");
    res.json(canvasUser);
  } catch (error) {
    logger.error({ err: error }, "Klarte ikke å hente eller lagre brukerinformasjon (/whoami)");
    throw error;
  }
});

// GET /users/self/upcoming_events - Kommende hendelser
// Henter kommende hendelser for brukeren
router.get("/users/self/upcoming_events", async (req, res) => {
  try {
    const { data: events, meta } = await fetchUpcomingEvents(req.canvasToken);
    logger.info({ count: events.length }, "Hentet kommende hendelser");
    res.json({
      events,
      meta
    });
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av upcoming_events");
    throw error;
  }
});

// GET /users/self/todo - Todo liste
// Henter todo liste for brukeren
router.get("/users/self/todo", async (req, res) => {
  try {
    const { data: todos, meta } = await fetchTodo(req.canvasToken);
    logger.info({ count: todos.length }, "Hentet todo liste");
    res.json({
      todos,
      meta
    });
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av todo liste");
    throw error;
  }
});

// GET /emner - Hent aktive emner
// Henter alle aktive emner for brukeren
router.get("/emner", async (req, res) => {
  try {
    const { data: courses, meta } = await fetchCourses(req.canvasToken);
    logger.info({ count: courses.length }, "Hentet aktive emner");
    res.json({
      courses,
      meta,
    });
  } catch (error) {
    logger.error({ err: error }, "Feil under henting av emner");
    throw error;
  }
});

// GET /emner/:courseId - Hent emne-detaljer
// Henter detaljer for et spesifikt emne
router.get("/emner/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      return res.status(400).json({
        feil: "Ugyldig courseId",
        melding: "courseId må være et tall",
      });
    }
    const { data: course } = await fetchCourse(req.canvasToken, courseIdNum);
    logger.info({ courseId: course.id, name: course.name }, "Hentet emnedetaljer");
    res.json(course);
  } catch (error) {
    logger.error({ err: error }, `Feil under henting av emne ${req.params.courseId}`);
    throw error;
  }
});

// GET /emner/:courseId/oppgaver - Hent oppgaver
// Henter oppgaver for et spesifikt emne
router.get("/emner/:courseId/oppgaver", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      return res.status(400).json({
        feil: "Ugyldig courseId",
      });
    }
    const { data: assignments, meta } = await fetchAssignments(req.canvasToken, courseIdNum);
    logger.info({ courseId: courseIdNum, count: assignments.length }, "Hentet oppgaver for emne");
    res.json({
      assignments,
      meta,
    });
  } catch (error) {
    logger.error({ err: error }, `Feil under henting av oppgaver for emne ${req.params.courseId}`);
    throw error;
  }
});

// GET /emner/:courseId/announcements - Hent announcements for et emne
// Henter announcements for et spesifikt emne
router.get("/emner/:courseId/announcements", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      return res.status(400).json({
        feil: "Ugyldig courseId",
        melding: "courseId må være et tall",
      });
    }
    const { data: announcements, meta } = await fetchCourseAnnouncements(req.canvasToken, courseIdNum);
    logger.info({ courseId: courseIdNum, count: announcements.length }, "Hentet announcements for emne");
    res.json({
      announcements,
      meta,
    });
  } catch (error) {
    logger.error({ err: error }, `Feil under henting av announcements for emne ${req.params.courseId}`);
    throw error;
  }
});

// GET /announcements - Hent alle announcements fra alle aktive emner
// Henter announcements for alle aktive emner
// Bruker strengere rate limiting fordi dette endepunktet gjør 2 Canvas API-kall
router.get("/announcements", rateLimitCanvasTung, async (req, res) => {
  try {
    const { data: announcements, meta } = await fetchAllAnnouncements(req.canvasToken);
    logger.info({ count: announcements.length }, "Hentet alle announcements");
    res.json({
      announcements,
      meta,
    });
  } catch (error) {
    logger.error({ err: error }, "Feil under henting av annonseringer");
    throw error;
  }
});

// GET /kalender - Aggregert kalender for frontend (assignments + events + todo)
// Tyngre kall -> bruker rateLimitCanvasTung
router.get("/kalender", rateLimitCanvasTung, async (req, res) => {
  try {
    const token = req.canvasToken;
    const tokenAvtrykk = token ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 12) : "ukjent";
    const cacheKey = `canvas:${tokenAvtrykk}:kalender-v1`;

    // Forsøk cache først
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        logger.info({ cacheKey }, "Kalender cache HIT");
        return res.json(JSON.parse(cached));
      }
      logger.info({ cacheKey }, "Kalender cache MISS");
    } catch (cacheErr) {
      logger.warn({ err: cacheErr }, "Kalender cache feilet - fortsetter uten cache");
    }

    const { data: courses } = await fetchCourses(req.canvasToken);
    const courseMap = new Map(courses.map((c) => [c.id, c]));
    // Hent oppgaver per emne i parallell, men ignorerer feil per emne
    const assignmentsPerCourse = await Promise.all(
      courses.map(async (course) => {
        try {
          const { data } = await fetchAssignments(req.canvasToken, course.id);
          return { courseId: course.id, assignments: data };
        } catch (error) {
          logger.warn({ courseId: course.id, err: error }, "Klarte ikke hente oppgaver for kurs i kalender-endepunkt");
          return { courseId: course.id, assignments: [] };
        }
      })
    );
    // Hent kommende hendelser og todo-liste parallelt
    const [eventsResult, todosResult] = await Promise.allSettled([
      fetchUpcomingEvents(req.canvasToken),
      fetchTodo(req.canvasToken),
    ]);
    const events = eventsResult.status === "fulfilled" ? eventsResult.value.data : [];
    const todos = todosResult.status === "fulfilled" ? todosResult.value.data : [];
    if (eventsResult.status === "rejected") {
      logger.warn({ err: eventsResult.reason }, "Kalender: upcoming_events feilet, fortsetter uten events");
    }
    if (todosResult.status === "rejected") {
      logger.warn({ err: todosResult.reason }, "Kalender: todo feilet, fortsetter uten todo");
    }
    // Bygg kalender-items
    const items: CalendarItem[] = [];
    // Normaliser oppgaver (Canvas assignments)
    assignmentsPerCourse.forEach(({ courseId, assignments }) => {
      const course = courseMap.get(courseId);
      assignments.forEach((assignment) => {
        if (!erInnenforKalenderVindu(assignment.due_at)) return;
        items.push({
          id: `assignment-${assignment.id}`,
          title: assignment.name,
          due_at: assignment.due_at!,
          course_id: courseId,
          course_code: course?.course_code,
          course_name: course?.name,
          source: "assignment",
          html_url: assignment.html_url,
          raw_type: "assignment",
        });
      });
    });

    // Normaliser kommende hendelser (Canvas upcoming_events)
    events.forEach((event) => {
      const dueAt = event.start_at || event.end_at;
      if (!erInnenforKalenderVindu(dueAt)) return;
      const courseId = parseCourseIdFromContext(event.context_code);
      const course = courseId ? courseMap.get(courseId) : undefined;
      items.push({
        id: `event-${event.id}`,
        title: event.title || course?.name || "Hendelse",
        due_at: dueAt!,
        course_id: courseId ?? undefined,
        course_code: course?.course_code,
        course_name: course?.name,
        source: "event",
        html_url: event.html_url || event.url,
        raw_type: "calendar_event",
      });
    });

    // Normaliser todo-elementer (ofte assignments/quiz)
    todos.forEach((todo, idx) => {
      const dueAt = todo.assignment?.due_at || todo.quiz?.due_at || null;
      if (!erInnenforKalenderVindu(dueAt)) return;
      const courseId = todo.assignment?.course_id || todo.course_id || null;
      const course = courseId ? courseMap.get(courseId) : undefined;
      const id = todo.assignment?.id ?? todo.quiz?.id ?? idx;
      items.push({
        id: `todo-${id}`,
        title: todo.assignment?.name || todo.quiz?.title || todo.type || "Todo",
        due_at: dueAt!,
        course_id: courseId ?? undefined,
        course_code: course?.course_code,
        course_name: course?.name,
        source: "todo",
        html_url: todo.assignment?.html_url || todo.quiz?.html_url,
        raw_type: todo.type,
      });
    });
    // Sorter etter dato
    items.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());

    const payload = CalendarItemsResponseSchema.parse({
      items,
      meta: {
        generatedAt: new Date().toISOString(),
        courseCount: courses.length,
      },
    });

    // Sett cache (kort TTL siden data er fersk)
    try {
      await setCache(cacheKey, JSON.stringify(payload), CACHE_TTL.TODO);
    } catch (cacheErr) {
      logger.warn({ err: cacheErr }, "Kunne ikke sette kalender-cache");
    }

    logger.info({ itemCount: payload.items.length, courseCount: courses.length }, "Bygget kalender-payload");
    res.json(payload);
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av kalender-data");
    throw error;
  }
});

// GET /planlegger - Hent studentens totale tidslinje (Alt som skjer)
// Henter planlegger items for brukeren innenfor et datointervall
router.get("/planlegger", async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const { data: items, meta } = await fetchPlannerItems(req.canvasToken, {
      start_date: typeof start_date === "string" ? start_date : undefined,
      end_date: typeof end_date === "string" ? end_date : undefined,
    });
    logger.info({ itemCount: Array.isArray(items) ? items.length : 0, range: { start_date, end_date } }, "Hentet planlegger items");
    res.json({
      items,
      meta,
    });
  } catch (error) {
    logger.error({ err: error }, "Feil under henting av planlegger");
    throw error;
  }
});

// GET /emner/:courseId/modules - Hent moduler
// Henter moduler for et spesifikt emne
router.get("/emner/:courseId/modules", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      return res.status(400).json({
        feil: "Ugyldig courseId",
        melding: "courseId må være et tall",
      });
    }
    const { data: modules, meta } = await fetchModules(req.canvasToken, courseIdNum);
    logger.info({ courseId: courseIdNum, moduleCount: modules.length }, "Hentet moduler");
    res.json({
      modules,
      meta,
    });
  } catch (error) {
    logger.error({ err: error }, `Feil under henting av moduler for emne ${req.params.courseId}`);
    throw error;
  }
});

// GET /emner/:courseId/modules/:moduleId/items - Hent modul-items med detaljer
// Henter detaljerte modul-items for en spesifikk modul i et emne
router.get("/emner/:courseId/modules/:moduleId/items", async (req, res) => {
  try {
    const { courseId, moduleId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    const moduleIdNum = parseInt(moduleId, 10);
    if (isNaN(courseIdNum) || isNaN(moduleIdNum)) {
      return res.status(400).json({ feil: "Ugyldig ID" });
    }
    const { data: items, meta } = await fetchModuleItems(req.canvasToken, courseIdNum, moduleIdNum);
    logger.info({ courseId, moduleId, itemCount: items.length }, "Hentet modul items med detaljer");
    res.json({
      items,
      meta
    });

  } catch (error) {
    logger.error({ err: error }, `Feil ved henting av modul items for modul ${req.params.moduleId}`);
    throw error;
  }
});

// GET /emner/:courseId/modules/:moduleId/items/:itemId/open
// Løser Canvas module_item_redirect ved å bruke API-token på serveren og returnere trygg URL (ingen backend-redirect)
// Henter sikker URL for å åpne et modul-item
// Bruker strengere rate limiting fordi dette kan gjøre flere Canvas API-kall
router.get("/emner/:courseId/modules/:moduleId/items/:itemId/open", rateLimitCanvasTung, async (req, res) => {
  try {
    const { courseId, moduleId, itemId } = req.params;
    const courseIdNum = parseInt(String(courseId), 10);
    const moduleIdNum = parseInt(String(moduleId), 10);
    const itemIdNum = parseInt(String(itemId), 10);
    if ([courseIdNum, moduleIdNum, itemIdNum].some((n) => Number.isNaN(n))) {
      return res.status(400).json({ feil: "Ugyldig ID" });
    }
    // Hent detaljene for modul-itemet slik at vi kan finne riktig mål
    const { data: item } = await fetchModuleItem(req.canvasToken, courseIdNum, moduleIdNum, itemIdNum);
    // Sikkerhetsjekk for URL
    const canvasBaseUrl = hentCanvasKonfig().baseUrl;
    if (!canvasBaseUrl) {
      return res.status(500).json({ feil: "Canvas baseUrl ikke konfigurert" });
    }
    const canvasOrigin = new URL(canvasBaseUrl).origin;
    // Route basert på type
    if (item.type === "File" && item.content_id) {
      // Hent fil-metadata for å få en signert, offentlig download URL
      const { data: file } = await fetchFileMetadata(req.canvasToken, item.content_id);

      const safeUrl = validateCanvasRedirectUrl(file.url, canvasOrigin, "/files/");

      if (safeUrl) {
        logger.info({ fileId: file.id, moduleItemId: itemIdNum }, "Returnerer intern downloadPath for fil");
        return res.json({ type: "File", downloadPath: `/api/canvas/filer/${file.id}/download` });
      }
      return res.status(400).json({ feil: "Ugyldig fil-url host" });
    }
    // Håndter andre typer
    if (item.type === "ExternalUrl" && item.external_url) {
      // Ikke redirect til eksterne domener fra backend (open redirect). Frontend åpner lenken direkte.
      return res.json({
        type: "ExternalUrl",
        url: item.external_url,
      });
    }
    if (item.type === "Page" && item.page_url) {
      // For pages håndteres rendring i frontend. Returner info som JSON
      return res.json({
        type: "Page",
        page_url: item.page_url,
        html_url: item.html_url,
      });
    }
    // Ingen annen trygg redirect tilgjengelig
    return res.status(404).json({
      feil: "Ingen tilgjengelig url for modul-elementet",
    });
  } catch (error) {
    logger.error({ err: error }, `Feil ved åpning av modul item ${req.params.itemId}`);
    throw error;
  }
});

// GET /emner/:courseId/pages/:pageId - Hent wiki page innhold
router.get("/emner/:courseId/pages/:pageId", async (req, res) => {
  try {
    const { courseId, pageId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) return res.status(400).json({ feil: "Ugyldig courseId" });
    const { data: page } = await fetchPage(req.canvasToken, courseIdNum, pageId);
    logger.info({ courseId, pageUrl: page.url }, "Hentet wiki page");
    res.json(page);
  } catch (error) {
    logger.error({ err: error }, `Feil ved henting av page ${req.params.pageId}`);
    throw error;
  }
});

// GET /emner/:courseId/pages - Liste alle sider i kurs
router.get("/emner/:courseId/pages", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) return res.status(400).json({ feil: "Ugyldig courseId" });
    const { data: pages, meta } = await fetchPages(req.canvasToken, courseIdNum);
    logger.info({ courseId, count: pages.length }, "Hentet liste over sider");
    res.json({ pages, meta });
  } catch (error) {
    logger.error({ err: error }, `Feil ved henting av pages for kurs ${req.params.courseId}`);
    throw error;
  }
});

// GET /emner/:courseId/frontpage - Hent kurs-frontpage
router.get("/emner/:courseId/frontpage", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) return res.status(400).json({ feil: "Ugyldig courseId" });
    const { data: page, meta } = await fetchFrontPage(req.canvasToken, courseIdNum);
    logger.info({ courseId, pageUrl: page.url }, "Hentet frontpage");
    res.json({ page, meta });
  } catch (error) {
    logger.error({ err: error }, `Feil ved henting av frontpage for kurs ${req.params.courseId}`);
    throw error;
  }
});

// GET /filer/:fileId - Hent fil metadata
router.get("/filer/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileIdNum = parseInt(fileId, 10);
    if (isNaN(fileIdNum)) return res.status(400).json({ feil: "Ugyldig fileId" });
    const { data: file } = await fetchFileMetadata(req.canvasToken, fileIdNum);
    logger.info({ fileId, filename: file.filename }, "Hentet fil metadata");
    res.json(file);
  } catch (error) {
    logger.error({ err: error }, `Feil ved henting av fil ${req.params.fileId}`);
    throw error;
  }
});

// GET /emner/:courseId/files - Hent filer i kurs
router.get("/emner/:courseId/files", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) return res.status(400).json({ feil: "Ugyldig courseId" });
    const { data: files, meta } = await fetchFiles(req.canvasToken, courseIdNum);
    logger.info({ courseId, count: files.length }, "Hentet filer for kurs");
    res.json({ files, meta });
  } catch (error) {
    logger.error({ err: error }, `Feil ved henting av filer for kurs ${req.params.courseId}`);
    throw error;
  }
});

// GET /filer/:fileId/download - Strømming av fil uten redirect (unngår open redirect)
router.get("/filer/:fileId/download", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileIdNum = parseInt(fileId, 10);
    if (isNaN(fileIdNum)) return res.status(400).json({ feil: "Ugyldig fileId" });
    const canvasBaseUrl = hentCanvasKonfig().baseUrl;
    if (!canvasBaseUrl) return res.status(500).json({ feil: "Canvas baseUrl ikke konfigurert" });
    const canvasOrigin = new URL(canvasBaseUrl).origin;
    // Hent metadata for signert fil-url
    const { data: file } = await fetchFileMetadata(req.canvasToken, fileIdNum);
    const safeUrl = validateCanvasRedirectUrl(file.url, canvasOrigin, "/files/");
    if (!safeUrl) return res.status(400).json({ feil: "Ugyldig fil-url host" });
    // Last ned fra Canvas og stream til klient
    const canvasRes = await fetch(safeUrl);
    if (!canvasRes.ok || !canvasRes.body) {
      return res.status(canvasRes.status).json({ feil: "Kunne ikke hente fil fra Canvas" });
    }
    res.setHeader("Content-Type", canvasRes.headers.get("content-type") || "application/octet-stream");
    const disposition = canvasRes.headers.get("content-disposition");
    if (disposition) res.setHeader("Content-Disposition", disposition);
    const nodeStream = Readable.fromWeb(canvasRes.body as unknown as ReadableStream);
    nodeStream.pipe(res);
  } catch (error) {
    logger.error({ err: error }, `Feil ved filnedlasting ${req.params.fileId}`);
    throw error;
  }
});

// GET /emner/:courseId/diskusjoner/:topicId - Hent diskusjon
router.get("/emner/:courseId/diskusjoner/:topicId", async (req, res) => {
  try {
    const { courseId, topicId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    const topicIdNum = parseInt(topicId, 10);
    if (isNaN(courseIdNum) || isNaN(topicIdNum)) {
      return res.status(400).json({ feil: "Ugyldig ID" });
    }
    const { data: topic } = await fetchDiscussionTopic(req.canvasToken, courseIdNum, topicIdNum);
    logger.info({ courseId, topicId, title: topic.title }, "Hentet diskusjon");
    res.json(topic);
  } catch (error) {
    logger.error({ err: error }, `Feil ved henting av diskusjon ${req.params.topicId}`);
    throw error;
  }
});

// Global error handler for dette routeret
router.use((error: Error, _req: unknown, res: unknown, _next: unknown) => {
  logger.error({ err: error }, "Canvas API feil");
  // Global error handler for dette endpointet
  const response = res as { status: (code: number) => { json: (data: unknown) => void } };
  // Zod validering feil
  if (error.name === "ZodError") {
    return response.status(500).json({
      feil: "Validering feilet",
      melding: "Canvas returnerte uventet data-format",
      detaljer: error?.message,
    });
  }
  // Canvas API feil - Sjekk om error har en status-kode
  const canvasError = error as CanvasHttpError;
  const status = typeof canvasError.status === "number" ? canvasError.status : 500;
  const melding = typeof canvasError.details === "string" ? canvasError.details : error.message;
  response.status(status).json({
    feil: status === 401 ? "Ugyldig Canvas-token" : "Canvas API feil",
    melding: melding,
  });
});

export default router;  
