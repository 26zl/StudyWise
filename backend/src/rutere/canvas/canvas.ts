/*
* Dette er bare en foreløpig implementering av Canvas API-integrasjon for testing mot Canvas LMS og dems apier. Skal totalt bygges om senere.
* Kun ment for testing og demonstrasjon av Canvas API integrasjon, skal ikke se slik ut.
*/
import { Router } from "express";
import { z } from "zod";
import {
  CanvasUserSchema,
  CanvasCourseSchema,
  CanvasAnnouncementSchema,
} from "common/canvas";

const router = Router();

// Canvas configuration - read from env at runtime
const getCanvasConfig = () => ({
  token: process.env.CANVAS_TOKEN,
  baseUrl: process.env.CANVAS_BASE_URL || "https://usn.instructure.com"
});

// Canvas fetch funksjon med paginering og timeout
interface CanvasFetchOptions {
  queryParams?: Record<string, string | number | boolean | string[]>;
  timeout?: number;
  maxPages?: number;
}

interface CanvasResponse<T> {
  data: T;
  meta?: {
    pagesFetched: number;
    itemsCount: number;
  };
}

async function canvasFetch<T>(
  endpoint: string,
  options: CanvasFetchOptions = {}
): Promise<CanvasResponse<T>> {
  const { queryParams, timeout = 10000, maxPages = 5 } = options;
  const { token, baseUrl } = getCanvasConfig();

  if (!token) {
    throw new Error("CANVAS_TOKEN er ikke konfigurert");
  }

  // Bygg URL med query params
  const url = new URL(`${baseUrl}${endpoint}`);
  if (queryParams) {
    Object.entries(queryParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        // Håndter arrays - append hver verdi separat med samme key
        value.forEach((item) => {
          url.searchParams.append(`${key}[]`, String(item));
        });
      } else {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // Hent alle sider hvis paginering
  try {
    const allItems: unknown[] = [];
    let currentUrl: string | null = url.toString();
    let pagesFetched = 0;

    while (currentUrl && pagesFetched < maxPages) {
      const response = await fetch(currentUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Canvas API feil (${response.status}): ${errorText || response.statusText}`
        );
      }

      const data = await response.json();
      pagesFetched++;

      // Håndter både array og enkelt-objekt
      if (Array.isArray(data)) {
        allItems.push(...data);
      } else {
        clearTimeout(timeoutId);
        return { data: data as T };
      }

      // Sjekk for neste side via Link header
      const linkHeader = response.headers.get("Link");
      currentUrl = parseLinkHeader(linkHeader);

      if (!currentUrl) break;
    }

    clearTimeout(timeoutId);

    return {
      data: allItems as T,
      meta: {
        pagesFetched,
        itemsCount: allItems.length,
      },
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Canvas API timeout etter ${timeout}ms`);
    }

    throw error;
  }
}
// Hjelpefunksjon for å parse Link header
function parseLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  const links = linkHeader.split(",");
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }

  return null;
}

// Middleware, Sjekk Canvas token
function requireCanvasToken(_req: unknown, res: unknown, next: () => void) {
  const { token } = getCanvasConfig();
  if (!token) {
    const response = res as { status: (code: number) => { json: (data: unknown) => void } };
    return response.status(500).json({
      feil: "CANVAS_TOKEN er ikke konfigurert",
      melding: "Legg til CANVAS_TOKEN i backend/.env",
    });
  }
  next();
}

// Bruk middleware på alle ruter
router.use(requireCanvasToken);

// Endpoints
// GET /test - Test Canvas-tilkobling
router.get("/test", async (_req, res) => {
  const response = await canvasFetch<unknown>("/api/v1/users/self/profile");

  // Valider med Zod
  const bruker = CanvasUserSchema.parse(response.data);

  res.json({
    suksess: true,
    melding: "Canvas-tilkobling fungerer",
    bruker: {
      navn: bruker.name,
      epost: bruker.primary_email || null,
      id: bruker.id,
    },
  });
});

// GET /whoami - Minimal brukerinfo
router.get("/whoami", async (_req, res) => {
  const response = await canvasFetch<unknown>("/api/v1/users/self/profile");
  const bruker = CanvasUserSchema.parse(response.data);

  res.json({
    id: bruker.id,
    navn: bruker.name,
    epost: bruker.primary_email || null,
    locale: bruker.locale || "nb",
  });
});

// GET /emner - Hent aktive emner
router.get("/emner", async (_req, res) => {
  const response = await canvasFetch<unknown[]>("/api/v1/courses", {
    queryParams: { enrollment_state: "active", per_page: 100 },
  });

  // Valider hvert emne med Zod
  const emner = z.array(CanvasCourseSchema).parse(response.data);

  res.json({
    emner,
    meta: response.meta,
  });
});

// GET /emner/:courseId - Hent emne-detaljer
router.get("/emner/:courseId", async (req, res) => {
  const { courseId } = req.params;
  const courseIdNum = parseInt(courseId, 10);

  if (isNaN(courseIdNum)) {
    return res.status(400).json({
      feil: "Ugyldig courseId",
      melding: "courseId må være et tall",
    });
  }

  const response = await canvasFetch<unknown>(`/api/v1/courses/${courseIdNum}`);
  const emne = CanvasCourseSchema.parse(response.data);

  res.json(emne);
});

