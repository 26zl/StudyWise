/*
* Canvas API router
* Må bruke engelske navn på variabler og funksjoner for å samsvare med Canvas API dokumentasjon.
* Prøver å bruke norske variabler og kommentarer der det gir mening.
* Arver typer og schemaer fra common/canvas for konsistens.
* VIKTIG OM BRUKERE:
* Når vi henter `/whoami` her, henter vi data FRA Canvas.
* Vi lagrer dette som en `CanvasUser` i databasen.
* Dette er IKKE det samme som innlogging (Auth).
* Fremtidig Kobling:
* Når Auth er på plass, vil `CanvasUser` (canvas brukeren din) ha en referanse til `User` (innloggingsbrukeren din).
* Da vet vi at "Ola Nordmann fra Canvas" = "ola@exmaple.com som logget inn".
*/
import { Router } from "express";
import { z } from "zod";
import { canvasFetch, requireCanvasToken } from "./canvasUtils.js";
import { logger } from "../../utils/logger.js";
import { CanvasUser } from "../../database/models/CanvasUser.js";
import {
  CanvasUserSchema,
  CanvasCourseSchema,
  CanvasAssignmentSchema,
  CanvasAnnouncementSchema,
  CanvasModuleSchema,
} from "common/canvas";

// Feiltype for Canvas HTTP-feil
interface CanvasHttpError extends Error {
  status?: number;
  details?: string;
}

// Oppretter express router
const router = Router();
// Bruk middleware på alle ruter
router.use(requireCanvasToken);

// Endpoints
// GET /whoami - Minimal brukerinfo
router.get("/whoami", async (_req, res) => {
  try {
    const response = await canvasFetch<unknown>("/api/v1/users/self/profile");
    const canvasUser = CanvasUserSchema.parse(response.data);

    // Lagre eller oppdater bruker i vår egen database (kun canvas data, ikke lokal bruker fra vårt eget auth system)
    // OBS: Dette er ren datasynkronisering. Det bekrefter at Canvas-tokenet virker, men logger ikke brukeren inn i VÅRT system.
    await CanvasUser.findOneAndUpdate(
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
      },
      { upsert: true, new: true, setDefaultsOnInsert: true } // Opprett hvis ikke finnes
    );
    logger.info({ userId: canvasUser.id }, "Canvas /whoami endpoint kalt og bruker synkronisert");
    res.json(canvasUser);
  } catch (error) {
    logger.error({ err: error }, "Klarte ikke å hente eller lagre brukerinformasjon (/whoami)");
    throw error;
  }
});

// GET /emner - Hent aktive emner
router.get("/emner", async (_req, res) => {
  try {
    const response = await canvasFetch<unknown[]>("/api/v1/courses", {
      queryParams: { enrollment_state: "active", per_page: 100 },
    });
    // Valider hvert emne med Zod
    const courses = z.array(CanvasCourseSchema).parse(response.data);
    logger.info({ count: courses.length }, "Hentet aktive emner");
    res.json({
      courses,
      meta: response.meta,
    });
  } catch (error) {
    logger.error({ err: error }, "Feil under henting av emner");
    throw error;
  }
});

// GET /emner/:courseId - Hent emne-detaljer
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
    const response = await canvasFetch<unknown>(`/api/v1/courses/${courseIdNum}`);
    const course = CanvasCourseSchema.parse(response.data);
    logger.info({ courseId: course.id, name: course.name }, "Hentet emnedetaljer");
    res.json(course);
  } catch (error) {
    logger.error({ err: error }, `Feil under henting av emne ${req.params.courseId}`);
    throw error;
  }
});

// GET /emner/:courseId/oppgaver - Hent oppgaver
router.get("/emner/:courseId/oppgaver", async (req, res) => {
  try {
    const { courseId } = req.params;
    const courseIdNum = parseInt(courseId, 10);
    if (isNaN(courseIdNum)) {
      return res.status(400).json({
        feil: "Ugyldig courseId",
      });
    }
    // Hent oppgaver fra Canvas API
    const response = await canvasFetch<unknown[]>(
      `/api/v1/courses/${courseIdNum}/assignments`,
      { queryParams: { per_page: 100 } }
    );
    const assignments = z.array(CanvasAssignmentSchema).parse(response.data);
    logger.info({ courseId: courseIdNum, count: assignments.length }, "Hentet oppgaver for emne");
    res.json({
      assignments,
      meta: response.meta,
    });
  } catch (error) {
    logger.error({ err: error }, `Feil under henting av oppgaver for emne ${req.params.courseId}`);
    throw error;
  }
});

