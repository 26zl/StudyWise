/*
 * Delte Canvas service-funksjoner for backend.
 * Inneholder typed fetch-hjelpere som bruker hentCanvasData og Zod-validering.
 * Kan gjenbrukes av både Express-ruter (canvas.ts) og KI-ruter (ki.ts).
 */
import { z } from "zod";
import {
  hentCanvasData,
  CACHE_TTL,
  PAGE_SIZE,
  MAX_PAGES,
  FORELESNINGER_VINDU,
} from "./canvasUtils.js";
import {
  CanvasUserSchema,
  CanvasCourseSchema,
  CanvasAssignmentSchema,
  CanvasAnnouncementSchema,
  CanvasModuleSchema,
  CanvasCalendarEventSchema,
  CanvasTodoItemSchema,
  CanvasModuleItemDetailSchema,
  CanvasPageSchema,
  CanvasFileSchema,
  CanvasDiscussionTopicSchema,
  CanvasPlannerItemSchema,
  type CanvasCourse,
} from "common/canvas";
import { logger } from "../../utils/logger.js";
import pdfParse from "pdf-parse";

/** Maks antall tegn filinnhold per PDF i KI-kontekst */
const MAX_PDF_CONTENT_LENGTH = 12000;
/** Maks filstørrelse vi laster ned for PDF-ekstraksjon (5 MB) */
const MAX_PDF_FILE_SIZE = 5 * 1024 * 1024;

// Generisk type for Canvas API-respons med valgfri metadata
type CanvasResponseWithMeta<T> = {
  data: T;
  meta?: { pagesFetched: number; itemsCount: number };
};

// Hjelpefunksjon for å sikre at Canvas-token er tilstede
const requireToken = (token?: string | null) => {
  if (!token) throw new Error("Canvas-token mangler for innlogget bruker");
  return token;
};

// Hent brukerprofil
export async function fetchUserProfile(canvasToken?: string | null) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>("/api/v1/users/self/profile", {
    token,
    cacheTtl: CACHE_TTL.USER_PROFILE,
  });
  return {
    data: CanvasUserSchema.parse(response.data),
    meta: response.meta,
  };
}

// Hent aktive kurs for brukeren
// Henter kun aktive kurs brukeren er meldt opp i
// enrollment_state=active filtrerer ut fullførte/avsluttede emner
// Inkluderer også enrollments for å få section_id (trengs for calendar_events)
export async function fetchCourses(canvasToken?: string | null): Promise<
  CanvasResponseWithMeta<CanvasCourse[]>
> {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/courses", {
    token,
    queryParams: {
      per_page: PAGE_SIZE.DEFAULT,
      enrollment_state: "active", // Kun kurs med aktiv påmelding
      "include[]": "total_students", // Trigger full enrollment data inkl. section
    },
    cacheTtl: CACHE_TTL.COURSES,
  });
  const allCourses = z.array(CanvasCourseSchema).parse(response.data);
  // Filtrer ut slettede og upubliserte kurs
  const validCourses = allCourses.filter(
    (course) => course.workflow_state === "available"
  );
  return {
    data: validCourses,
    meta: response.meta,
  };
}

// Hent kurs for KI-kontekst: inkluderer både aktive og fullførte emner
// Returnerer kurs med __completed flag slik at KI kan merke avsluttede emner
// Faller tilbake til kun aktive kurs dersom henting av fullførte feiler
export type CanvasCourseForKI = CanvasCourse & { __completed?: boolean };

export async function fetchCoursesForKI(canvasToken?: string | null): Promise<
  CanvasResponseWithMeta<CanvasCourseForKI[]>