// GET /emner/:courseId/oppgaver - Hent oppgaver
router.get("/emner/:courseId/oppgaver", async (req, res) => {
  const { courseId } = req.params;
  const courseIdNum = parseInt(courseId, 10);

  if (isNaN(courseIdNum)) {
    return res.status(400).json({
      feil: "Ugyldig courseId",
    });
  }

  const AssignmentSchema = z.object({
    id: z.number(),
    name: z.string(),
    due_at: z.string().nullable(),
    points_possible: z.number().nullable(),
    html_url: z.string(),
  });

  const response = await canvasFetch<unknown[]>(
    `/api/v1/courses/${courseIdNum}/assignments`,
    { queryParams: { per_page: 100 } }
  );

  const oppgaver = z.array(AssignmentSchema).parse(response.data);

  res.json({
    oppgaver,
    meta: response.meta,
  });
});

// GET /emner/:courseId/announcements - Hent announcements for et emne
router.get("/emner/:courseId/announcements", async (req, res) => {
  const { courseId } = req.params;
  const courseIdNum = parseInt(courseId, 10);

  if (isNaN(courseIdNum)) {
    return res.status(400).json({
      feil: "Ugyldig courseId",
      melding: "courseId må være et tall",
    });
  }

  const response = await canvasFetch<unknown[]>(
    `/api/v1/courses/${courseIdNum}/discussion_topics`,
    {
      queryParams: {
        only_announcements: true,
        per_page: 50
      }
    }
  );

  const announcements = z.array(CanvasAnnouncementSchema).parse(response.data);

  res.json({
    announcements,
    meta: response.meta,
  });
});

// GET /announcements - Hent alle announcements fra alle aktive emner
router.get("/announcements", async (_req, res) => {
  // Først hent alle aktive emner
  const coursesResponse = await canvasFetch<unknown[]>("/api/v1/courses", {
    queryParams: { enrollment_state: "active", per_page: 100 },
  });

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

  const announcements = z.array(CanvasAnnouncementSchema).parse(response.data);

  res.json({
    announcements,
    meta: response.meta,
  });
});

// GET /planlegger - Hent studentens totale tidslinje (Alt som skjer)
router.get("/planlegger", async (req, res) => {
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

  res.json({
    items,
    meta: response.meta,
  });
});

// GET /smoke - Smoke test
router.get("/smoke", async (_req, res) => {
  const results: Array<{
    test: string;
    status: "OK" | "FEILET";
    melding?: string;
  }> = [];

  // Test 1: users/self/profile
  try {
    await canvasFetch("/api/v1/users/self/profile");
    results.push({ test: "users/self/profile", status: "OK" });
  } catch (error) {
    results.push({
      test: "users/self/profile",
      status: "FEILET",
      melding: error instanceof Error ? error.message : "Ukjent feil",
    });
  }

  // Test 2: courses
  let firstCourseId: number | null = null;
  try {
    const coursesResponse = await canvasFetch<Array<{ id: number }>>(
      "/api/v1/courses",
      { queryParams: { enrollment_state: "active", per_page: 10 } }
    );

    if (coursesResponse.data.length === 0) {
      results.push({
        test: "courses (active)",
        status: "OK",
        melding: "Ingen aktive emner funnet",
      });
    } else {
      firstCourseId = coursesResponse.data[0].id;
      results.push({
        test: "courses (active)",
        status: "OK",
        melding: `Fant ${coursesResponse.data.length} emner`,
      });
    }
  } catch (error) {
    results.push({
      test: "courses (active)",
      status: "FEILET",
      melding: error instanceof Error ? error.message : "Ukjent feil",
    });
  }

  // Test 3: assignments (hvis vi har et course)
  if (firstCourseId) {
    try {
      const assignmentsResponse = await canvasFetch<unknown[]>(
        `/api/v1/courses/${firstCourseId}/assignments`,
        { queryParams: { per_page: 10 } }
      );
      results.push({
        test: `assignments (course ${firstCourseId})`,
        status: "OK",
        melding: `Fant ${assignmentsResponse.data.length} oppgaver`,
      });
    } catch (error) {
      results.push({
        test: `assignments (course ${firstCourseId})`,
        status: "FEILET",
        melding: error instanceof Error ? error.message : "Ukjent feil",
      });
    }
  }

  // Test 4: Planner items
  try {
    const plannerResponse = await canvasFetch<unknown[]>("/api/v1/planner/items", {
      queryParams: { per_page: 5 }
    });
    results.push({
      test: "planner/items",
      status: "OK",
      melding: `Fant ${plannerResponse.data.length} elementer i tidslinjen`,
    });
  } catch (error) {
    results.push({
      test: "planner/items",
      status: "FEILET",
      melding: error instanceof Error ? error.message : "Ukjent feil",
    });
  }

  const failedCount = results.filter((r) => r.status === "FEILET").length;
  const passedCount = results.filter((r) => r.status === "OK").length;

  res.json({
    sammendrag: {
      totalt: results.length,
      bestått: passedCount,
      feilet: failedCount,
      status: failedCount === 0 ? "ALLE OK" : "NOEN FEILET",
    },
    tester: results,
  });
});

// Global error handler for dette routeret
router.use((error: Error, _req: unknown, res: unknown, _next: unknown) => {
  console.error("Canvas API feil:", error);

  const response = res as { status: (code: number) => { json: (data: unknown) => void } };

  // Zod validering feil
  if (error.name === "ZodError") {
    return response.status(500).json({
      feil: "Validering feilet",
      melding: "Canvas returnerte uventet data-format",
      detaljer: error.message,
    });
  }

  // Canvas API feil
  response.status(500).json({
    feil: "Canvas API feil",
    melding: error.message,
  });
});

export default router;
