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
import { apiError, sendError, sendUnknownError } from "../../utils/apiError.js";
import {
  krevCanvasToken,
  hentCanvasKonfig,
  validateCanvasRedirectUrl,
  erInnenforKalenderVindu,
  beregnKalenderVindu,
  CACHE_TTL,
} from "./canvasUtils.js";
import {
  rateLimitCanvas,
  rateLimitCanvasTung,
} from "../../middleware/rate-limit.js";
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
  fetchCalendarEvents,
  buildContextCodes,
  buildSectionToCourseMap,
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
  fetchCanvasLectures,
  extractCourseIdFromContext,
  fetchUserEnrollments,
} from "./canvasService.js";
import {
  CalendarItemsResponseSchema,
  type CalendarItem,
} from "common/calendar";

import {
  type CanvasApiError,
  type CanvasErrorCode,
  getErrorResponse,
  getHttpStatusForCode,
  classifyHttpStatus,
} from "./canvasErrors.js";

// Legacy feiltype for bakoverkompatibilitet (brukes i catch-blokker som sjekker .status)
interface CanvasHttpError extends Error {
  status?: number;
  details?: string;
  code?: CanvasErrorCode;
}

// Håndterer Canvas API-feil med strukturert respons via canvasErrors.
function handleCanvasError(
  res: import("express").Response,
  error: unknown,
  kontekst: string,
): void {
  logger.error({ err: error }, kontekst);

  // Strukturert CanvasApiError fra createCanvasError
  const err = error as CanvasApiError;
  if (err.name === "CanvasApiError" && err.code) {
    const status = err.httpStatus ?? getHttpStatusForCode(err.code);
    res.status(status).json(getErrorResponse(err.code));
    return;
  }

  // Legacy: sjekk HTTP-status og klassifiser
  const legacyErr = error as { status?: number };
  if (legacyErr.status && typeof legacyErr.status === "number") {
    const code = classifyHttpStatus(legacyErr.status);
    const status = legacyErr.status;
    res.status(status).json(getErrorResponse(code));
    return;
  }

  sendUnknownError(res, error, { kontekst });
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
      return apiError.unauthorized(res);
    }
    const { data: canvasUser } = await fetchUserProfile(req.canvasToken);
    // Er denne Canvas-brukeren allerede koblet til en ANNEN lokal bruker?
    const eksisterendeKobling = await CanvasUser.findOne({
      canvasId: canvasUser.id,
    });
    // Sikre toString() på begge sider + null-check
    if (
      eksisterendeKobling &&
      eksisterendeKobling.localUser &&
      eksisterendeKobling.localUser.toString() !== req.user.id.toString()
    ) {
      // Canvas-brukeren er koblet til en annen lokal bruker.
      // Løsning: Vi antar at den som har gyldig token nå er eieren.
      // Vi sletter koblingen fra den GAMLE brukeren for å rydde opp.
      logger.warn(
        `Canvas-bruker ${canvasUser.id} var koblet til bruker ${eksisterendeKobling.localUser}. Flytter kobling til ${req.user.id}.`,
      );

      await User.findByIdAndUpdate(eksisterendeKobling.localUser, {
        $unset: { canvasUser: 1 },
      });

      // Vi trenger ikke returnere 409 - koden under vil oppdatere CanvasUser til å peke på req.user.id
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
          limitParentAppWebAccess:
            canvasUser.permissions?.limit_parent_app_web_access,
        },
        canvasUserCreatedAt: canvasUser.created_at
          ? new Date(canvasUser.created_at)
          : undefined,
        localUser: req.user.id,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }, // Opprett hvis ikke finnes
    );
    if (oppdatertCanvasBruker?._id) {
      await User.findByIdAndUpdate(req.user.id, {
        canvasUser: oppdatertCanvasBruker._id,
      });
    }
    logger.info("Canvas bruker synkronisert");
    // Returner Canvas-data med created_at
    // Prioritet: Canvas sin dato > vår lagrede Canvas-dato > når brukeren koblet til StudyWise
    const createdAt =
      canvasUser.created_at ||
      oppdatertCanvasBruker?.canvasUserCreatedAt?.toISOString() ||
      (
        oppdatertCanvasBruker as unknown as { createdAt?: Date }
      )?.createdAt?.toISOString();
    res.json({
      ...canvasUser,
      created_at: createdAt,
    });
  } catch (error) {
    logger.error(
      { err: error },
      "Klarte ikke å hente eller lagre brukerinformasjon (/whoami)",
    );
    sendUnknownError(res, error, { kontekst: "GET /whoami" });
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
      meta,
    });
  } catch (error) {
    handleCanvasError(res, error, "Feil ved henting av upcoming_events");
  }
});
// GET /calendar_events - Hent kalenderhendelser med context_codes
// Bruker Canvas Calendar Events API for å hente brukerens og kursenes hendelser
// Query params:
// - start_date: Startdato (YYYY-MM-DD) - standard: 1 mnd tilbake
// - end_date: Sluttdato (YYYY-MM-DD) - standard: 6 mnd frem
// - type: "event" eller "assignment" (valgfritt, begge hvis ikke satt)
router.get("/calendar_events", rateLimitCanvasTung, async (req, res) => {
  try {
    const { start_date, end_date, type } = req.query;
    // Hent brukerens kurs for å bygge context_codes
    const { data: courses } = await fetchCourses(req.canvasToken);
    const { data: userProfile } = await fetchUserProfile(req.canvasToken);
    // Bygg context_codes (bruker + alle kurs)
    const contextCodes = buildContextCodes(userProfile.id, courses);
    // Standard datointervall (bruker samme vindu som kalender-endepunktet)
    const defaultRange = beregnKalenderVindu();
    // Valider type-parameter
    let eventType: "event" | "assignment" | undefined;
    if (type === "event" || type === "assignment") {
      eventType = type;
    }
    const { data: events, meta } = await fetchCalendarEvents(req.canvasToken, {
      contextCodes,
      startDate:
        typeof start_date === "string" ? start_date : defaultRange.startDate,
      endDate: typeof end_date === "string" ? end_date : defaultRange.endDate,
      type: eventType,
    });
    logger.info(
      { count: events.length, courseCount: courses.length },
      "Hentet calendar_events",
    );
    res.json({
      events,
      meta,
      context: { courseCount: courses.length },
    });
  } catch (error) {
    handleCanvasError(res, error, "Feil ved henting av calendar_events");
  }
});