> {
  // Hent aktive kurs først (dette er baseline og skal aldri feile)
  const activeResult = await fetchCourses(canvasToken);
  const activeCourses: CanvasCourseForKI[] = activeResult.data.map(
    (c) => ({ ...c, __completed: false }),
  );

  // Prøv å hente fullførte kurs i tillegg — men feil er ikke kritisk
  try {
    const token = requireToken(canvasToken);
    const completedRes = await hentCanvasData<unknown[]>("/api/v1/courses", {
      token,
      queryParams: {
        per_page: PAGE_SIZE.DEFAULT,
        enrollment_state: "completed",
        "include[]": "total_students",
      },
      cacheTtl: CACHE_TTL.COURSES,
    });

    const parsed = z.array(CanvasCourseSchema).safeParse(completedRes.data);
    if (parsed.success) {
      const completedCourses = parsed.data
        .filter((c) => c.workflow_state === "available" || c.workflow_state === "completed")
        .map((c): CanvasCourseForKI => ({ ...c, __completed: true }));

      // Dedupliser (et emne kan være i begge lister)
      const seen = new Set(activeCourses.map((c) => c.id));
      activeCourses.push(...completedCourses.filter((c) => !seen.has(c.id)));
    }
  } catch (error) {
    logger.warn({ err: error }, "Kunne ikke hente fullførte emner — bruker kun aktive");
  }

  return {
    data: activeCourses,
    meta: activeResult.meta,
  };
}

// Hent spesifikt kurs (med syllabus for fallback-visning)
export async function fetchCourse(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(`/api/v1/courses/${courseId}`, {
    token,
    queryParams: { "include[]": "syllabus_body" },
    cacheTtl: CACHE_TTL.COURSES,
  });
  return {
    data: CanvasCourseSchema.parse(response.data),
    meta: response.meta,
  };
}

// Hent oppgaver for et kurs
// bucket parameter filtrerer oppgaver:
// - "upcoming": Oppgaver som har frist i fremtiden og ikke er levert
// - "future": Oppgaver med frist i fremtiden (inkl. leverte)
// - "past": Oppgaver med frist i fortiden
// - "undated": Oppgaver uten frist
export async function fetchAssignments(
  canvasToken: string | null | undefined, 
  courseId: number,
  options?: { bucket?: "past" | "overdue" | "undated" | "ungraded" | "unsubmitted" | "upcoming" | "future" }
) {
  const token = requireToken(canvasToken);
  const queryParams: Record<string, string | number | boolean> = {
    per_page: PAGE_SIZE.DEFAULT,
    "include[]": "submission", // Inkluder brukerens innleveringsstatus
  };

  // Legg til bucket filter hvis spesifisert
  if (options?.bucket) {
    queryParams.bucket = options.bucket;
  }
  
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/assignments`,
    {
      token,
      queryParams,
      cacheTtl: CACHE_TTL.ASSIGNMENTS,
    }
  );
  return {
    data: z.array(CanvasAssignmentSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent kunngjøringer for et kurs
export async function fetchCourseAnnouncements(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/discussion_topics`,
    {
      token,
      queryParams: { only_announcements: true, per_page: PAGE_SIZE.ANNOUNCEMENTS },
      cacheTtl: CACHE_TTL.ANNOUNCEMENTS,
    }
  );
  return {
    data: z.array(CanvasAnnouncementSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent alle kunngjøringer for brukeren på tvers av kurs
export async function fetchAllAnnouncements(canvasToken?: string | null) {
  const token = requireToken(canvasToken);
  const coursesRes = await fetchCourses(token);
  const courses = coursesRes.data;
  if (courses.length === 0) {
    return { data: [], meta: { pagesFetched: 0, itemsCount: 0 } };
  }
  const contextCodes = courses.map((course: CanvasCourse) => `course_${course.id}`);
  const response = await hentCanvasData<unknown[]>("/api/v1/announcements", {
    token,
    queryParams: { context_codes: contextCodes, active_only: true, per_page: PAGE_SIZE.ANNOUNCEMENTS },
    cacheTtl: CACHE_TTL.ANNOUNCEMENTS,
  });
  return {
    data: z.array(CanvasAnnouncementSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent todo-liste for brukeren
export async function fetchTodo(canvasToken?: string | null) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/users/self/todo", {
    token,
    cacheTtl: CACHE_TTL.TODO,
  });
  return {
    data: z.array(CanvasTodoItemSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent kommende kalenderhendelser for brukeren
export async function fetchUpcomingEvents(canvasToken?: string | null) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/users/self/upcoming_events", {
    token,
    cacheTtl: CACHE_TTL.EVENTS,
  });
  // Valider hvert element og dropp de som mangler gyldig id (Canvas returnerer noen ganger tomme/NaN)
  const valid: z.infer<typeof CanvasCalendarEventSchema>[] = [];
  const invalid: { idx: number; issues: z.ZodIssue[] }[] = [];

  response.data.forEach((item, idx) => {
    // Prøv å coerce id eksplisitt til number før validering for å unngå NaN fra f.eks. tom streng
    const normalized =
      typeof item === "object" && item !== null
        ? { ...(item as Record<string, unknown>), id: Number((item as Record<string, unknown>).id) }
        : item;
    const parsed = CanvasCalendarEventSchema.safeParse(normalized);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalid.push({ idx, issues: parsed.error.issues });
    }
  });

  return {
    data: valid,
    meta: response.meta,
  };
}
// Hent planleggingsobjekter for brukeren innenfor et datointervall
// Planner API returnerer alle assignments, quizzes, discussions, announcements etc. i ett kall
// Dette er MAKS 3-4 API kall (paginering) i stedet for N kall per kurs
export async function fetchPlannerItems(
  canvasToken: string | null | undefined,
  query: {
    start_date?: string;
    end_date?: string;
    maxPages?: number;
  }
) {
  const token = requireToken(canvasToken);
  const queryParams: Record<string, string | number | boolean> = { per_page: PAGE_SIZE.DEFAULT };
  if (query.start_date) queryParams.start_date = query.start_date;
  if (query.end_date) queryParams.end_date = query.end_date;
  const response = await hentCanvasData<unknown[]>("/api/v1/planner/items", {
    token,
    queryParams,
    cacheTtl: CACHE_TTL.ASSIGNMENTS, // 10 min cache
    maxPages: query.maxPages ?? MAX_PAGES.DEFAULT, // Konfigurerbar paginering
  });
  // Valider og filtrer ut ugyldige items
  const valid: z.infer<typeof CanvasPlannerItemSchema>[] = [];
  const invalid: number[] = [];
  response.data.forEach((item, idx) => {
    const parsed = CanvasPlannerItemSchema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalid.push(idx);
    }
  });
  return {
    data: valid,
    meta: response.meta,
  };
}
/**
 * Hent kalenderhendelser fra Canvas Calendar Events API
 * Bruker context_codes[] for å hente brukerens og kursenes hendelser
 */
