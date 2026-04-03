/**
 * Tester for canvas-modulen – Canvas API-schemas og hjelpefunksjoner.
 */

import { describe, it, expect } from "vitest";
import {
  CanvasCourseSchema,
  CanvasAssignmentSchema,
  isCanvasAssignmentSubmitted,
  CanvasCalendarEventSchema,
  CanvasFileSchema,
} from "../canvas.js";

// ─── CanvasCourseSchema ─────────────────────────────────────────────────────

describe("CanvasCourseSchema", () => {
  it("godtar gyldig kursobjekt", () => {
    const resultat = CanvasCourseSchema.safeParse({
      id: 12345,
      name: "Programmering 101",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar fullt kursobjekt med alle valgfrie felter", () => {
    const resultat = CanvasCourseSchema.safeParse({
      id: 12345,
      name: "Programmering 101",
      course_code: "PROG101",
      enrollment_term_id: 1,
      workflow_state: "available",
      syllabus_body: "<p>Velkommen</p>",
      public_description: "Introduksjon til programmering",
      default_view: "modules",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser manglende id", () => {
    expect(CanvasCourseSchema.safeParse({ name: "Kurs" }).success).toBe(false);
  });

  it("avviser manglende name", () => {
    expect(CanvasCourseSchema.safeParse({ id: 123 }).success).toBe(false);
  });

  it("avviser ugyldig id-type", () => {
    expect(CanvasCourseSchema.safeParse({ id: "abc", name: "Kurs" }).success).toBe(false);
  });
});

// ─── CanvasAssignmentSchema ─────────────────────────────────────────────────

describe("CanvasAssignmentSchema", () => {
  it("godtar gyldig oppgave", () => {
    const resultat = CanvasAssignmentSchema.safeParse({
      id: 1,
      name: "Innlevering 1",
      due_at: "2024-12-01T23:59:00Z",
      points_possible: 100,
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar null due_at", () => {
    const resultat = CanvasAssignmentSchema.safeParse({
      id: 1,
      name: "Innlevering",
      due_at: null,
      points_possible: null,
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar med submission-objekt", () => {
    const resultat = CanvasAssignmentSchema.safeParse({
      id: 1,
      name: "Oppgave",
      due_at: null,
      points_possible: 50,
      submission: {
        workflow_state: "submitted",
        submitted_at: "2024-11-01T10:00:00Z",
      },
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser manglende påkrevde felter", () => {
    expect(CanvasAssignmentSchema.safeParse({ id: 1 }).success).toBe(false);
  });
});

// ─── isCanvasAssignmentSubmitted ────────────────────────────────────────────

describe("isCanvasAssignmentSubmitted", () => {
  it("returnerer true for 'submitted'", () => {
    expect(
      isCanvasAssignmentSubmitted({ submission: { workflow_state: "submitted" } }),
    ).toBe(true);
  });

  it("returnerer true for 'graded'", () => {
    expect(
      isCanvasAssignmentSubmitted({ submission: { workflow_state: "graded" } }),
    ).toBe(true);
  });

  it("returnerer true for 'pending_review'", () => {
    expect(
      isCanvasAssignmentSubmitted({ submission: { workflow_state: "pending_review" } }),
    ).toBe(true);
  });

  it("returnerer false for 'unsubmitted'", () => {
    expect(
      isCanvasAssignmentSubmitted({ submission: { workflow_state: "unsubmitted" } }),
    ).toBe(false);
  });

  it("returnerer true når submitted_at er satt (uansett workflow_state)", () => {
    expect(
      isCanvasAssignmentSubmitted({
        submission: {
          workflow_state: "unsubmitted",
          submitted_at: "2024-01-01T00:00:00Z",
        },
      }),
    ).toBe(true);
  });

  it("returnerer false for null submission", () => {
    expect(isCanvasAssignmentSubmitted({ submission: null })).toBe(false);
  });

  it("returnerer false for undefined submission", () => {
    expect(isCanvasAssignmentSubmitted({})).toBe(false);
  });

  it("returnerer false for null workflow_state uten submitted_at", () => {
    expect(
      isCanvasAssignmentSubmitted({ submission: { workflow_state: null } }),
    ).toBe(false);
  });
});

// ─── CanvasCalendarEventSchema ──────────────────────────────────────────────

describe("CanvasCalendarEventSchema", () => {
  it("godtar gyldig kalenderhendelse", () => {
    const resultat = CanvasCalendarEventSchema.safeParse({
      id: 42,
      title: "Forelesning",
      start_at: "2024-09-01T10:00:00Z",
      end_at: "2024-09-01T12:00:00Z",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar hendelse med valgfri location og rrule", () => {
    const resultat = CanvasCalendarEventSchema.safeParse({
      id: 42,
      title: "Forelesning",
      start_at: "2024-09-01T10:00:00Z",
      end_at: null,
      location_name: "Rom A101",
      rrule: "FREQ=WEEKLY;COUNT=10",
    });
    expect(resultat.success).toBe(true);
  });

  it("koerser string-ID til number", () => {
    const resultat = CanvasCalendarEventSchema.safeParse({
      id: "123",
      title: "Test",
      start_at: null,
      end_at: null,
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.id).toBe(123);
  });

  it("tillater ukjente felt (loose schema)", () => {
    const resultat = CanvasCalendarEventSchema.safeParse({
      id: 1,
      title: "Test",
      start_at: null,
      end_at: null,
      ukjent_felt: "verdi",
    });
    expect(resultat.success).toBe(true);
  });
});

// ─── CanvasFileSchema ───────────────────────────────────────────────────────

describe("CanvasFileSchema", () => {
  it("godtar gyldig filobjekt", () => {
    const resultat = CanvasFileSchema.safeParse({
      id: 1,
      display_name: "forelesning.pdf",
      filename: "forelesning.pdf",
      url: "https://canvas.example.com/files/1/download",
      size: 1024,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar valgfri mime_class og mime_type", () => {
    const resultat = CanvasFileSchema.safeParse({
      id: 2,
      display_name: "bilde.png",
      filename: "bilde.png",
      url: "https://canvas.example.com/files/2/download",
      size: 2048,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      mime_class: "image",
      mime_type: "image/png",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser manglende påkrevde felter", () => {
    expect(
      CanvasFileSchema.safeParse({ id: 1, display_name: "test.pdf" }).success,
    ).toBe(false);
  });
});
