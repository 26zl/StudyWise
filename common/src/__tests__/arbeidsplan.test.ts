/**
 * Tester for arbeidsplan-modulen – studieblokker, ukeplan og progresjon.
 */

import { describe, it, expect } from "vitest";
import {
  StudyBlockSchema,
  CreateArbeidsplanSchema,
  UKEDAGER,
  ArbeidsplanProgressSchema,
} from "../arbeidsplan.js";

// UKEDAGER
describe("UKEDAGER", () => {
  it("inneholder 7 dager", () => {
    expect(UKEDAGER).toHaveLength(7);
  });

  it("inneholder norske dagnavn i riktig rekkefølge", () => {
    expect(UKEDAGER).toEqual([
      "Mandag",
      "Tirsdag",
      "Onsdag",
      "Torsdag",
      "Fredag",
      "Lørdag",
      "Søndag",
    ]);
  });
});

// StudyBlockSchema
describe("StudyBlockSchema", () => {
  it("godtar gyldig studieblokk", () => {
    const resultat = StudyBlockSchema.safeParse({
      day: "Mandag",
      timeSlot: "09:00-11:00",
      task: "Les kapittel 5",
      duration: "2 timer",
      priority: "high",
      courseName: "Programmering 101",
      completed: false,
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar alle ukedager", () => {
    for (const dag of UKEDAGER) {
      const resultat = StudyBlockSchema.safeParse({
        day: dag,
        timeSlot: "10:00",
        task: "Studer",
        duration: "1t",
        priority: "medium",
        courseName: "Kurs",
        completed: false,
      });
      expect(resultat.success).toBe(true);
    }
  });

  it("avviser ugyldig prioritet", () => {
    expect(
      StudyBlockSchema.safeParse({
        day: "Mandag",
        timeSlot: "09:00",
        task: "Test",
        duration: "1t",
        priority: "critical",
        courseName: "Kurs",
        completed: false,
      }).success,
    ).toBe(false);
  });

  it("godtar alle gyldige prioriteter", () => {
    for (const prioritet of ["high", "medium", "low"]) {
      const resultat = StudyBlockSchema.safeParse({
        day: "Tirsdag",
        timeSlot: "10:00",
        task: "Oppgave",
        duration: "1t",
        priority: prioritet,
        courseName: "Kurs",
        completed: false,
      });
      expect(resultat.success).toBe(true);
    }
  });

  it("avviser ugyldig dag", () => {
    expect(
      StudyBlockSchema.safeParse({
        day: "Monday",
        timeSlot: "10:00",
        task: "Test",
        duration: "1t",
        priority: "low",
        courseName: "Kurs",
        completed: false,
      }).success,
    ).toBe(false);
  });

  it("avviser tom task", () => {
    expect(
      StudyBlockSchema.safeParse({
        day: "Mandag",
        timeSlot: "10:00",
        task: "",
        duration: "1t",
        priority: "low",
        courseName: "Kurs",
        completed: false,
      }).success,
    ).toBe(false);
  });

  it("bruker false som standard for completed", () => {
    const resultat = StudyBlockSchema.safeParse({
      day: "Mandag",
      timeSlot: "09:00",
      task: "Les",
      duration: "1t",
      priority: "low",
      courseName: "Kurs",
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.completed).toBe(false);
  });

  it("godtar valgfri assignmentId", () => {
    const resultat = StudyBlockSchema.safeParse({
      day: "Onsdag",
      timeSlot: "10:00",
      task: "Innlevering",
      duration: "2t",
      priority: "high",
      courseName: "Kurs",
      completed: false,
      assignmentId: "12345",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser completedAt når blokken ikke er fullført", () => {
    const resultat = StudyBlockSchema.safeParse({
      day: "Torsdag",
      timeSlot: "12:00",
      task: "Les notater",
      duration: "1t",
      priority: "medium",
      courseName: "Kurs",
      completed: false,
      completedAt: "2026-04-09T12:00:00.000Z",
    });
    expect(resultat.success).toBe(false);
  });

  it("godtar completedAt når blokken er fullført", () => {
    const resultat = StudyBlockSchema.safeParse({
      day: "Fredag",
      timeSlot: "14:00",
      task: "Repeter",
      duration: "1t",
      priority: "low",
      courseName: "Kurs",
      completed: true,
      completedAt: "2026-04-09T12:00:00.000Z",
    });
    expect(resultat.success).toBe(true);
  });
});

// CreateArbeidsplanSchema
describe("CreateArbeidsplanSchema", () => {
  it("godtar gyldig arbeidsplan", () => {
    const resultat = CreateArbeidsplanSchema.safeParse({
      week: "Uke 1, 2024",
      weekNumber: 1,
      year: 2024,
      blocks: [
        {
          day: "Mandag",
          timeSlot: "09:00-11:00",
          task: "Studer",
          duration: "2t",
          priority: "medium",
          courseName: "Kurs",
          completed: false,
        },
      ],
      totalHours: 2,
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar tom blocks-array", () => {
    const resultat = CreateArbeidsplanSchema.safeParse({
      week: "Uke 1",
      weekNumber: 1,
      year: 2024,
      blocks: [],
      totalHours: 0,
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser mer enn 200 blokker", () => {
    const blokker = Array.from({ length: 201 }, () => ({
      day: "Mandag" as const,
      timeSlot: "09:00",
      task: "Studer",
      duration: "1t",
      priority: "low" as const,
      courseName: "Kurs",
      completed: false,
    }));
    expect(
      CreateArbeidsplanSchema.safeParse({
        week: "Uke 1",
        weekNumber: 1,
        year: 2024,
        blocks: blokker,
        totalHours: 201,
      }).success,
    ).toBe(false);
  });

  it("avviser weekNumber under 1", () => {
    expect(
      CreateArbeidsplanSchema.safeParse({
        week: "Uke 0",
        weekNumber: 0,
        year: 2024,
        blocks: [],
        totalHours: 0,
      }).success,
    ).toBe(false);
  });

  it("avviser weekNumber over 53", () => {
    expect(
      CreateArbeidsplanSchema.safeParse({
        week: "Uke 54",
        weekNumber: 54,
        year: 2024,
        blocks: [],
        totalHours: 0,
      }).success,
    ).toBe(false);
  });

  it("avviser year under 2020", () => {
    expect(
      CreateArbeidsplanSchema.safeParse({
        week: "Uke 1",
        weekNumber: 1,
        year: 2019,
        blocks: [],
        totalHours: 0,
      }).success,
    ).toBe(false);
  });
});

// ArbeidsplanProgressSchema
describe("ArbeidsplanProgressSchema", () => {
  it("godtar gyldig progresjon", () => {
    const resultat = ArbeidsplanProgressSchema.safeParse({
      totalBlocks: 10,
      completedBlocks: 5,
      percentage: 50,
      totalHours: 20,
      completedHours: 10,
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar 0% progresjon", () => {
    const resultat = ArbeidsplanProgressSchema.safeParse({
      totalBlocks: 0,
      completedBlocks: 0,
      percentage: 0,
      totalHours: 0,
      completedHours: 0,
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar 100% progresjon", () => {
    const resultat = ArbeidsplanProgressSchema.safeParse({
      totalBlocks: 5,
      completedBlocks: 5,
      percentage: 100,
      totalHours: 10,
      completedHours: 10,
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser prosentandel over 100", () => {
    expect(
      ArbeidsplanProgressSchema.safeParse({
        totalBlocks: 5,
        completedBlocks: 5,
        percentage: 101,
        totalHours: 10,
        completedHours: 10,
      }).success,
    ).toBe(false);
  });

  it("avviser negative verdier", () => {
    expect(
      ArbeidsplanProgressSchema.safeParse({
        totalBlocks: -1,
        completedBlocks: 0,
        percentage: 0,
        totalHours: 0,
        completedHours: 0,
      }).success,
    ).toBe(false);
  });
});
