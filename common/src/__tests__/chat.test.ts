/**
 * Tester for chat-modulen – meldinger, lagring, deling og oppdatering.
 */

import { describe, it, expect } from "vitest";
import {
  ChatMessageSchema,
  ChatSaveSchema,
  ChatShareCreateSchema,
  ChatTopicUpdateSchema,
  ChatTitleUpdateSchema,
} from "../chat.js";

// ChatMessageSchema
describe("ChatMessageSchema", () => {
  it("godtar gyldig brukermelding", () => {
    const resultat = ChatMessageSchema.safeParse({
      rolle: "user",
      innhold: "Hei, kan du hjelpe meg?",
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar gyldig assistentmelding", () => {
    const resultat = ChatMessageSchema.safeParse({
      rolle: "assistant",
      innhold: "Selvfølgelig!",
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser tom innhold", () => {
    expect(ChatMessageSchema.safeParse({ rolle: "user", innhold: "" }).success).toBe(false);
  });

  it("avviser innhold med bare mellomrom", () => {
    expect(ChatMessageSchema.safeParse({ rolle: "user", innhold: "   " }).success).toBe(false);
  });

  it("avviser innhold over 50000 tegn", () => {
    expect(
      ChatMessageSchema.safeParse({
        rolle: "user",
        innhold: "a".repeat(50001),
      }).success,
    ).toBe(false);
  });

  it("godtar innhold på nøyaktig 50000 tegn", () => {
    expect(
      ChatMessageSchema.safeParse({
        rolle: "user",
        innhold: "a".repeat(50000),
      }).success,
    ).toBe(true);
  });

  it("avviser ugyldig rolle", () => {
    expect(ChatMessageSchema.safeParse({ rolle: "system", innhold: "Hei" }).success).toBe(false);
  });
});

// ChatSaveSchema
describe("ChatSaveSchema", () => {
  it("godtar gyldig lagring med meldinger", () => {
    const resultat = ChatSaveSchema.safeParse({
      messages: [{ rolle: "user", innhold: "Hei" }],
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser 0 meldinger", () => {
    expect(ChatSaveSchema.safeParse({ messages: [] }).success).toBe(false);
  });

  it("avviser mer enn 200 meldinger", () => {
    const meldinger = Array.from({ length: 201 }, () => ({
      rolle: "user" as const,
      innhold: "Melding",
    }));
    expect(ChatSaveSchema.safeParse({ messages: meldinger }).success).toBe(false);
  });

  it("godtar nøyaktig 200 meldinger", () => {
    const meldinger = Array.from({ length: 200 }, () => ({
      rolle: "user" as const,
      innhold: "Melding",
    }));
    expect(ChatSaveSchema.safeParse({ messages: meldinger }).success).toBe(true);
  });

  it("godtar valgfri title og topic", () => {
    const resultat = ChatSaveSchema.safeParse({
      messages: [{ rolle: "user", innhold: "Hei" }],
      title: "Min samtale",
      topic: "Canvas",
    });
    expect(resultat.success).toBe(true);
  });

  it("normaliserer tom title til null", () => {
    const resultat = ChatSaveSchema.safeParse({
      messages: [{ rolle: "user", innhold: "Hei" }],
      title: "",
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.title).toBeNull();
  });

  it("normaliserer mellomrom-title til null", () => {
    const resultat = ChatSaveSchema.safeParse({
      messages: [{ rolle: "user", innhold: "Hei" }],
      title: "   ",
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.title).toBeNull();
  });
});

// ChatShareCreateSchema
describe("ChatShareCreateSchema", () => {
  it("godtar tomt objekt", () => {
    const resultat = ChatShareCreateSchema.safeParse({});
    expect(resultat.success).toBe(true);
  });

  it("avviser ekstra felter (strict)", () => {
    expect(ChatShareCreateSchema.safeParse({ extra: true }).success).toBe(false);
  });
});

// ChatTopicUpdateSchema
describe("ChatTopicUpdateSchema", () => {
  it("godtar gyldig topic", () => {
    const resultat = ChatTopicUpdateSchema.safeParse({ topic: "Canvas" });
    expect(resultat.success).toBe(true);
  });

  it("godtar null topic (fjerner tema)", () => {
    const resultat = ChatTopicUpdateSchema.safeParse({ topic: null });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.topic).toBeNull();
  });

  it("normaliserer tom streng til null", () => {
    const resultat = ChatTopicUpdateSchema.safeParse({ topic: "" });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.topic).toBeNull();
  });

  it("normaliserer mellomrom til null", () => {
    const resultat = ChatTopicUpdateSchema.safeParse({ topic: "   " });
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data.topic).toBeNull();
  });

  it("avviser topic over 40 tegn", () => {
    expect(ChatTopicUpdateSchema.safeParse({ topic: "a".repeat(41) }).success).toBe(false);
  });
});

// ChatTitleUpdateSchema
describe("ChatTitleUpdateSchema", () => {
  it("godtar gyldig tittel", () => {
    const resultat = ChatTitleUpdateSchema.safeParse({ title: "Min samtale" });
    expect(resultat.success).toBe(true);
  });

  it("godtar tittel med nøyaktig 1 tegn (minimumslengde)", () => {
    const resultat = ChatTitleUpdateSchema.safeParse({ title: "A" });
    expect(resultat.success).toBe(true);
  });

  it("avviser tom tittel", () => {
    expect(ChatTitleUpdateSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("avviser tittel med bare mellomrom", () => {
    expect(ChatTitleUpdateSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("godtar tittel med nøyaktig 120 tegn", () => {
    expect(ChatTitleUpdateSchema.safeParse({ title: "a".repeat(120) }).success).toBe(true);
  });

  it("avviser tittel over 120 tegn", () => {
    expect(ChatTitleUpdateSchema.safeParse({ title: "a".repeat(121) }).success).toBe(false);
  });
});
