/**
 * Tester for calendar-modulen – kalenderkilder og kalender-elementer.
 */

import { describe, it, expect } from "vitest";
import { CalendarSourceSchema, CalendarItemSchema } from "../calendar.js";

// ─── CalendarSourceSchema ───────────────────────────────────────────────────

describe("CalendarSourceSchema", () => {
  it("godtar 'assignment'", () => {
    expect(CalendarSourceSchema.safeParse("assignment").success).toBe(true);
  });

  it("godtar 'event'", () => {
    expect(CalendarSourceSchema.safeParse("event").success).toBe(true);
  });

  it("godtar 'todo'", () => {
    expect(CalendarSourceSchema.safeParse("todo").success).toBe(true);
  });

  it("godtar 'timetable'", () => {
    expect(CalendarSourceSchema.safeParse("timetable").success).toBe(true);
  });

  it("avviser ugyldig kilde", () => {
    expect(CalendarSourceSchema.safeParse("meeting").success).toBe(false);
    expect(CalendarSourceSchema.safeParse("").success).toBe(false);
  });
});

// ─── CalendarItemSchema ─────────────────────────────────────────────────────

describe("CalendarItemSchema", () => {
  it("godtar gyldig kalender-element", () => {
    const resultat = CalendarItemSchema.safeParse({
      id: "assign-123",
      title: "Innlevering 1",
      due_at: "2024-12-01T23:59:00Z",
      source: "assignment",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar element med alle valgfrie felter", () => {
    const resultat = CalendarItemSchema.safeParse({
      id: "event-42",
      title: "Forelesning",
      due_at: "2024-09-01T10:00:00Z",
      end_at: "2024-09-01T12:00:00Z",
      course_id: 123,
      course_code: "PROG101",
      course_name: "Programmering",
      source: "event",
      html_url: "https://canvas.example.com/event/42",
      raw_type: "calendar_event",
      location: "Rom A101",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser manglende id", () => {
    expect(
      CalendarItemSchema.safeParse({
        title: "Test",
        due_at: "2024-01-01",
        source: "event",
      }).success,
    ).toBe(false);
  });

  it("avviser manglende title", () => {
    expect(
      CalendarItemSchema.safeParse({
        id: "1",
        due_at: "2024-01-01",
        source: "event",
      }).success,
    ).toBe(false);
  });

  it("avviser manglende due_at", () => {
    expect(
      CalendarItemSchema.safeParse({
        id: "1",
        title: "Test",
        source: "event",
      }).success,
    ).toBe(false);
  });

  it("avviser manglende source", () => {
    expect(
      CalendarItemSchema.safeParse({
        id: "1",
        title: "Test",
        due_at: "2024-01-01",
      }).success,
    ).toBe(false);
  });

  it("avviser ugyldig source", () => {
    expect(
      CalendarItemSchema.safeParse({
        id: "1",
        title: "Test",
        due_at: "2024-01-01",
        source: "ugyldig",
      }).success,
    ).toBe(false);
  });

  it("godtar null end_at", () => {
    const resultat = CalendarItemSchema.safeParse({
      id: "1",
      title: "Test",
      due_at: "2024-01-01",
      source: "timetable",
      end_at: null,
    });
    expect(resultat.success).toBe(true);
  });
});