export async function fetchCalendarEvents(
  canvasToken: string | null | undefined,
  options: {
    contextCodes: string[];
    startDate?: string;
    endDate?: string;
    type?: "event" | "assignment";
    maxPages?: number; // Konfigurerbar paginering (default 10 for calendar_events)
  }
) {
  const token = requireToken(canvasToken);
  // Bygg query params - Canvas API forventer context_codes[] som array
  const queryParams: Record<string, string | number | boolean | string[]> = {
    per_page: PAGE_SIZE.DEFAULT,
  };
  // Legg til context_codes som array
  if (options.contextCodes.length > 0) {
    queryParams["context_codes[]"] = options.contextCodes;
  }
  if (options.startDate) queryParams.start_date = options.startDate;
  if (options.endDate) queryParams.end_date = options.endDate;
  if (options.type) queryParams.type = options.type;
  // Bruk høyere maxPages for calendar_events (mange events over lang periode)
  const maxPages = options.maxPages ?? MAX_PAGES.CALENDAR;
  const response = await hentCanvasData<unknown[]>("/api/v1/calendar_events", {
    token,
    queryParams,
    cacheTtl: CACHE_TTL.EVENTS,
    maxPages,
  });
  // Valider hvert element og dropp ugyldige
  const valid: z.infer<typeof CanvasCalendarEventSchema>[] = [];
  const invalid: number[] = [];
  response.data.forEach((item, idx) => {
    // Normaliser id til number
    const normalized =
      typeof item === "object" && item !== null
        ? { ...(item as Record<string, unknown>), id: Number((item as Record<string, unknown>).id) }
        : item;
    const parsed = CanvasCalendarEventSchema.safeParse(normalized);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalid.push(idx);
    }
  });
  if (invalid.length > 0) {
    logger.warn({ invalidCount: invalid.length }, "Ignorerte ugyldige calendar_events");
  }
  return {
    data: valid,
    meta: response.meta,
  };
}
// Type for enrollment data med section info
export interface EnrollmentData {
  course_id: number;
  course_section_id?: number;
}
/**
 * Hent brukerens enrollments med section_id
 * Brukes for å bygge course_section context codes for calendar_events
 * og for å mappe section_id -> course_id for TimeEdit-hendelser
 */