// GET /forelesninger - Normaliserte forelesninger fra Canvas Calendar Events
// Bruker utvidet datovindu (3 mnd tilbake, 12 mnd frem) for TimeEdit-events
router.get("/forelesninger", rateLimitCanvasTung, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const { data: lectures, meta } = await fetchCanvasLectures(
      req.canvasToken,
      {
        startDate: typeof start_date === "string" ? start_date : undefined,
        endDate: typeof end_date === "string" ? end_date : undefined,
      },
    );
    res.json({
      items: lectures,
      meta: { generatedAt: new Date().toISOString(), ...meta },
    });
  } catch (error) {
    handleCanvasError(res, error, "Feil ved henting av forelesninger");
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
      meta,
    });
  } catch (error) {
    handleCanvasError(res, error, "Feil ved henting av todo liste");
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
    handleCanvasError(res, error, "Feil under henting av emner");
  }
});

// GET /emner/metadata - Hent innholds-metadata for alle emner
// Returnerer info om hvilke emner som har forside, moduler, filer etc.
// Brukes for å vise/skjule knapper i frontend dynamisk
router.get("/emner/metadata", rateLimitCanvasTung, async (req, res) => {
  const token = req.canvasToken;
  const tokenAvtrykk = token
    ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 12)
    : "ukjent";
  const cacheKey = `canvas:${tokenAvtrykk}:emner-metadata`;

  try {
    // Sjekk om force refresh er satt
    const forceRefresh = req.query.refresh === "true";

    // Sjekk cache først (med mindre force refresh)
    if (!forceRefresh) {
      const cached = await getCache(cacheKey);
      if (cached) {
        logger.info({ cacheKey }, "Emner metadata cache HIT");
        return res.json(JSON.parse(cached));
      }
    } else {
      logger.info({ cacheKey }, "Emner metadata force refresh");
    }

    // Hent alle emner
    const { data: courses } = await fetchCourses(req.canvasToken);

    // Avbryt tidlig hvis klienten har koblet fra
    if (req.socket.destroyed) return;

    // Begrens parallelle kall for å unngå rate limiting
    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(5);

    // Hent all metadata for hvert kurs parallelt (én fase i stedet for to)
    const metadataPromises = courses.map((course) =>
      limit(async () => {
        const courseId = course.id;

        // Hopp over hvis klienten har koblet fra
        if (req.socket.destroyed) {
          return {
            courseId,
            hasFrontPage: false,
            hasModules: false,
            hasFiles: false,
            modulesCount: 0,
            filesCount: 0,
          };
        }

        // Hent alle 4 ressurser parallelt per kurs
        const [
          courseDetailsResult,
          frontPageResult,
          modulesResult,
          filesResult,
        ] = await Promise.allSettled([
          fetchCourse(req.canvasToken, courseId),
          fetchFrontPage(req.canvasToken, courseId),
          fetchModules(req.canvasToken, courseId),
          fetchFiles(req.canvasToken, courseId),
        ]);

        // Sjekk kursdetaljer for syllabus
        const courseDetails =
          courseDetailsResult.status === "fulfilled"
            ? courseDetailsResult.value.data
            : null;

        // Sjekk frontpage - kun true hvis det finnes faktisk innhold å vise
        let wikiHasContent = false;
        if (
          frontPageResult.status === "fulfilled" &&
          frontPageResult.value.data
        ) {
          const page = frontPageResult.value.data;
          wikiHasContent = !!(page.body && page.body.trim().length > 0);
        }

        // Sjekk syllabus
        const syllabusHasContent = !!(
          courseDetails?.syllabus_body &&
          courseDetails.syllabus_body.trim().length > 0
        );

        // Hent moduler og filer
        const modules =
          modulesResult.status === "fulfilled" ? modulesResult.value.data : [];
        const files =
          filesResult.status === "fulfilled" ? filesResult.value.data : [];

        return {
          courseId,
          hasFrontPage: wikiHasContent || syllabusHasContent,
          hasModules: modules.length > 0,
          hasFiles: files.length > 0,
          modulesCount: modules.length,
          filesCount: files.length,
        };
      }),
    );

    const metadataResults = await Promise.all(metadataPromises);

    // Bygg respons som map for enkel oppslag
    const metadataMap: Record<
      number,
      {
        hasFrontPage: boolean;
        hasModules: boolean;
        hasFiles: boolean;
        modulesCount: number;
        filesCount: number;
      }
    > = {};

    metadataResults.forEach((m) => {
      metadataMap[m.courseId] = {
        hasFrontPage: m.hasFrontPage,
        hasModules: m.hasModules,
        hasFiles: m.hasFiles,
        modulesCount: m.modulesCount,
        filesCount: m.filesCount,
      };
    });

    const response = {
      metadata: metadataMap,
      courseCount: courses.length,
      generatedAt: new Date().toISOString(),
    };

    // Cache i 30 minutter
    await setCache(cacheKey, JSON.stringify(response), CACHE_TTL.MODULES);

    logger.info({ courseCount: courses.length }, "Generert emner metadata");
    res.json(response);
  } catch (error) {
    handleCanvasError(res, error, "Feil ved henting av emner metadata");
  }
});