// GET /emner/:courseId/announcements - Hent announcements for et emne
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
    // Hent announcements fra Canvas API
    const response = await canvasFetch<unknown[]>(
      `/api/v1/courses/${courseIdNum}/discussion_topics`,
      {
        queryParams: {
          only_announcements: true,
          per_page: 50
        }
      }
    );
    // Valider med Zod
    const announcements = z.array(CanvasAnnouncementSchema).parse(response.data);
    logger.info({ courseId: courseIdNum, count: announcements.length }, "Hentet announcements for emne");
    res.json({
      announcements,
      meta: response.meta,
    });
  } catch (error) {
    logger.error({ err: error }, `Feil under henting av announcements for emne ${req.params.courseId}`);
    throw error;
  }
});

// GET /announcements - Hent alle announcements fra alle aktive emner
router.get("/announcements", async (_req, res) => {
  try {
    // Først hent alle aktive emner
    const coursesResponse = await canvasFetch<unknown[]>("/api/v1/courses", {
      queryParams: { enrollment_state: "active", per_page: 100 },
    });
    // Henter zod schema for emner og deklarer det i emne variabel
    const courses = z.array(CanvasCourseSchema).parse(coursesResponse.data);

    // Hvis ingen aktive emner, returner tomt array
    if (courses.length === 0) {
      return res.json({
        announcements: [],
        meta: {
          pagesFetched: 0,
          itemsCount: 0,
        },
      });
    }

    // Bygg context_codes array (format: "course_COURSEID")
    const contextCodes = courses.map((course: typeof courses[0]) => `course_${course.id}`);

    // Hent announcements med context_codes
    const response = await canvasFetch<unknown[]>("/api/v1/announcements", {
      queryParams: {
        context_codes: contextCodes,
        active_only: true,
        per_page: 50,
      },
    });
    // Valider med Zod
    const announcements = z.array(CanvasAnnouncementSchema).parse(response.data);
    logger.info({ count: announcements.length }, "Hentet alle announcements");
    res.json({
      announcements,
      meta: response.meta,
    });
  } catch (error) {
    logger.error({ err: error }, "Feil under henting av annonseringer");
    throw error;
  }
});

// GET /planlegger - Hent studentens totale tidslinje (Alt som skjer)
router.get("/planlegger", async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const queryParams: Record<string, string | number | boolean> = {
      per_page: 100,
    };
    if (typeof start_date === "string") queryParams.start_date = start_date;
    if (typeof end_date === "string") queryParams.end_date = end_date;
    const response = await canvasFetch<unknown[]>("/api/v1/planner/items", {
      queryParams,
    });
    const items = response.data;
    logger.info({ itemCount: Array.isArray(items) ? items.length : 0, range: { start_date, end_date } }, "Hentet planlegger items");
    res.json({
      items,
      meta: response.meta,
    });
  } catch (error) {
    logger.error({ err: error }, "Feil under henting av planlegger");
    throw error;
  }
});

// GET /emner/:courseId/modules - Hent moduler
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
    // Vi spør også om items inni modulene
    const response = await canvasFetch<unknown[]>(
      `/api/v1/courses/${courseIdNum}/modules`,
      {
        queryParams: {
          include: ["items"],
          per_page: 50
        },
      }
    );
    // Valider med Zod
    const modules = z.array(CanvasModuleSchema).parse(response.data);
    logger.info({ courseId: courseIdNum, moduleCount: modules.length }, "Hentet moduler");
    res.json({
      modules,
      meta: response.meta,
    });
  } catch (error) {
    logger.error({ err: error }, `Feil under henting av moduler for emne ${req.params.courseId}`);
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
      detaljer: error.message,
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