export async function fetchUserEnrollments(canvasToken?: string | null) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/users/self/enrollments", {
    token,
    queryParams: {
      per_page: PAGE_SIZE.DEFAULT,
      // Inkluder alle enrollment-states for å fange alle sections
      state: ["active", "invited", "current_and_future"],
    },
    cacheTtl: CACHE_TTL.COURSES,
  });
  const enrollments = response.data as EnrollmentData[];
  return {
    data: enrollments,
    meta: response.meta,
  };
}
/**
 * Bygg en mapping fra section_id til course_id basert på enrollments
 * Brukes for å resolve course_section_XXX context_codes til course_id
 */
export function buildSectionToCourseMap(
  enrollments: EnrollmentData[]
): Map<number, number> {
  const map = new Map<number, number>();
  enrollments.forEach((enrollment) => {
    if (enrollment.course_section_id) {
      map.set(enrollment.course_section_id, enrollment.course_id);
    }
  });
  return map;
}
/**
 * Bygg context_codes array for en bruker og deres kurs
 * Inkluderer både course_ og course_section_ context codes
 * TimeEdit-hendelser er ofte koblet til sections, ikke direkte til kurs
 */
export function buildContextCodes(
  userId: number | string,
  courses: CanvasCourse[],
  enrollments?: Array<{ course_id: number; course_section_id?: number }>
): string[] {
  const codes: string[] = [];
  // Legg til brukerens context_code
  codes.push(`user_${userId}`);
  // Legg til context_codes for hvert kurs
  courses.forEach((course) => {
    codes.push(`course_${course.id}`);
  });
  // Legg til course_section context codes fra enrollments
  // Dette er kritisk for TimeEdit-hendelser som er koblet til sections
  if (enrollments) {
    const sectionIds = new Set<number>();
    enrollments.forEach((enrollment) => {
      if (enrollment.course_section_id) {
        sectionIds.add(enrollment.course_section_id);
      }
    });
    sectionIds.forEach((sectionId) => {
      codes.push(`course_section_${sectionId}`);
    });
  }
  return codes;
}
// Hent moduler for et kurs
// Inkluderer items med content_details for å få content_id for filer
export async function fetchModules(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/modules`,
    {
      token,
      queryParams: {
        include: ["items", "content_details"],
        per_page: PAGE_SIZE.MODULES
      },
      cacheTtl: CACHE_TTL.MODULES,
    }
  );
  return {
    data: z.array(CanvasModuleSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent modul-items for en modul i et kurs
export async function fetchModuleItems(
  canvasToken: string | null | undefined,
  courseId: number,
  moduleId: number
) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/modules/${moduleId}/items`,
    {
      token,
      queryParams: { "include[]": "content_details", per_page: PAGE_SIZE.DEFAULT },
      cacheTtl: CACHE_TTL.MODULES,
    }
  );
  return {
    data: z.array(CanvasModuleItemDetailSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent detaljert info for et modul-item
export async function fetchModuleItem(
  canvasToken: string | null | undefined,
  courseId: number,
  moduleId: number,
  itemId: number
) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(
    `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
    {
      token,
      queryParams: { "include[]": "content_details" },
      cacheTtl: CACHE_TTL.MODULES,
    }
  );
  return {
    data: CanvasModuleItemDetailSchema.parse(response.data),
    meta: response.meta,
  };
}

// Hent metadata for en fil
export async function fetchFileMetadata(canvasToken: string | null | undefined, fileId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(`/api/v1/files/${fileId}`, {
    token,
    cacheTtl: CACHE_TTL.FILES,
  });
  return {
    data: CanvasFileSchema.parse(response.data),
    meta: response.meta,
  };
}

// Hent en side i et kurs
export async function fetchPage(
  canvasToken: string | null | undefined,
  courseId: number,
  pageId: string
) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(
    `/api/v1/courses/${courseId}/pages/${pageId}`,
    {
      token,
      cacheTtl: CACHE_TTL.PAGES,
    }
  );
  return {
    data: CanvasPageSchema.parse(response.data),
    meta: response.meta,
  };
}

// Hent en diskusjonstråd i et kurs
export async function fetchDiscussionTopic(
  canvasToken: string | null | undefined,
  courseId: number,
  topicId: number
) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(
    `/api/v1/courses/${courseId}/discussion_topics/${topicId}`,
    {
      token,
      cacheTtl: CACHE_TTL.DISCUSSIONS,
    }
  );
  return {
    data: CanvasDiscussionTopicSchema.parse(response.data),
    meta: response.meta,
  };
}

// Hent alle filer i et kurs (øverste nivå)
export async function fetchFiles(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/files`,
    {
      token,
      queryParams: { per_page: PAGE_SIZE.DEFAULT },
      cacheTtl: CACHE_TTL.FILES,
    }
  );
  return {
    data: z.array(CanvasFileSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent alle sider (wiki pages) i et kurs
export async function fetchPages(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/pages`,
    {
      token,
      queryParams: { per_page: PAGE_SIZE.DEFAULT },
      cacheTtl: CACHE_TTL.PAGES,
    }
  );
  return {
    data: z.array(CanvasPageSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent kursets frontpage (landing page)
export async function fetchFrontPage(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(
    `/api/v1/courses/${courseId}/front_page`,
    {
      token,
      cacheTtl: CACHE_TTL.PAGES,
    }
  );
  return {
    data: CanvasPageSchema.parse(response.data),
    meta: response.meta,
  };
}

/**
 * Laster ned en PDF-fil fra Canvas og ekstraherer tekst med pdf-parse.
 * Returnerer ekstrahert tekst, begrenset til MAX_PDF_CONTENT_LENGTH tegn.
 * Returnerer null dersom filen ikke er PDF, er for stor, eller parsing feiler.
 */
export async function fetchPdfContent(
  canvasToken: string | null | undefined,
  file: { id: number; filename: string; url: string; size: number; mime_type?: string },
): Promise<{ content: string; truncated: boolean } | null> {
  // Sjekk at filen er en PDF
  const isPdf = file.mime_type === "application/pdf" || file.filename.toLowerCase().endsWith(".pdf");
  if (!isPdf) return null;

  // Sjekk filstørrelse
  if (file.size > MAX_PDF_FILE_SIZE) {
    logger.info({ fileId: file.id, filename: file.filename, size: file.size }, "PDF for stor for KI-kontekst");
    return null;
  }

  try {
    // Hent fersk metadata for signert URL (den i file.url kan ha utløpt)
    const token = requireToken(canvasToken);
    const { data: freshFile } = await fetchFileMetadata(token, file.id);
    const downloadUrl = freshFile.url;

    if (!downloadUrl) {
      logger.warn({ fileId: file.id, filename: file.filename }, "Ingen download-URL for PDF");
      return null;
    }

    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      logger.warn(
        { fileId: file.id, filename: file.filename, status: response.status },
        "Kunne ikke laste ned PDF fra Canvas",
      );
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const parsed = await pdfParse(buffer);
    const fullText = parsed.text?.trim() || "";

    if (fullText.length === 0) {
      logger.info({ fileId: file.id, filename: file.filename }, "PDF inneholdt ingen lesbar tekst");
      return null;
    }

    const truncated = fullText.length > MAX_PDF_CONTENT_LENGTH;
    const content = truncated ? fullText.substring(0, MAX_PDF_CONTENT_LENGTH) : fullText;

    logger.info(
      { fileId: file.id, filename: file.filename, pages: parsed.numpages, textLength: fullText.length, truncated },
      "PDF-tekst ekstrahert for KI-kontekst",
    );

    return { content, truncated };
  } catch (error) {
    logger.warn(
      { err: error, fileId: file.id, filename: file.filename },
      "Feil ved PDF-tekstekstraksjon for KI-kontekst",
    );
    return null;
  }
}

/**
 * Varmer opp cache for vanlige Canvas-data.
 * Kjøres asynkront etter login for å forbedre UX.
 * Feil ignoreres - dette er kun optimalisering.
 */
export async function warmCanvasCache(canvasToken: string): Promise<void> {
  try {
    logger.info("Starter cache warming for Canvas-data");

    // Hent de viktigste dataene parallelt
    // Per-kurs-cacher (frontpage, modules, files) varmes av /emner/metadata-prefetch
    // fra frontend, så vi unngår duplikate Canvas API-kall her
    await Promise.allSettled([
      fetchCourses(canvasToken),
      fetchAllAnnouncements(canvasToken),
      fetchTodo(canvasToken),
    ]);

    logger.info("Cache warming fullført");
  } catch (error) {
    // Ignorer feil - cache warming er ikke kritisk
    logger.warn({ err: error }, "Cache warming feilet (ikke kritisk)");
  }
}
/**
 * Normalisert format for Canvas Calendar Events (forelesninger/møter)
 */
export interface NormalizedCalendarEvent {
  id: string;
  source: "canvas_calendar";
  title: string;
  startAt: string; // ISO (UTC)
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  courseId: string | null;
  courseName: string | null;
  url: string | null;
  descriptionText: string | null;
}
import { stripHtml } from "../../utils/htmlUtils.js";
/**
 * Fjerner HTML-tags og stylesheet-linker fra description
 * Returnerer ren tekst (eller null hvis tom)
 */
function stripHtmlFromDescription(html: string | null | undefined): string | null {
  if (!html) return null;
  const cleaned = stripHtml(html, { removeStyles: true });
  return cleaned.length > 0 ? cleaned : null;
}
/**
 * Ekstraherer kurs-ID fra context_code eller effective_context_code
 * Returnerer course_xxx -> xxx, eller null hvis ikke kurs-kontekst
 *
 * Støtter nå section-to-course mapping for TimeEdit-hendelser:
 * Hvis context_code er course_section_XXX og vi har en sectionToCourseMap,
 * slår vi opp section_id for å finne tilhørende course_id.
 *
 * Eksportert for bruk i /kalender-endepunktet
 */
export function extractCourseIdFromContext(
  contextCode: string | null | undefined,
  effectiveContextCode: string | null | undefined,
  allContextCodes: string | null | undefined,
  sectionToCourseMap?: Map<number, number>
): string | null {
  // Prøv effective_context_code først (mest pålitelig)
  if (effectiveContextCode) {
    const match = effectiveContextCode.match(/^course_(\d+)$/);
    if (match) return match[1];
  }
  // Prøv all_context_codes (komma-separert)
  if (allContextCodes) {
    const codes = allContextCodes.split(",");
    for (const code of codes) {
      const match = code.trim().match(/^course_(\d+)$/);
      if (match) return match[1];
    }
  }
  // Prøv context_code direkte for course_XXX
  if (contextCode && !contextCode.startsWith("course_section_")) {
    const match = contextCode.match(/^course_(\d+)$/);
    if (match) return match[1];
  }

  // Prøv å resolve course_section_XXX via sectionToCourseMap
  if (contextCode && contextCode.startsWith("course_section_") && sectionToCourseMap) {
    const sectionMatch = contextCode.match(/^course_section_(\d+)$/);
    if (sectionMatch) {
      const sectionId = parseInt(sectionMatch[1], 10);
      const courseId = sectionToCourseMap.get(sectionId);
      if (courseId) {
        return String(courseId);
      }
    }
  }

  return null;
}
/**
 * Henter og normaliserer kalenderhendelser (forelesninger/møter) fra Canvas Calendar Events API.
 *
 * Flyt:
 * 1. Henter aktive emner (courses)
 * 2. Bygger context_codes[] for hvert emne
 * 3. Henter calendar_events med type=event for gitt datointervall
 * 4. Følger pagination via Link-header
 * 5. Filtrerer bort events der hidden === true (parent-events)
 * 6. Normaliserer til vårt interne format
 */
// Metadata for forelesninger-respons
export interface ForelesningerMeta {
  eventCount: number;
  courseCount: number;
  dateRange: { startDate: string; endDate: string };
}
//  Hent og normaliser Canvas-forelesninger
export async function fetchCanvasLectures(
  canvasToken: string | null | undefined,
  options: { startDate?: string; endDate?: string } = {}
): Promise<{ data: NormalizedCalendarEvent[]; meta: ForelesningerMeta }> {
  const token = requireToken(canvasToken);
  // Hent aktive emner og enrollments parallelt
  const [coursesResult, enrollmentsResult] = await Promise.all([
    fetchCourses(token),
    fetchUserEnrollments(token),
  ]);
  const courses = coursesResult.data;
  const enrollments = enrollmentsResult.data;

  if (courses.length === 0) {
    return {
      data: [],
      meta: { eventCount: 0, courseCount: 0, dateRange: { startDate: "", endDate: "" } },
    };
  }
  // Bygg section-to-course mapping for TimeEdit events
  const sectionToCourseMap = buildSectionToCourseMap(enrollments);
  // Beregn datovindu (3 mnd tilbake, 12 mnd frem)
  const now = new Date();
  const defaultStart = new Date(now);
  defaultStart.setMonth(defaultStart.getMonth() - FORELESNINGER_VINDU.MÅNEDER_TILBAKE);
  const defaultEnd = new Date(now);
  defaultEnd.setMonth(defaultEnd.getMonth() + FORELESNINGER_VINDU.MÅNEDER_FREM);
  const startDate = options.startDate ?? defaultStart.toISOString().split("T")[0];
  const endDate = options.endDate ?? defaultEnd.toISOString().split("T")[0];
  // Bygg context_codes med både course og course_section
  const contextCodes = buildContextCodes(0, courses, enrollments); // userId 0 - vi trenger bare kurs/sections
  const { data: rawEvents } = await fetchCalendarEvents(token, {
    contextCodes,
    startDate,
    endDate,
    type: "event",
    maxPages: MAX_PAGES.LECTURES,
  });
  // Filtrer hidden events (parent-events med children)
  const visibleEvents = rawEvents.filter((event) => {
    if (event.hidden !== true) return true;
    // Inkluder hidden parent uten children (TimeEdit edge-case)
    return (event.child_events_count ?? 0) === 0;
  });
  // Bygg kurs-navn-map
  const courseNameMap = new Map(courses.map((c) => [String(c.id), c.name]));
  // Normaliser til vårt format
  const normalized: NormalizedCalendarEvent[] = visibleEvents
    .filter((e) => e.start_at || e.all_day_date)
    .map((event) => {
      // Bruk sectionToCourseMap for å resolve course_section context codes
      const courseId = extractCourseIdFromContext(
        event.context_code,
        event.effective_context_code,
        event.all_context_codes,
        sectionToCourseMap
      );
      const courseName = event.context_name || (courseId ? courseNameMap.get(courseId) : null) || null;
      // Bygg location
      let location: string | null = null;
      if (event.location_name) {
        location = event.location_name;
        if (event.location_address && event.location_address !== event.location_name) {
          location += `, ${event.location_address}`;
        }
      } else if (event.location_address) {
        location = event.location_address;
      }
      // Returner normalisert event
      return {
        id: String(event.id),
        source: "canvas_calendar" as const,
        title: event.title,
        startAt: event.start_at || event.all_day_date!,
        endAt: event.end_at || null,
        allDay: event.all_day === true,
        location,
        courseId,
        courseName,
        url: event.html_url || null,
        descriptionText: stripHtmlFromDescription(event.description),
      };
    });
// Returner normaliserte events med metadata
  return {
    data: normalized,
    meta: {
      eventCount: normalized.length,
      courseCount: courses.length,
      dateRange: { startDate, endDate },
    },
  };
}
