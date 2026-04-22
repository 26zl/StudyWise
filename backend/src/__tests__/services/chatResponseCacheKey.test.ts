/*
 * Tester for buildChatResponseCacheKey.
 *
 * Nøkkelen må være deterministisk for identiske spørringer, og dele cache
 * mellom brukere som spør samme ting om samme kurs. Den må også gi null
 * (ikke-cacheable) når nødvendig kontekst mangler.
 */
import { describe, it, expect } from "vitest";
import { buildChatResponseCacheKey } from "../../services/chat-response-cache.service.js";

describe("buildChatResponseCacheKey", () => {
  it("returnerer null når primaryCourseId mangler", () => {
    const key = buildChatResponseCacheKey({
      primaryCourseId: "",
      primaryFileId: 123,
      triggerWord: "oppsummer",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    expect(key).toBeNull();
  });

  it("returnerer null når primaryFileId mangler (0)", () => {
    const key = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 0,
      triggerWord: "oppsummer",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    expect(key).toBeNull();
  });

  it("returnerer null når både moduleHint og fileHint er null (ikke-deterministisk)", () => {
    const key = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "oppsummer",
      moduleHint: null,
      fileHint: null,
    });
    expect(key).toBeNull();
  });

  it("bygger identisk nøkkel uansett store/små bokstaver i moduleHint", () => {
    const a = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "oppsummer",
      moduleHint: "Leksjon 8",
      fileHint: null,
    });
    const b = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "oppsummer",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });

  it("gir ulik nøkkel for ulike trigger-klasser (utdyp vs oppsummer)", () => {
    const standard = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "oppsummer",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    const deep = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "utdyp",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    expect(standard).not.toBe(deep);
  });

  it("samler 'oppsummer' og 'sammendrag' under samme trigger-klasse (standard)", () => {
    const a = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "oppsummer",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    const b = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "sammendrag",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    expect(a).toBe(b);
  });

  it("samler 'utdyp' og 'utdype' under samme trigger-klasse (deep)", () => {
    const a = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "utdyp",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    const b = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "utdype",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    expect(a).toBe(b);
  });

  it("isolerer cache per kurs — samme fileId i ulike kurs gir ulik nøkkel", () => {
    const a = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "oppsummer",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    const b = buildChatResponseCacheKey({
      primaryCourseId: "35897",
      primaryFileId: 4159167,
      triggerWord: "oppsummer",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    expect(a).not.toBe(b);
  });

  it("inkluderer versjon i nøkkelen for fremtidig migrasjon", () => {
    const key = buildChatResponseCacheKey({
      primaryCourseId: "34442",
      primaryFileId: 4159167,
      triggerWord: "oppsummer",
      moduleHint: "leksjon 8",
      fileHint: null,
    });
    expect(key).toContain(":v1:");
  });
});