// GET /emner/:courseId - Hent emne-detaljer
// Henter detaljer for et spesifikt emne
router.get("/emner/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      return apiError.badRequest(
        res,
        "Ugyldig courseId",
        "courseId må være et tall",
      );
    }
    const { data: course } = await fetchCourse(req.canvasToken, courseIdNum);
    logger.info({ courseId: course.id }, "Hentet emnedetaljer");
    res.json(course);
  } catch (error) {
    logger.error(
      { err: error },
      `Feil under henting av emne ${req.params.courseId}`,
    );
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
      return apiError.badRequest(res, "Ugyldig courseId");
    }
    const { data: assignments, meta } = await fetchAssignments(
      req.canvasToken,
      courseIdNum,
    );
    logger.info(
      { courseId: courseIdNum, count: assignments.length },
      "Hentet oppgaver for emne",
    );
    res.json({
      assignments,
      meta,
    });
  } catch (error) {
    logger.error(
      { err: error },
      `Feil under henting av oppgaver for emne ${req.params.courseId}`,
    );
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
      return apiError.badRequest(
        res,
        "Ugyldig courseId",
        "courseId må være et tall",
      );
    }
    const { data: announcements, meta } = await fetchCourseAnnouncements(
      req.canvasToken,
      courseIdNum,
    );
    logger.info(
      { courseId: courseIdNum, count: announcements.length },
      "Hentet announcements for emne",
    );
    res.json({
      announcements,
      meta,
    });
  } catch (error) {
    logger.error(
      { err: error },
      `Feil under henting av announcements for emne ${req.params.courseId}`,
    );
    throw error;
  }
});

// GET /announcements - Hent alle announcements fra alle aktive emner
// Henter announcements for alle aktive emner
// Bruker strengere rate limiting fordi dette endepunktet gjør 2 Canvas API-kall
router.get("/announcements", rateLimitCanvasTung, async (req, res) => {
  try {
    const { data: announcements, meta } = await fetchAllAnnouncements(
      req.canvasToken,
    );
    logger.info({ count: announcements.length }, "Hentet alle announcements");
    res.json({
      announcements,
      meta,
    });
  } catch (error) {
    handleCanvasError(res, error, "Feil under henting av annonseringer");
  }
});

