/*
 * TimeEdit API Router
 * Håndterer ruter for å kommunisere med TimeEdit for å hente timeplan.
 * AUTOMATISK integrasjon - bruker Canvas-emnekoder til å søke i TimeEdit.
 * Støtter filtrering på campus (Bø, Drammen, Kongsberg, etc.)
 */
import { Router } from "express";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import { rateLimitCanvas } from "../../middleware/rate-limit.js";
import { noCache } from "../../middleware/no-cache.js";
import { 
  fetchTimeEditSchedule, 
  fetchTimeEditFromUrl,
  fetchTimeEditAutomatic,
  extractCourseCodesFromCanvasCourses,
  getSemesterPeriod,
  convertToCalendarItems,
  USN_CAMPUSES,
  type CampusId,
} from "./timeEditService.js";
import { fetchCourses } from "../canvas/canvasService.js";
import type { CalendarItem } from "common/calendar";

const router = Router();

// Bruk middleware
router.use(noCache);

// TimeEdit base URL for USN (kan gjøres konfigurerbar via env i fremtiden)
const TIMEEDIT_BASE_URL = process.env.TIMEEDIT_BASE_URL || "https://cloud.timeedit.net/usn/web/publikk";

// Validering for POST-request (støtter fortsatt manuell overstyring)
const TimeplanRequestSchema = z.object({
  timeEditBaseUrl: z.string().url("Ugyldig TimeEdit URL").optional(),
  courseCodes: z.array(z.string()).optional(),
});

/**
 * POST /timeplan
 * Henter timeplan fra TimeEdit basert på brukerens emnekoder fra Canvas
 * 
 * Body (alt er valgfritt):
 * - timeEditBaseUrl: Overstyr TimeEdit base URL (valgfritt)
 * - courseCodes: Array av emnekoder (valgfritt - hentes fra Canvas automatisk)
 */
router.post("/", rateLimitCanvas, async (req, res) => {
  try {
    const parseResult = TimeplanRequestSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      return res.status(400).json({
        feil: "Ugyldig forespørsel",
        melding: parseResult.error.issues.map((e) => e.message).join(", "),
      });
    }
    
    const timeEditBaseUrl = parseResult.data.timeEditBaseUrl || TIMEEDIT_BASE_URL;
    let courseCodes = parseResult.data.courseCodes;
    
    // Hent emnekoder fra Canvas automatisk hvis ikke oppgitt
    if (!courseCodes || courseCodes.length === 0) {
      if (!req.canvasToken) {
        return res.status(401).json({
          feil: "Autentisering kreves",
          melding: "Du må være logget inn med Canvas for å hente timeplan automatisk.",
        });
      }
      
      try {
        const { data: canvasCourses } = await fetchCourses(req.canvasToken);
        courseCodes = extractCourseCodesFromCanvasCourses(canvasCourses);
        
        if (courseCodes.length === 0) {
          return res.status(404).json({
            feil: "Ingen emnekoder funnet",
            melding: "Kunne ikke finne gyldige emnekoder i dine Canvas-emner.",
          });
        }
        
        logger.info({ 
          userId: req.user?.id,
          courseCodeCount: courseCodes.length,
        }, "Ekstraherte emnekoder fra Canvas automatisk");
      } catch (canvasError) {
        logger.error({ err: canvasError }, "Feil ved henting av emnekoder fra Canvas");
        return res.status(500).json({
          feil: "Canvas-feil",
          melding: "Kunne ikke hente emnekoder fra Canvas.",
        });
      }
    }
    
    // Hent timeplan fra TimeEdit
    const result = await fetchTimeEditSchedule(timeEditBaseUrl, courseCodes);
    
    logger.info({ 
      userId: req.user?.id,
      reservationCount: result.reservations.length,
      courseCodes 
    }, "Hentet TimeEdit-timeplan");
    
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        feil: "Valideringsfeil",
        melding: error.issues.map((e) => e.message).join(", "),
      });
    }
    
    logger.error({ err: error }, "Feil ved henting av TimeEdit-timeplan");
    res.status(500).json({
      feil: "Serverfeil",
      melding: "Kunne ikke hente timeplan fra TimeEdit.",
    });
  }
});

/**
 * GET /timeplan/kalender
 * Henter timeplan AUTOMATISK fra TimeEdit basert på Canvas-emnekoder
 * Ingen URL-input nødvendig - systemet søker automatisk!
 * 
 * Query params:
 * - campus: Campus-ID for å filtrere (f.eks. "bo", "drammen", "kongsberg")
 * - url: (LEGACY) Full TimeEdit-URL - IKKE LENGER NØDVENDIG
 */
