/*
 * Delte Canvas service-funksjoner for backend.
 * Inneholder typed fetch-hjelpere som bruker hentCanvasData og Zod-validering.
 * Kan gjenbrukes av både Express-ruter (canvas.ts) og KI-ruter (ki.ts).
 */
import { z } from "zod";
import {
  hentCanvasData,
  CACHE_TTL,
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
export async function fetchCourses(canvasToken?: string | null): Promise<
  CanvasResponseWithMeta<CanvasCourse[]>
> {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>("/api/v1/courses", {
    token,
    queryParams: { enrollment_state: "active", per_page: 100 },
    cacheTtl: CACHE_TTL.COURSES,
  });
  return {
    data: z.array(CanvasCourseSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent spesifikt kurs
export async function fetchCourse(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown>(`/api/v1/courses/${courseId}`, {
    token,
    cacheTtl: CACHE_TTL.COURSES,
  });
  return {
    data: CanvasCourseSchema.parse(response.data),
    meta: response.meta,
  };
}

// Hent oppgaver for et kurs
export async function fetchAssignments(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/assignments`,
    {
      token,
      queryParams: { per_page: 100 },
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
      queryParams: { only_announcements: true, per_page: 50 },
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
    queryParams: { context_codes: contextCodes, active_only: true, per_page: 50 },
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
  return {
    data: z.array(CanvasCalendarEventSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent planleggingsobjekter for brukeren innenfor et datointervall
export async function fetchPlannerItems(
  canvasToken: string | null | undefined,
  query: { start_date?: string; end_date?: string }
) {
  const token = requireToken(canvasToken);
  const queryParams: Record<string, string | number | boolean> = { per_page: 100 };
  if (query.start_date) queryParams.start_date = query.start_date;
  if (query.end_date) queryParams.end_date = query.end_date;
  const response = await hentCanvasData<unknown[]>("/api/v1/planner/items", {
    token,
    queryParams,
    cacheTtl: CACHE_TTL.EVENTS,
  });
  return {
    data: z.array(CanvasPlannerItemSchema).parse(response.data),
    meta: response.meta,
  };
}

// Hent moduler for et kurs
export async function fetchModules(canvasToken: string | null | undefined, courseId: number) {
  const token = requireToken(canvasToken);
  const response = await hentCanvasData<unknown[]>(
    `/api/v1/courses/${courseId}/modules`,
    {
      token,
      queryParams: { include: ["items"], per_page: 50 },
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
      queryParams: { "include[]": "content_details", per_page: 100 },
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
      queryParams: { per_page: 100 },
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
      queryParams: { per_page: 100 },
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