// GET /kalender - Aggregert kalender for frontend (planner + calendar_events)
// : Bruker Planner API i stedet for per-kurs assignment-henting
// Dette reduserer API-kall fra N+3 til ~4 (uansett antall kurs)
// Query params:
//   - refresh=true: Bypass cache og hent ferske data
//   - page=1: Sidenummer for paginering (default: 1)
//   - limit=100: Antall items per side (default: 100, max: 500)
router.get("/kalender", rateLimitCanvasTung, async (req, res) => {
  const token = req.canvasToken;
  const tokenAvtrykk = token
    ? crypto.createHash("sha256").update(token).digest("hex").slice(0, 12)
    : "ukjent";
  const cacheKey = `canvas:${tokenAvtrykk}:kalender-v3`; // Ny versjon med Planner API
  const cacheTimestampKey = `${cacheKey}:timestamp`;
  // Parse query params
  const forceRefresh = req.query.refresh === "true";
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(
    500,
    Math.max(1, parseInt(req.query.limit as string, 10) || 100),
  );
  // Hjelpefunksjon for å returnere cached data ved feil
  const returnCachedOnError = async (error: unknown) => {
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        const cachedTimestamp = await getCache(cacheTimestampKey);
        const cacheAge = cachedTimestamp
          ? Math.floor((Date.now() - parseInt(cachedTimestamp, 10)) / 1000)
          : undefined;
        logger.warn(
          { cacheAge },
          "Canvas API feilet - returnerer cached data som fallback",
        );
        const parsed = JSON.parse(cached);
        // Legg til cache-metadata
        parsed.meta = { ...parsed.meta, fromCache: true, cacheAge };
        return res.json(parsed);
      }
    } catch {
      // Cache også feilet - kast original feil
    }
    throw error;
  };
  try {
    // Sjekk cache først (med mindre force-refresh er satt)
    if (!forceRefresh) {
      try {
        const cached = await getCache(cacheKey);
        if (cached) {
          const cachedTimestamp = await getCache(cacheTimestampKey);
          const cacheAge = cachedTimestamp
            ? Math.floor((Date.now() - parseInt(cachedTimestamp, 10)) / 1000)
            : undefined;
          logger.info({ cacheKey, cacheAge }, "Kalender cache HIT");
          const parsed = JSON.parse(cached);
          // Legg til cache-metadata og paginer
          const allItems: CalendarItem[] = parsed.items || [];
          const paginatedItems = allItems.slice(
            (page - 1) * limit,
            page * limit,
          );
          return res.json({
            ...parsed,
            items: paginatedItems,
            meta: {
              ...parsed.meta,
              fromCache: true,
              cacheAge,
              pagination: {
                page,
                limit,
                totalItems: allItems.length,
                totalPages: Math.ceil(allItems.length / limit),
                hasNextPage: page * limit < allItems.length,
                hasPrevPage: page > 1,
              },
            },
          });
        }
        logger.info({ cacheKey }, "Kalender cache MISS");
      } catch (cacheErr) {
        logger.warn({ err: cacheErr }, "Kalender cache lesing feilet");
      }
    } else {
      logger.info({ cacheKey }, "Force refresh - skipper cache");
    }
    // Avbryt tidlig hvis klienten har koblet fra
    if (req.socket.destroyed) return;

    // Hent kurs, brukerprofil og enrollments (trengs for context_codes og kursinfo)
    // Enrollments inkluderer section_id som trengs for TimeEdit-hendelser
    const [coursesResult, userProfileResult, enrollmentsResult] =
      (await Promise.all([
        fetchCourses(req.canvasToken),
        fetchUserProfile(req.canvasToken),
        fetchUserEnrollments(req.canvasToken),
      ]).catch(async (error) => {
        // Kritisk feil - prøv cached data
        return returnCachedOnError(error);
      })) as [
        Awaited<ReturnType<typeof fetchCourses>>,
        Awaited<ReturnType<typeof fetchUserProfile>>,
        Awaited<ReturnType<typeof fetchUserEnrollments>>,
      ];

    // Avbryt hvis klienten har koblet fra etter data-henting
    if (req.socket.destroyed) return;

    const courses = coursesResult.data;
    const userProfile = userProfileResult.data;
    const enrollments = enrollmentsResult.data;
    const courseMap = new Map(courses.map((c) => [c.id, c]));

    // Bygg section-to-course mapping fra enrollments
    // Brukes for å resolve course_section_XXX til course_id for TimeEdit-hendelser
    const sectionToCourseMap = buildSectionToCourseMap(enrollments);

    // Bygg context_codes for Calendar Events API
    // Inkluderer course_section context codes for TimeEdit-hendelser
    const contextCodes = buildContextCodes(
      userProfile.id,
      courses,
      enrollments,
    );
    // Beregn datointervall
    const { startDate, endDate } = beregnKalenderVindu();
    // Bruk Planner API + Calendar Events i stedet for N assignment-kall
    // Dette er maks 4-5 API-kall uansett hvor mange kurs brukeren har
    const [plannerResult, calendarEventsResult] = await Promise.allSettled([
      fetchPlannerItems(req.canvasToken, {
        start_date: startDate,
        end_date: endDate,
        maxPages: 5,
      }),
      fetchCalendarEvents(req.canvasToken, {
        contextCodes,
        startDate,
        endDate,
      }),
    ]);
    // Hent data fra resolved promises eller tomme lister ved feil
    const plannerItems =
      plannerResult.status === "fulfilled" ? plannerResult.value.data : [];
    const calendarEvents =
      calendarEventsResult.status === "fulfilled"
        ? calendarEventsResult.value.data
        : [];
    if (plannerResult.status === "rejected") {
      logger.warn(
        { err: plannerResult.reason },
        "Kalender: planner feilet, fortsetter uten",
      );
    }
    if (calendarEventsResult.status === "rejected") {
      logger.warn(
        { err: calendarEventsResult.reason },
        "Kalender: calendar_events feilet, fortsetter uten",
      );
    }
    // Hvis begge API-kall feilet, prøv cached data
    if (
      plannerResult.status === "rejected" &&
      calendarEventsResult.status === "rejected"
    ) {
      const error = plannerResult.reason || calendarEventsResult.reason;
      return returnCachedOnError(error);
    }
    // Bygg kalender-items med deduplication
    const seenIds = new Set<string>();
    const items: CalendarItem[] = [];
    // Hjelpefunksjon for å legge til unike items
    const addUniqueItem = (item: CalendarItem) => {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        items.push(item);
      }
    };

    // Bygg set av calendar_event IDer for å sjekke duplikater
    const calendarEventIds = new Set(calendarEvents.map((e) => e.id));

    // Normaliser Planner items (assignments, quizzes, discussions, etc.)
    // Filtrer ut kunngjøringer og wiki-sider som ikke hører hjemme i kalenderen
    const EXCLUDED_PLANNER_TYPES = [
      "announcement",
      "Announcement",
      "wiki_page",
      "WikiPage",
    ];

    plannerItems
      .filter(
        (item) => !EXCLUDED_PLANNER_TYPES.includes(item.plannable_type || ""),
      )
      .forEach((item) => {
        const dueAt = item.plannable?.due_at || item.plannable_date;
        if (!erInnenforKalenderVindu(dueAt)) return;
        // Hent kursinfo
        const courseId = item.course_id;
        const course = courseId ? courseMap.get(courseId) : undefined;

        // Bestem ID-prefiks og source basert på type
        let id: string;
        let source: "assignment" | "todo" | "event" = "assignment";
        if (
          item.plannable_type === "assignment" ||
          item.plannable_type === "Assignment"
        ) {
          id = `assignment-${item.plannable_id}`;
        } else if (
          item.plannable_type === "quiz" ||
          item.plannable_type === "Quiz"
        ) {
          id = `quiz-${item.plannable_id}`;
          source = "todo";
        } else if (
          item.plannable_type === "discussion_topic" ||
          item.plannable_type === "DiscussionTopic"
        ) {
          id = `discussion-${item.plannable_id}`;
          source = "todo";
        } else if (
          item.plannable_type === "calendar_event" ||
          item.plannable_type === "CalendarEvent"
        ) {
          // Calendar events fra planner - inkluder KUN hvis de IKKE finnes i calendar_events API
          // TimeEdit-events kommer ofte kun via Planner, ikke via Calendar Events API
          if (calendarEventIds.has(item.plannable_id)) {
            // Finnes allerede i calendar_events, hopp over for å unngå duplikat
            return;
          }
          // Ikke i calendar_events - inkluder fra planner
          id = `event-${item.plannable_id}`;
          source = "event";
        } else {
          id = `planner-${item.plannable_id}`;
          source = "todo";
        }
        // Legg til item hvis unikt
        // For calendar_events fra planner, inkluder end_at og location
        const isCalendarEvent = source === "event";
        addUniqueItem({
          id,
          title: item.plannable?.title || "Ukjent",
          due_at: dueAt!,
          end_at: isCalendarEvent ? item.plannable?.end_at : undefined,
          course_id: courseId ?? undefined,
          course_code: course?.course_code,
          course_name: course?.name,
          source,
          html_url: item.html_url,
          raw_type: item.plannable_type,
          location: isCalendarEvent ? item.plannable?.location_name : undefined,
        });
      });

    // Normaliser calendar_events (forelesninger, møter, etc.)
    // Filtrer bort hidden parent-events (de har children som vises separat)
    const visibleEvents = calendarEvents.filter((e) => e.hidden !== true);

    visibleEvents.forEach((event) => {
      const dueAt = event.start_at || event.end_at || event.all_day_date;
      if (!erInnenforKalenderVindu(dueAt)) return;
      // Hent kursinfo fra context_codes - bruker sectionToCourseMap for TimeEdit-events
      const courseIdStr = extractCourseIdFromContext(
        event.context_code,
        event.effective_context_code,
        event.all_context_codes,
        sectionToCourseMap,
      );
      const courseId = courseIdStr ? parseInt(courseIdStr, 10) : null;
      const course = courseId ? courseMap.get(courseId) : undefined;

      // Assignment-events dedupliseres med planner
      if (event.assignment) {
        addUniqueItem({
          id: `assignment-${event.assignment.id}`,
          title: event.assignment.name,
          due_at: event.assignment.due_at || dueAt!,
          course_id: courseId ?? undefined,
          course_code: course?.course_code,
          course_name: course?.name,
          source: "assignment",
          html_url: event.assignment.html_url || event.html_url,
          raw_type: "assignment",
        });
      } else {
        addUniqueItem({
          id: `event-${event.id}`,
          title: event.title || course?.name || "Hendelse",
          due_at: dueAt!,
          end_at: event.end_at,
          course_id: courseId ?? undefined,
          course_code: course?.course_code,
          course_name: course?.name,
          source: "event",
          html_url: event.html_url || event.url,
          raw_type: event.all_day ? "all_day_event" : "calendar_event",
          location: event.location_name,
        });
      }
    });

    // Sorter etter dato
    items.sort(
      (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
    );

    // Paginer resultatene
    const totalItems = items.length;
    const paginatedItems = items.slice((page - 1) * limit, page * limit);
    // Bygg respons-payload
    const payload = CalendarItemsResponseSchema.parse({
      items: paginatedItems,
      meta: {
        generatedAt: new Date().toISOString(),
        courseCount: courses.length,
        fromCache: false,
        pagination: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit),
          hasNextPage: page * limit < totalItems,
          hasPrevPage: page > 1,
        },
      },
    });

    // Lagre komplett liste i cache (uten paginering)
    try {
      const cachePayload = { ...payload, items }; // Lagre alle items
      await setCache(
        cacheKey,
        JSON.stringify(cachePayload),
        CACHE_TTL.ASSIGNMENTS,
      ); // 10 min cache
      await setCache(
        cacheTimestampKey,
        String(Date.now()),
        CACHE_TTL.ASSIGNMENTS,
      );
    } catch (cacheErr) {
      logger.warn({ err: cacheErr }, "Kunne ikke sette kalender-cache");
    }
    // Tell source-typer for debugging
    const sourceCounts = items.reduce(
      (acc, item) => {
        acc[item.source] = (acc[item.source] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Logg statistikk
    logger.info(
      {
        itemCount: totalItems,
        pageItems: paginatedItems.length,
        page,
        courseCount: courses.length,
        plannerItems: plannerItems.length,
        calendarEvents: calendarEvents.length,
        sourceCounts, // Viser fordeling av source-typer (assignment, event, todo)
      },
      "Bygget kalender-payload (Planner API)",
    );
    // Returner paginerte data
    res.json(payload);
  } catch (error) {
    const err = error as CanvasHttpError;
    if (err.message?.includes("timeout")) {
      logger.error({ err: error }, "Feil ved henting av kalender-data");
      return apiError.timeout(
        res,
        "Henting av kalenderdata tok for lang tid. Prøv igjen.",
      );
    }
    handleCanvasError(res, error, "Feil ved henting av kalender-data");
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
    logger.info(
      {
        itemCount: Array.isArray(items) ? items.length : 0,
        range: { start_date, end_date },
      },
      "Hentet planlegger items",
    );
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
      return apiError.badRequest(
        res,
        "Ugyldig courseId",
        "courseId må være et tall",
      );
    }
    const { data: modules, meta } = await fetchModules(
      req.canvasToken,
      courseIdNum,
    );
    logger.info(
      { courseId: courseIdNum, moduleCount: modules.length },
      "Hentet moduler",
    );
    res.json({
      modules,
      meta,
    });
  } catch (error) {
    logger.error(
      { err: error },
      `Feil under henting av moduler for emne ${req.params.courseId}`,
    );
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
      return apiError.badRequest(res, "Ugyldig ID");
    }
    const { data: items, meta } = await fetchModuleItems(
      req.canvasToken,
      courseIdNum,
      moduleIdNum,
    );
    logger.info(
      { courseId, moduleId, itemCount: items.length },
      "Hentet modul items med detaljer",
    );
    res.json({
      items,
      meta,
    });
  } catch (error) {
    logger.error(
      { err: error },
      `Feil ved henting av modul items for modul ${req.params.moduleId}`,
    );
    throw error;
  }
});