router.get("/kalender", rateLimitCanvas, async (req, res) => {
  try {
    const { url, campus } = req.query;
    
    // Valider campus hvis oppgitt
    let validCampus: CampusId | undefined;
    if (campus && typeof campus === "string") {
      const campusLower = campus.toLowerCase();
      // Finn campus fra ID eller alias
      for (const [id, config] of Object.entries(USN_CAMPUSES)) {
        if (id === campusLower || (config.aliases as readonly string[]).includes(campusLower)) {
          validCampus = id as CampusId;
          break;
        }
      }
      if (!validCampus) {
        logger.warn({ campus }, "Ugyldig campus-ID mottatt");
      }
    }
    
    // LEGACY: Hvis URL er oppgitt, bruk den gamle metoden
    if (url && typeof url === "string" && url.includes("timeedit.net")) {
      const timeEditData = await fetchTimeEditFromUrl(url);
      const items: CalendarItem[] = convertToCalendarItems(timeEditData.reservations);
      
      items.sort((a, b) => {
        const dateA = a.due_at ? new Date(a.due_at).getTime() : 0;
        const dateB = b.due_at ? new Date(b.due_at).getTime() : 0;
        return dateA - dateB;
      });
      
      const semester = getSemesterPeriod();
      
      return res.json({
        items,
        meta: {
          generatedAt: new Date().toISOString(),
          courseCount: new Set(items.map((i) => i.course_code).filter(Boolean)).size,
          semester: semester.semester,
          reservationCount: timeEditData.reservations.length,
          automatic: false,
        },
      });
    }
    
    // NY AUTOMATISK METODE: Hent emnekoder fra Canvas og søk i TimeEdit
    if (!req.canvasToken) {
      return res.json({
        items: [],
        meta: {
          generatedAt: new Date().toISOString(),
          message: "Du må være logget inn med Canvas for automatisk timeplan",
          automatic: true,
        },
      });
    }
    
    // 1. Hent Canvas-kurs
    const { data: canvasCourses } = await fetchCourses(req.canvasToken);
    const courseCodes = extractCourseCodesFromCanvasCourses(canvasCourses);
    
    if (courseCodes.length === 0) {
      logger.info({ userId: req.user?.id }, "Ingen emnekoder funnet fra Canvas");
      return res.json({
        items: [],
        meta: {
          generatedAt: new Date().toISOString(),
          message: "Ingen emnekoder funnet i dine Canvas-kurs",
          automatic: true,
        },
      });
    }
    
    logger.info({ 
      userId: req.user?.id, 
      courseCodes,
      campus: validCampus,
    }, "Starter automatisk TimeEdit-søk for Canvas-emnekoder");
    
    // 2. Søk automatisk i TimeEdit basert på emnekoder (med campus-filter)
    const timeEditData = await fetchTimeEditAutomatic(courseCodes, validCampus);
    
    // 3. Konverter til kalender-items
    const items: CalendarItem[] = convertToCalendarItems(timeEditData.reservations);
    
    // Sorter etter dato
    items.sort((a, b) => {
      const dateA = a.due_at ? new Date(a.due_at).getTime() : 0;
      const dateB = b.due_at ? new Date(b.due_at).getTime() : 0;
      return dateA - dateB;
    });
    
    logger.info({ 
      userId: req.user?.id,
      reservationCount: items.length,
      courseCodes: timeEditData.courseCodes,
      campus: validCampus,
    }, "Hentet TimeEdit-kalender automatisk");
    
    res.json({
      items,
      meta: {
        generatedAt: new Date().toISOString(),
        courseCount: new Set(items.map((i) => i.course_code).filter(Boolean)).size,
        semester: timeEditData.semester,
        reservationCount: timeEditData.reservations.length,
        courseCodes: timeEditData.courseCodes,
        campus: validCampus ? USN_CAMPUSES[validCampus].name : null,
        automatic: true,
      },
    });
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av TimeEdit-kalender");
    res.status(500).json({
      feil: "Serverfeil",
      melding: "Kunne ikke hente timeplan fra TimeEdit.",
    });
  }
});

/**
 * GET /timeplan/semester
 * Returnerer informasjon om gjeldende semester
 */
router.get("/semester", (_req, res) => {
  const semester = getSemesterPeriod();
  
  res.json({
    name: semester.semester,
    start: semester.start,
    end: semester.end,
  });
});

/**
 * GET /timeplan/campuser
 * Returnerer liste over tilgjengelige USN-campuser
 */
router.get("/campuser", (_req, res) => {
  const campuses = Object.entries(USN_CAMPUSES).map(([id, config]) => ({
    id,
    code: config.code,
    name: config.name,
    aliases: config.aliases,
  }));
  
  res.json({
    campuses,
    total: campuses.length,
  });
});

/**
 * GET /timeplan/emnekoder
 * Returnerer brukerens emnekoder fra Canvas
 * Nyttig for debugging og visning i frontend
 */
router.get("/emnekoder", rateLimitCanvas, async (req, res) => {
  try {
    if (!req.canvasToken) {
      return res.status(401).json({
        feil: "Autentisering kreves",
        melding: "Du må være logget inn med Canvas.",
      });
    }
    
    const { data: canvasCourses } = await fetchCourses(req.canvasToken);
    const courseCodes = extractCourseCodesFromCanvasCourses(canvasCourses);
    
    // Returner emnekoder med kursnavn
    const courseInfo = canvasCourses.map((course) => {
      const codes = course.course_code?.match(/\b([A-ZÆØÅ]{2,5}\d{4,5})\b/gi) || [];
      return {
        id: course.id,
        name: course.name,
        course_code: course.course_code,
        extracted_codes: codes.map((c) => c.toUpperCase()),
      };
    });
    
    res.json({
      courseCodes,
      courses: courseInfo,
      total: courseCodes.length,
    });
  } catch (error) {
    logger.error({ err: error }, "Feil ved henting av emnekoder");
    res.status(500).json({
      feil: "Serverfeil",
      melding: "Kunne ikke hente emnekoder.",
    });
  }
});

export default router;
