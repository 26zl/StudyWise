import { test, expect } from "@playwright/test";

/**
 * API-sikkerhetstester.
 * Verifiserer CORS, CSRF, rate limiting og input-validering
 * uten å kreve autentisering.
 */

const BACKEND = "http://localhost:4000";

test.describe("API-sikkerhet — CORS", () => {
  test("CORS blokkerer ukjent origin", async ({ request }) => {
    const res = await request.fetch(`${BACKEND}/health`, {
      headers: { Origin: "https://evil-site.com" },
    });
    // Bør IKKE ha access-control-allow-origin for ukjent origin
    const acaoHeader = res.headers()["access-control-allow-origin"];
    expect(acaoHeader).not.toBe("https://evil-site.com");
  });

  test("CORS tillater localhost i dev", async ({ request }) => {
    const res = await request.fetch(`${BACKEND}/health`, {
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.status()).toBe(200);
  });
});

test.describe("API-sikkerhet — CSRF", () => {
  test("POST uten CSRF-header returnerer 403", async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/ki/chat`, {
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
        // Mangler x-studywise-csrf header
      },
      data: { messages: [{ role: "user", content: "test" }] },
    });
    // Bør blokkeres av CSRF eller auth (401/403)
    expect([401, 403]).toContain(res.status());
  });
});

test.describe("API-sikkerhet — input-validering", () => {
  test("ugyldig JSON-body returnerer 400", async ({ request }) => {
    const res = await request.fetch(`${BACKEND}/api/ki/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-studywise-csrf": "1",
      },
      data: "dette er ikke json{{{",
    });
    // Enten 400 (bad request) eller 401 (auth først)
    expect([400, 401]).toContain(res.status());
  });

  test("username-check med ugyldig input returnerer 400", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/user/username/check?username=`);
    expect([400, 422]).toContain(res.status());
  });

  test("username-check med gyldig input returnerer 200", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/user/username/check?username=testuser123`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("available");
  });
});

test.describe("API-sikkerhet — admin-ruter", () => {
  test("admin-ruter krever auth", async ({ request }) => {
    const adminRuter = [
      "/api/admin/statistikk",
      "/api/admin/brukere",
      "/api/admin/audit",
      "/api/admin/queues/overview",
    ];

    for (const rute of adminRuter) {
      const res = await request.get(`${BACKEND}${rute}`);
      expect(res.status(), `${rute} bør kreve auth`).toBe(401);
    }
  });

  test("admin POST-ruter krever auth", async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/admin/maintenance/backfill-fulltext`, {
      headers: {
        "Content-Type": "application/json",
        "x-studywise-csrf": "1",
      },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("API-sikkerhet — KI-ruter", () => {
  test("KI-endepunkter krever auth", async ({ request }) => {
    const kiRuter = [
      { method: "GET" as const, path: "/api/ki/models" },
      { method: "GET" as const, path: "/api/ki/chat/history?limit=10&page=1" },
      { method: "POST" as const, path: "/api/ki/chat" },
      { method: "POST" as const, path: "/api/ki/analyze-document" },
      { method: "POST" as const, path: "/api/ki/summarize" },
      { method: "POST" as const, path: "/api/ki/export" },
      { method: "POST" as const, path: "/api/ki/weekly-plan/generate" },
    ];

    for (const { method, path } of kiRuter) {
      const res = method === "GET"
        ? await request.get(`${BACKEND}${path}`)
        : await request.post(`${BACKEND}${path}`, {
            headers: { "Content-Type": "application/json", "x-studywise-csrf": "1" },
            data: {},
          });
      expect(res.status(), `${method} ${path} bør kreve auth`).toBe(401);
    }
  });
});

test.describe("API-sikkerhet — Canvas-ruter", () => {
  test("Canvas-endepunkter krever auth", async ({ request }) => {
    const canvasRuter = [
      "/api/canvas/whoami",
      "/api/canvas/emner",
      "/api/canvas/kalender",
      "/api/canvas/users/self/todo",
      "/api/canvas/users/self/upcoming_events",
      "/api/canvas/announcements",
      "/api/canvas/emner/metadata",
    ];

    for (const rute of canvasRuter) {
      const res = await request.get(`${BACKEND}${rute}`);
      expect(res.status(), `${rute} bør kreve auth`).toBe(401);
    }
  });
});

test.describe("API-sikkerhet — Quiz og Flashcards", () => {
  test("quiz-generering krever auth", async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/quiz/generate`, {
      headers: { "Content-Type": "application/json", "x-studywise-csrf": "1" },
      data: { courseId: 12345 },
    });
    expect(res.status()).toBe(401);
  });

  test("flashcard-generering krever auth", async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/flashcards/generate`, {
      headers: { "Content-Type": "application/json", "x-studywise-csrf": "1" },
      data: { courseId: 12345 },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("API-sikkerhet — oppgaveoppsplitting", () => {
  test("task-breakdown krever auth", async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/ki/task-breakdown/99999/generate`, {
      headers: { "Content-Type": "application/json", "x-studywise-csrf": "1" },
      data: {},
    });
    expect(res.status()).toBe(401);
  });

  test("task-breakdown GET krever auth", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/ki/task-breakdown/99999`);
    expect(res.status()).toBe(401);
  });
});

test.describe("API-sikkerhet — bruker-ruter", () => {
  test("profiloppdatering krever auth", async ({ request }) => {
    const res = await request.put(`${BACKEND}/api/user/profile`, {
      headers: { "Content-Type": "application/json", "x-studywise-csrf": "1" },
      data: { firstName: "Test" },
    });
    expect(res.status()).toBe(401);
  });

  test("preferanseoppdatering krever auth", async ({ request }) => {
    const res = await request.put(`${BACKEND}/api/user/preferences`, {
      headers: { "Content-Type": "application/json", "x-studywise-csrf": "1" },
      data: { language: "en" },
    });
    expect(res.status()).toBe(401);
  });

  test("kontosletting krever auth", async ({ request }) => {
    const res = await request.delete(`${BACKEND}/api/user/account`, {
      headers: { "x-studywise-csrf": "1" },
    });
    expect(res.status()).toBe(401);
  });

  test("push-config krever auth", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/user/push-client-config`);
    expect(res.status()).toBe(401);
  });

  test("Notion-status krever auth", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/user/notion`);
    expect(res.status()).toBe(401);
  });
});

test.describe("API-sikkerhet — delt chat", () => {
  test("ugyldig share-ID returnerer 404", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/ki/share/000000000000000000000000`);
    expect(res.status()).toBe(404);
  });

  test("ikke-ObjectId share-ID returnerer 404", async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/ki/share/not-valid`);
    expect(res.status()).toBe(404);
  });
});