// GET /emner/:courseId/modules/:moduleId/items/:itemId/open
// Løser Canvas module_item_redirect ved å bruke API-token på serveren og returnere trygg URL (ingen backend-redirect)
// Henter sikker URL for å åpne et modul-item
// Bruker strengere rate limiting fordi dette kan gjøre flere Canvas API-kall
router.get(
  "/emner/:courseId/modules/:moduleId/items/:itemId/open",
  rateLimitCanvasTung,
  async (req, res) => {
    try {
      const { courseId, moduleId, itemId } = req.params;
      const courseIdNum = parseInt(String(courseId), 10);
      const moduleIdNum = parseInt(String(moduleId), 10);
      const itemIdNum = parseInt(String(itemId), 10);
      if ([courseIdNum, moduleIdNum, itemIdNum].some((n) => Number.isNaN(n))) {
        return apiError.badRequest(res, "Ugyldig ID");
      }
      // Hent detaljene for modul-itemet slik at vi kan finne riktig mål
      const { data: item } = await fetchModuleItem(
        req.canvasToken,
        courseIdNum,
        moduleIdNum,
        itemIdNum,
      );
      // Sikkerhetsjekk for URL
      const canvasBaseUrl = hentCanvasKonfig().baseUrl;
      if (!canvasBaseUrl) {
        return sendError(res, "server_error", {
          melding: "Canvas baseUrl ikke konfigurert",
        });
      }
      const canvasOrigin = new URL(canvasBaseUrl).origin;
      // Route basert på type
      if (item.type === "File" && item.content_id) {
        // Hent fil-metadata for å få en signert, offentlig download URL
        const { data: file } = await fetchFileMetadata(
          req.canvasToken,
          item.content_id,
        );

        const safeUrl = validateCanvasRedirectUrl(
          file.url,
          canvasOrigin,
          "/files/",
        );

        if (safeUrl) {
          logger.info(
            { fileId: file.id, moduleItemId: itemIdNum },
            "Returnerer intern downloadPath for fil",
          );
          return res.json({
            type: "File",
            downloadPath: `/api/canvas/filer/${file.id}/download`,
          });
        }
        return apiError.badRequest(res, "Ugyldig fil-url host");
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
      return apiError.notFound(
        res,
        "Ingen tilgjengelig url for modul-elementet",
      );
    } catch (error) {
      logger.error(
        { err: error },
        `Feil ved åpning av modul item ${req.params.itemId}`,
      );
      throw error;
    }
  },
);

// GET /emner/:courseId/pages/:pageId - Hent wiki page innhold
router.get("/emner/:courseId/pages/:pageId", async (req, res) => {
  try {
    const { courseId, pageId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) return apiError.badRequest(res, "Ugyldig courseId");
    const { data: page } = await fetchPage(
      req.canvasToken,
      courseIdNum,
      pageId,
    );
    logger.info({ courseId, pageUrl: page.url }, "Hentet wiki page");
    res.json(page);
  } catch (error) {
    logger.error(
      { err: error },
      `Feil ved henting av page ${req.params.pageId}`,
    );
    throw error;
  }
});

// GET /emner/:courseId/pages - Liste alle sider i kurs
router.get("/emner/:courseId/pages", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) return apiError.badRequest(res, "Ugyldig courseId");
    const { data: pages, meta } = await fetchPages(
      req.canvasToken,
      courseIdNum,
    );
    logger.info({ courseId, count: pages.length }, "Hentet liste over sider");
    res.json({ pages, meta });
  } catch (error) {
    logger.error(
      { err: error },
      `Feil ved henting av pages for kurs ${req.params.courseId}`,
    );
    throw error;
  }
});

