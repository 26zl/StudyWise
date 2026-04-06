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
  validateCanvasRedirectUrl,
  buildCanvasAuthHeaders,
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
import { parseDocument } from "../../services/document.js";

/** Maks filstørrelse vi laster ned for PDF-ekstraksjon i Canvas-sync (10 MB) */
export const MAX_PDF_FILE_SIZE = 10 * 1024 * 1024;
/** Maks filstørrelse for generell fil-nedlasting (10 MB) */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

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

function parseCanvasAnnouncements(
  items: unknown[],
  context: { courseId?: number; scope: "course" | "all" },
) {
  const valid: z.infer<typeof CanvasAnnouncementSchema>[] = [];
  const invalidSamples: Array<{ index: number; issues: string[] }> = [];
  let invalidCount = 0;

  items.forEach((item, index) => {
    const parsed = CanvasAnnouncementSchema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }

    invalidCount++;
    if (invalidSamples.length < 3) {
      invalidSamples.push({
        index,
        issues: parsed.error.issues.map((issue) => {
          const path = issue.path.join(".");
          return path ? `${path}: ${issue.message}` : issue.message;
        }),
      });
    }
  });

  if (invalidCount > 0) {
    logger.warn(
      {
        courseId: context.courseId,
        scope: context.scope,
        invalidCount,
        invalidSamples,
      },
      "Ignorerte ugyldige Canvas announcements",
    );
  }

  return valid;
}


function getValidatedCanvasDownloadUrl(
  downloadUrl: string | null | undefined,
  baseUrl?: string,
): string | null {
  if (!downloadUrl || !baseUrl) {
    return null;
  }

  try {
    const canvasOrigin = new URL(baseUrl).origin;
    return validateCanvasRedirectUrl(downloadUrl, canvasOrigin, "/files/");
  } catch {
    return null;
  }
}

async function fetchUserProfileFromEndpoint(
  endpoint: "/api/v1/users/self/profile" | "/api/v1/users/self",
  token: string,
  baseUrl?: string,
) {
  const response = await hentCanvasData<unknown>(endpoint, {
    token,
    baseUrl,
    cacheTtl: CACHE_TTL.USER_PROFILE,
  });

  return {
    data: CanvasUserSchema.parse(response.data),
    meta: response.meta,
  };
}

/**
 * Henter brukerprofil fra Canvas (med fallback mellom endepunkter).
 */
export async function fetchUserProfile(canvasToken?: string | null, baseUrl?: string) {
  const token = requireToken(canvasToken);
  try {
    return await fetchUserProfileFromEndpoint("/api/v1/users/self/profile", token, baseUrl);
  } catch (error) {
    const canvasError = error as { name?: string; code?: string };
    const shouldFallback =
      canvasError?.name === "CanvasApiError" &&
      (canvasError.code === "token_invalid" ||
        canvasError.code === "permission_denied" ||
        canvasError.code === "resource_not_found");

    if (!shouldFallback) {
      throw error;
    }

    logger.warn(
      { baseUrl, endpoint: "/api/v1/users/self/profile", code: canvasError.code },
      "Canvas-profil-endepunkt feilet, prøver /api/v1/users/self som fallback",
    );

    return fetchUserProfileFromEndpoint("/api/v1/users/self", token, baseUrl);
  }
}

/**
 * Henter aktive kurs for brukeren (enrollment_state=active).
 * Inkluderer enrollment-data slik at vi får `section_id` (bl.a. brukt av calendar events).
 */
export async function fetchCourses(canvasToken?: string | null, baseUrl?: string): Promise<
  CanvasResponseWithMeta<CanvasCourse[]>
