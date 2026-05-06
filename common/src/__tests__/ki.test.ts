/**
 * Tester for ki-modulen – KI chat, dokumentanalyse, oppgavedeling og oppsummering.
 */

import { describe, it, expect } from "vitest";
import {
  KIMessageSchema,
  KIChatRequestSchema,
  SubTaskSchema,
  TaskBreakdownGenerateRequestSchema,
  KIOppsummeringRequestSchema,
  QuizQuestionSchema,
  KI_MAX_MESSAGE_LENGTH_BACKEND,
  KI_MAX_MESSAGE_LENGTH_FRONTEND,
} from "../ki.js";

// KIMessageSchema
describe("KIMessageSchema", () => {
  it("godtar gyldig melding med role 'user'", () => {
    const resultat = KIMessageSchema.safeParse({
      role: "user",
      content: "Hei, hva er Canvas?",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar gyldig melding med role 'assistant'", () => {
    const resultat = KIMessageSchema.safeParse({
      role: "assistant",
      content: "Canvas er et LMS.",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser system-rolle (kun backend-intern, ikke del av kontrakten)", () => {
    const resultat = KIMessageSchema.safeParse({
      role: "system",
      content: "Systemmelding.",
    });
    expect(resultat.success).toBe(false);
  });

  it("avviser ugyldig rolle", () => {
    expect(
      KIMessageSchema.safeParse({ role: "moderator", content: "Hei" }).success,
    ).toBe(false);
  });

  it("avviser tom content", () => {
    const resultat = KIMessageSchema.safeParse({ role: "user", content: "" });
    expect(resultat.success).toBe(false);
  });

  it("godtar valgfri timestamp", () => {
    const resultat = KIMessageSchema.safeParse({
      role: "user",
      content: "Test",
      timestamp: "2024-01-01T00:00:00Z",
    });
    expect(resultat.success).toBe(true);
  });
});

// KIChatRequestSchema
describe("KIChatRequestSchema", () => {
  it("godtar gyldig forespørsel med én melding", () => {
    const resultat = KIChatRequestSchema.safeParse({
      messages: [{ role: "user", content: "Hei" }],
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser tom meldingsarray", () => {
    expect(KIChatRequestSchema.safeParse({ messages: [] }).success).toBe(false);
  });

  it("avviser mer enn 200 meldinger", () => {
    const meldinger = Array.from({ length: 201 }, () => ({
      role: "user" as const,
      content: "Melding",
    }));
    expect(KIChatRequestSchema.safeParse({ messages: meldinger }).success).toBe(false);
  });

  it("godtar nøyaktig 200 meldinger", () => {
    const meldinger = Array.from({ length: 200 }, () => ({
      role: "user" as const,
      content: "Melding",
    }));
    expect(KIChatRequestSchema.safeParse({ messages: meldinger }).success).toBe(true);
  });

  it("godtar valgfri model og temperature", () => {
    const resultat = KIChatRequestSchema.safeParse({
      messages: [{ role: "user", content: "Hei" }],
      model: "claude-3-5-sonnet",
      temperature: 0.7,
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser system-rolle i klientmeldinger", () => {
    // KIChatRequestSchema bruker KIChatClientMessageSchema som kun tillater user/assistant
    const resultat = KIChatRequestSchema.safeParse({
      messages: [{ role: "system", content: "Systemmelding" }],
    });
    expect(resultat.success).toBe(false);
  });

  it("avviser tom content i klientmeldinger", () => {
    const resultat = KIChatRequestSchema.safeParse({
      messages: [{ role: "user", content: "   " }],
    });
    expect(resultat.success).toBe(false);
  });
});

// SubTaskSchema
describe("SubTaskSchema", () => {
  it("godtar gyldig subtask", () => {
    const resultat = SubTaskSchema.safeParse({
      id: "abc-123",
      title: "Les kapittel 3",
      description: "Gå gjennom pensum",
      estimatedTime: "2 timer",
      priority: "medium",
      completed: false,
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser tom tittel", () => {
    expect(
      SubTaskSchema.safeParse({
        id: "abc",
        title: "",
        estimatedTime: "1t",
        priority: "low",
        completed: false,
      }).success,
    ).toBe(false);
  });

  it("avviser ugyldig prioritet", () => {
    expect(
      SubTaskSchema.safeParse({
        id: "abc",
        title: "Oppgave",
        estimatedTime: "1t",
        priority: "critical",
        completed: false,
      }).success,
    ).toBe(false);
  });

  it("avviser manglende påkrevde felt", () => {
    expect(SubTaskSchema.safeParse({}).success).toBe(false);
    expect(SubTaskSchema.safeParse({ id: "abc" }).success).toBe(false);
  });

  it("godtar alle gyldige prioriteter", () => {
    for (const prioritet of ["low", "medium", "high"]) {
      const resultat = SubTaskSchema.safeParse({
        id: "1",
        title: "Test",
        estimatedTime: "1t",
        priority: prioritet,
        completed: false,
      });
      expect(resultat.success).toBe(true);
    }
  });
});

// TaskBreakdownGenerateRequestSchema
describe("TaskBreakdownGenerateRequestSchema", () => {
  it("godtar gyldig forespørsel", () => {
    const resultat = TaskBreakdownGenerateRequestSchema.safeParse({
      assignmentTitle: "Innlevering 3",
      assignmentDescription: "Skriv en rapport om...",
      dueDate: "2024-12-01T23:59:00Z",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar uten dueDate (valgfri)", () => {
    const resultat = TaskBreakdownGenerateRequestSchema.safeParse({
      assignmentTitle: "Innlevering 3",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser tom tittel", () => {
    expect(
      TaskBreakdownGenerateRequestSchema.safeParse({
        assignmentTitle: "",
      }).success,
    ).toBe(false);
  });

  it("avviser tittel over 200 tegn", () => {
    expect(
      TaskBreakdownGenerateRequestSchema.safeParse({
        assignmentTitle: "a".repeat(201),
      }).success,
    ).toBe(false);
  });
});

// KIOppsummeringRequestSchema
describe("KIOppsummeringRequestSchema", () => {
  it("godtar gyldig forespørsel med type 'tldr'", () => {
    const resultat = KIOppsummeringRequestSchema.safeParse({
      tekst: "Lang tekst her...",
      type: "tldr",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar type 'handlinger'", () => {
    const resultat = KIOppsummeringRequestSchema.safeParse({
      tekst: "Tekst",
      type: "handlinger",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar type 'begge'", () => {
    const resultat = KIOppsummeringRequestSchema.safeParse({
      tekst: "Tekst",
      type: "begge",
    });
    expect(resultat.success).toBe(true);
  });

  it("bruker 'begge' som standardverdi", () => {
    const resultat = KIOppsummeringRequestSchema.safeParse({ tekst: "Tekst" });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.type).toBe("begge");
  });

  it("avviser ugyldig type", () => {
    expect(
      KIOppsummeringRequestSchema.safeParse({
        tekst: "Tekst",
        type: "ugyldig",
      }).success,
    ).toBe(false);
  });

  it("avviser tom tekst", () => {
    expect(
      KIOppsummeringRequestSchema.safeParse({ tekst: "" }).success,
    ).toBe(false);
  });

  it("avviser tekst over 50000 tegn", () => {
    expect(
      KIOppsummeringRequestSchema.safeParse({ tekst: "a".repeat(50001) }).success,
    ).toBe(false);
  });
});

// QuizQuestionSchema
describe("QuizQuestionSchema", () => {
  it("godtar gyldig quiz-spørsmål", () => {
    const resultat = QuizQuestionSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      question: "Hva er Canvas?",
      options: ["Et LMS", "En nettbutikk", "En bank", "Et spill"],
      correctIndex: 0,
      explanation: "Canvas er et Learning Management System.",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser correctIndex utenfor 0-3", () => {
    expect(
      QuizQuestionSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        question: "Test",
        options: ["A", "B", "C", "D"],
        correctIndex: 4,
        explanation: "Forklaring",
      }).success,
    ).toBe(false);
  });

  it("avviser negativ correctIndex", () => {
    expect(
      QuizQuestionSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        question: "Test",
        options: ["A", "B", "C", "D"],
        correctIndex: -1,
        explanation: "Forklaring",
      }).success,
    ).toBe(false);
  });

  it("krever nøyaktig 4 options", () => {
    expect(
      QuizQuestionSchema.safeParse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        question: "Test",
        options: ["A", "B", "C"],
        correctIndex: 0,
        explanation: "Forklaring",
      }).success,
    ).toBe(false);
  });
});

// Konstanter
describe("KI-konstanter", () => {
  it("KI_MAX_MESSAGE_LENGTH_BACKEND er 50000", () => {
    expect(KI_MAX_MESSAGE_LENGTH_BACKEND).toBe(50000);
  });

  it("KI_MAX_MESSAGE_LENGTH_FRONTEND er 45000", () => {
    expect(KI_MAX_MESSAGE_LENGTH_FRONTEND).toBe(45000);
  });

  it("frontend-grense er lavere enn backend-grense", () => {
    expect(KI_MAX_MESSAGE_LENGTH_FRONTEND).toBeLessThan(KI_MAX_MESSAGE_LENGTH_BACKEND);
  });
});