// GET /emner/:courseId/frontpage - Hent kurs-frontpage
// Returnerer 204 No Content hvis kurset ikke har noen forside-innhold
// Prøver først front_page wiki, deretter syllabus_body som fallback
router.get("/emner/:courseId/frontpage", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) return apiError.badRequest(res, "Ugyldig courseId");
    const { data: page, meta } = await fetchFrontPage(
      req.canvasToken,
      courseIdNum,
    );
    logger.info({ courseId, pageUrl: page.url }, "Hentet frontpage");
    res.json({ page, meta });
  } catch (error) {
    // Canvas returnerer 404/resource_not_found når et kurs ikke har en satt frontpage
    // Prøv syllabus som fallback
    const err = error as CanvasHttpError & { code?: CanvasErrorCode };
    const isNotFound =
      err.status === 404 ||
      err.code === "resource_not_found" ||
      err.code === "resource_disabled";

    if (isNotFound) {
      try {
        // Hent kurs med syllabus_body som fallback
        const { data: course } = await fetchCourse(
          req.canvasToken,
          parseInt(req.params.courseId, 10),
        );
        if (course.syllabus_body && course.syllabus_body.trim().length > 0) {
          logger.info(
            { courseId: req.params.courseId },
            "Bruker syllabus som fallback for frontpage",
          );
          // Returner syllabus som en "side" for kompatibilitet med frontend
          res.json({
            page: {
              url: "syllabus",
              title: "Kursplan",
              body: course.syllabus_body,
            },
            source: "syllabus", // Markerer at dette er fra syllabus
          });
          return;
        }
        logger.info(
          { courseId: req.params.courseId },
          "Kurset har ingen frontpage eller syllabus",
        );
        return res.status(204).send();
      } catch {
        // Hvis syllabus-henting også feiler, returner 204
        logger.info(
          { courseId: req.params.courseId },
          "Kurset har ingen frontpage satt",
        );
        return res.status(204).send();
      }
    }
    logger.error(
      { err: error },
      `Feil ved henting av frontpage for kurs ${req.params.courseId}`,
    );
    throw error;
  }
});