> {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/courses", {
    token,
    baseUrl,
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

/**
 * Henter kurs for KI-kontekst: aktive + (best effort) fullførte emner.
 * Fullførte emner markeres med `__completed`.
 */
export async function fetchCoursesForKI(canvasToken?: string | null, baseUrl?: string): Promise<
  CanvasResponseWithMeta<CanvasCourseForKI[]>
> {
  // Hent aktive kurs først (dette er baseline og skal aldri feile)
  const activeResult = await fetchCourses(canvasToken, baseUrl);
  const activeCourses: CanvasCourseForKI[] = activeResult.data.map(
    (c) => ({ ...c, __completed: false }),
  );

  // Prøv å hente fullførte kurs i tillegg — men feil er ikke kritisk
  try {
    const token = requireToken(canvasToken);
    const completedRes = await hentCanvasData<unknown[]>("/api/v1/courses", {
      token,
      baseUrl,
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

/**
 * Henter ett spesifikt kurs (inkl. `syllabus_body` for fallback-visning).
 */
export async function fetchCourse(canvasToken: string | null | undefined, courseId: number, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(`/api/v1/courses/${courseId}`, {
    token,
    baseUrl,
    queryParams: { "include[]": "syllabus_body" },
    cacheTtl: CACHE_TTL.COURSES,
  });
  return {
    data: CanvasCourseSchema.parse(response.data),
    meta: response.meta,
  };
}

/**
 * Henter oppgaver for et kurs.
 *
 * `bucket` kan brukes for å filtrere oppgaver (upcoming/future/past/undated/etc).
 */
export async function fetchAssignments(
  canvasToken: string | null | undefined,
  courseId: number,
  options?: { bucket?: "past" | "overdue" | "undated" | "ungraded" | "unsubmitted" | "upcoming" | "future"; baseUrl?: string }
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
      baseUrl: options?.baseUrl,
      queryParams,
      cacheTtl: CACHE_TTL.ASSIGNMENTS,
    }
  );
  return {
    data: z.array(CanvasAssignmentSchema).parse(response.data),
    meta: response.meta,
  };
}

/**
 * Henter kunngjøringer (announcements) for et kurs.
 */
export async function fetchCourseAnnouncements(canvasToken: string | null | undefined, courseId: number, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/discussion_topics`,
    {
      token,
      baseUrl,
      queryParams: { only_announcements: true, per_page: PAGE_SIZE.ANNOUNCEMENTS },
      cacheTtl: CACHE_TTL.ANNOUNCEMENTS,
    }
  );
  return {
    data: parseCanvasAnnouncements(response.data, { courseId, scope: "course" }),
    meta: response.meta,
  };
}

/**
 * Henter alle kunngjøringer for brukeren på tvers av kurs.
 */
export async function fetchAllAnnouncements(canvasToken?: string | null, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const coursesRes = await fetchCourses(token, baseUrl);
  const courses = coursesRes.data;
  if (courses.length === 0) {
    return { data: [], meta: { pagesFetched: 0, itemsCount: 0 } };
  }
  const contextCodes = courses.map((course: CanvasCourse) => `course_${course.id}`);
  const response = await hentCanvasData<unknown[]>("/api/v1/announcements", {
    token,
    baseUrl,
    queryParams: { context_codes: contextCodes, active_only: true, per_page: PAGE_SIZE.ANNOUNCEMENTS },
    cacheTtl: CACHE_TTL.ANNOUNCEMENTS,
    maxPages: 10,
  });
  return {
    data: parseCanvasAnnouncements(response.data, { scope: "all" }),
    meta: response.meta,
  };
}

/**
 * Henter todo-liste for innlogget bruker.
 */
export async function fetchTodo(canvasToken?: string | null, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/users/self/todo", {
    token,
    baseUrl,
    cacheTtl: CACHE_TTL.TODO,
  });
  return {
    data: z.array(CanvasTodoItemSchema).parse(response.data),
    meta: response.meta,
  };
}

/**
 * Henter kommende kalenderhendelser for innlogget bruker.
 */
export async function fetchUpcomingEvents(canvasToken?: string | null, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/users/self/upcoming_events", {
    token,
    baseUrl,
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

  if (invalid.length > 0) {
    logger.warn({ invalidCount: invalid.length }, "Ignorerte ugyldige upcoming_events");
  }

  return {
    data: valid,
    meta: response.meta,
  };
}
/**
 * Henter planner items for brukeren innenfor et datointervall.
 *
 * Planner API returnerer assignments/quizzes/discussions/announcements etc. i ett kall
 * (typisk få kall med paginering, i stedet for N kall per kurs).
 */
export async function fetchPlannerItems(
  canvasToken: string | null | undefined,
  query: {
    start_date?: string;
    end_date?: string;
    maxPages?: number;
    baseUrl?: string;
  }
) {
  const token = requireToken(canvasToken);
  const queryParams: Record<string, string | number | boolean> = { per_page: PAGE_SIZE.DEFAULT };
  if (query.start_date) queryParams.start_date = query.start_date;
  if (query.end_date) queryParams.end_date = query.end_date;
  const response = await hentCanvasData<unknown[]>("/api/v1/planner/items", {
    token,
    baseUrl: query.baseUrl,
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

  if (invalid.length > 0) {
    logger.warn({ invalidCount: invalid.length }, "Ignorerte ugyldige planner items");
  }

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
    maxPages?: number;
    baseUrl?: string;
  }
) {
  const token = requireToken(canvasToken);
  const queryParams: Record<string, string | number | boolean | string[]> = {
    per_page: PAGE_SIZE.DEFAULT,
  };
  if (options.contextCodes.length > 0) {
    queryParams["context_codes[]"] = options.contextCodes;
  }
  if (options.startDate) queryParams.start_date = options.startDate;
  if (options.endDate) queryParams.end_date = options.endDate;
  if (options.type) queryParams.type = options.type;
  const maxPages = options.maxPages ?? MAX_PAGES.CALENDAR;
  const response = await hentCanvasData<unknown[]>("/api/v1/calendar_events", {
    token,
    baseUrl: options.baseUrl,
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
const EnrollmentDataSchema = z
  .object({
    course_id: z.number(),
    course_section_id: z.preprocess(
      (value) => (value == null ? undefined : value),
      z.number().optional(),
    ),
  })
  .loose();

export type EnrollmentData = z.infer<typeof EnrollmentDataSchema>;
/**
 * Hent brukerens enrollments med section_id
 * Brukes for å bygge course_section context codes for calendar_events
 * og for å mappe section_id -> course_id for TimeEdit-hendelser
 */
export async function fetchUserEnrollments(canvasToken?: string | null, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/users/self/enrollments", {
    token,
    baseUrl,
    queryParams: {
      per_page: PAGE_SIZE.DEFAULT,
      state: ["active", "invited", "current_and_future"],
    },
    cacheTtl: CACHE_TTL.COURSES,
  });
  const enrollments: EnrollmentData[] = [];
  let invalidCount = 0;

  response.data.forEach((item) => {
    const parsed = EnrollmentDataSchema.safeParse(item);
    if (parsed.success) {
      enrollments.push(parsed.data);
    } else {
      invalidCount++;
    }
  });

  if (invalidCount > 0) {
    logger.warn({ invalidCount }, "Ignorerte ugyldige enrollments fra Canvas");
  }

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
    if (typeof enrollment.course_section_id === "number") {
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
export async function fetchModules(canvasToken: string | null | undefined, courseId: number, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/modules`,
    {
      token,
      baseUrl,
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
  moduleId: number,
  baseUrl?: string
) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/modules/${moduleId}/items`,
    {
      token,
      baseUrl,
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
  itemId: number,
  baseUrl?: string
) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(
    `/api/v1/courses/${courseId}/modules/${moduleId}/items/${itemId}`,
    {
      token,
      baseUrl,
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
export async function fetchFileMetadata(canvasToken: string | null | undefined, fileId: number, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(`/api/v1/files/${fileId}`, {
    token,
    baseUrl,
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
  pageId: string,
  baseUrl?: string
) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(
    `/api/v1/courses/${courseId}/pages/${pageId}`,
    {
      token,
      baseUrl,
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
  topicId: number,
  baseUrl?: string
) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(
    `/api/v1/courses/${courseId}/discussion_topics/${topicId}`,
    {
      token,
      baseUrl,
      cacheTtl: CACHE_TTL.DISCUSSIONS,
    }
  );
  return {
    data: CanvasDiscussionTopicSchema.parse(response.data),
    meta: response.meta,
  };
}

// Hent alle filer i et kurs (øverste nivå)
export async function fetchFiles(canvasToken: string | null | undefined, courseId: number, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/files`,
    {
      token,
      baseUrl,
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
export async function fetchPages(canvasToken: string | null | undefined, courseId: number, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/pages`,
    {
      token,
      baseUrl,
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
export async function fetchFrontPage(canvasToken: string | null | undefined, courseId: number, baseUrl?: string) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(
    `/api/v1/courses/${courseId}/front_page`,
    {
      token,
      baseUrl,
      cacheTtl: CACHE_TTL.PAGES,
    }
  );
  return {
    data: CanvasPageSchema.parse(response.data),
    meta: response.meta,
  };
}

/**
 * Laster ned en fil fra Canvas og returnerer rå Buffer.
 * Returnerer null dersom filen er for stor eller nedlasting feiler.
 */
export async function fetchFileContent(
  canvasToken: string | null | undefined,
  file: { id: number; filename: string; url: string; size: number },
  baseUrl?: string,
): Promise<Buffer | null> {
  if (file.size > MAX_FILE_SIZE) {
    logger.info({ fileId: file.id, filename: file.filename, size: file.size }, "Fil for stor for KI-kontekst");
    return null;
  }

  try {
    const token = requireToken(canvasToken);
    const { data: freshFile } = await fetchFileMetadata(token, file.id, baseUrl);
    const downloadUrl = getValidatedCanvasDownloadUrl(freshFile.url, baseUrl);

    if (!downloadUrl) {
      logger.warn(
        { fileId: file.id, filename: file.filename },
        "Ingen gyldig download-URL for fil",
      );
      return null;
    }

    const response = await fetch(downloadUrl, {
      headers: buildCanvasAuthHeaders(token),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      logger.warn(
        { fileId: file.id, filename: file.filename, status: response.status },
        "Kunne ikke laste ned fil fra Canvas",
      );
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.warn(
      { err: error, fileId: file.id, filename: file.filename },
      "Feil ved nedlasting av fil fra Canvas",
    );
    return null;
  }
}

/**
 * Laster ned en PDF-fil fra Canvas og ekstraherer tekst med samme parser som
 * brukes for dokumentopplasting. Dette gir OCR-fallback for skannede PDF-er og
 * beholder mer innhold for chunking og indeksering.
 * Returnerer null dersom filen ikke er PDF, er for stor, eller parsing feiler.
 */
export async function fetchPdfContent(
  canvasToken: string | null | undefined,
  file: { id: number; filename: string; url: string; size: number; mime_type?: string },
  baseUrl?: string,
  options?: { syncMode?: boolean },
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
    const token = requireToken(canvasToken);
    const { data: freshFile } = await fetchFileMetadata(token, file.id, baseUrl);
    const downloadUrl = getValidatedCanvasDownloadUrl(freshFile.url, baseUrl);

    if (!downloadUrl) {
      logger.warn(
        { fileId: file.id, filename: file.filename },
        "Ingen gyldig download-URL for PDF",
      );
      return null;
    }

    const response = await fetch(downloadUrl, {
      headers: buildCanvasAuthHeaders(token),
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
    const parsed = await parseDocument(
      buffer,
      "application/pdf",
      freshFile.filename ?? file.filename,
      options?.syncMode ? { syncMode: true } : undefined,
    );

    if (!parsed.success || parsed.text.trim().length === 0) {
      logger.info(
        { fileId: file.id, filename: file.filename, error: parsed.error },
        "PDF inneholdt ingen lesbar tekst",
      );
      return null;
    }

    logger.info(
      {
        fileId: file.id,
        filename: file.filename,
        pages: parsed.pages,
        textLength: parsed.text.length,
        truncated: parsed.truncated,
      },
      "PDF-tekst ekstrahert for KI-kontekst",
    );

    return { content: parsed.text, truncated: parsed.truncated };
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
export async function warmCanvasCache(canvasToken: string, baseUrl?: string): Promise<void> {
  try {
    logger.info("Starter cache warming for Canvas-data");
    await Promise.allSettled([
      fetchCourses(canvasToken, baseUrl),
      fetchAllAnnouncements(canvasToken, baseUrl),
      fetchTodo(canvasToken, baseUrl),
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
  options: { startDate?: string; endDate?: string; baseUrl?: string } = {}
): Promise<{ data: NormalizedCalendarEvent[]; meta: ForelesningerMeta }> {
  const token = requireToken(canvasToken);
  const baseUrl = options.baseUrl;
  const [coursesResult, enrollmentsResult] = await Promise.all([
    fetchCourses(token, baseUrl),
    fetchUserEnrollments(token, baseUrl),
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
    baseUrl,
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