// GET /filer/:fileId - Hent fil metadata
router.get("/filer/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileIdNum = parseInt(fileId, 10);
    if (isNaN(fileIdNum)) return apiError.badRequest(res, "Ugyldig fileId");
    const { data: file } = await fetchFileMetadata(req.canvasToken, fileIdNum);
    logger.info({ fileId }, "Hentet fil metadata");
    res.json(file);
  } catch (error) {
    logger.error(
      { err: error },
      `Feil ved henting av fil ${req.params.fileId}`,
    );
    throw error;
  }
});

// GET /emner/:courseId/files - Hent filer i kurs
router.get("/emner/:courseId/files", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) return apiError.badRequest(res, "Ugyldig courseId");
    const { data: files, meta } = await fetchFiles(
      req.canvasToken,
      courseIdNum,
    );
    logger.info({ courseId, count: files.length }, "Hentet filer for kurs");
    res.json({ files, meta });
  } catch (error) {
    logger.error(
      { err: error },
      `Feil ved henting av filer for kurs ${req.params.courseId}`,
    );
    throw error;
  }
});

// GET /filer/:fileId/download - Strømming av fil uten redirect (unngår open redirect)
router.get("/filer/:fileId/download", async (req, res) => {
  try {
    const { fileId } = req.params;
    const fileIdNum = parseInt(fileId, 10);
    if (isNaN(fileIdNum)) return apiError.badRequest(res, "Ugyldig fileId");
    const canvasBaseUrl = hentCanvasKonfig().baseUrl;
    if (!canvasBaseUrl)
      return sendError(res, "server_error", {
        melding: "Canvas baseUrl ikke konfigurert",
      });
    const canvasOrigin = new URL(canvasBaseUrl).origin;
    // Hent metadata for signert fil-url
    const { data: file } = await fetchFileMetadata(req.canvasToken, fileIdNum);
    const safeUrl = validateCanvasRedirectUrl(
      file.url,
      canvasOrigin,
      "/files/",
    );
    if (!safeUrl) return apiError.badRequest(res, "Ugyldig fil-url host");
    // Last ned fra Canvas og stream til klient
    const canvasRes = await fetch(safeUrl);
    if (!canvasRes.ok || !canvasRes.body) {
      return res
        .status(canvasRes.status)
        .json({ feil: "Kunne ikke hente fil fra Canvas" });
    }
    res.setHeader(
      "Content-Type",
      canvasRes.headers.get("content-type") || "application/octet-stream",
    );
    const disposition = canvasRes.headers.get("content-disposition");
    if (disposition) res.setHeader("Content-Disposition", disposition);
    const nodeStream = Readable.fromWeb(
      canvasRes.body as unknown as ReadableStream,
    );
    nodeStream.on("error", (err) => {
      logger.error(
        { err, fileId: req.params.fileId },
        "Feil under fil-streaming fra Canvas",
      );
      if (!res.headersSent) {
        res.status(502).json({ feil: "Fil-streaming fra Canvas feilet" });
      }
    });
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
      return apiError.badRequest(res, "Ugyldig ID");
    }
    const { data: topic } = await fetchDiscussionTopic(
      req.canvasToken,
      courseIdNum,
      topicIdNum,
    );
    logger.info({ courseId, topicId }, "Hentet diskusjon");
    res.json(topic);
  } catch (error) {
    logger.error(
      { err: error },
      `Feil ved henting av diskusjon ${req.params.topicId}`,
    );
    throw error;
  }
});

// Global error handler for dette routeret
router.use((error: Error, _req: unknown, res: unknown, _next: unknown) => {
  const response = res as {
    status: (code: number) => { json: (data: unknown) => void };
  };

  // Zod validering feil
  if (error.name === "ZodError") {
    logger.error({ err: error }, "Canvas Zod validering feilet");
    return response.status(500).json({
      feil: "Validering feilet",
      melding: "Canvas returnerte uventet data-format",
      kode: "validation_error" as CanvasErrorCode,
      detaljer: error?.message,
    });
  }

  // Strukturert Canvas API-feil (fra canvasErrors.ts)
  const canvasError = error as CanvasApiError | CanvasHttpError;
  const httpStatus =
    (canvasError as CanvasHttpError).status ??
    (canvasError as CanvasApiError).httpStatus ??
    500;
  const errorCode: CanvasErrorCode =
    (canvasError as CanvasApiError).code ||
    classifyHttpStatus(httpStatus, canvasError.details || error.message);

  // Logg strukturert feilinfo (uten sensitiv data)
  logger.error(
    {
      errorCode,
      httpStatus,
      errorName: error.name,
      // Ikke logg full details da den kan inneholde sensitiv data
    },
    `Canvas API feil: ${errorCode}`,
  );

  // Returner strukturert feilrespons UTEN interne detaljer (sikkerhet)
  // Detaljer kan inneholde sensitiv info fra Canvas API-responser
  const errorResponse = getErrorResponse(errorCode);
  return response.status(httpStatus).json(errorResponse);
});

export default router;
