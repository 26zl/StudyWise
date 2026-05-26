/*
 * Integrasjonstest for chunked fullText-lagring.
 *
 * Bakgrunn: Før denne endringen ble fullText "stille" kuttet ved 50k/200k
 * tegn i `upsertStoredFullText`, slik at filer over cap-en mistet
 * sluttinnhold uten varsel (se tidligere "Kapittel 5 og 7"-problem).
 * Nå splittes teksten over flere ContentEmbedding-rader. Testen verifiserer
 * at en syntetisk fil med varierende størrelse round-tripper korrekt.
 *
 * Kjører uten ekte MongoDB — vi mocker `ContentEmbedding` for å isolere
 * split/join-logikken. Integrasjon mot ekte database testes i e2e-suiten.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

type StoredDoc = {
  userId: string;
  courseId: string;
  fileId: number;
  chunkIndex: number;
  fullText?: string;
  text?: string;
  charCount?: number;
  fileName?: string;
  isFullDocument?: boolean;
};

// In-memory mock-store for ContentEmbedding. Støtter deleteMany, insertMany,
// find og aggregate — akkurat det upsertStoredFullText + readere bruker.
const store: StoredDoc[] = [];

vi.mock("../../database/models/ContentEmbedding.js", () => {
  return {
    ContentEmbedding: {
      deleteMany: vi.fn(async (filter: Record<string, unknown>) => {
        const before = store.length;
        const chunkIndexFilter = filter.chunkIndex as { $lt?: number } | number | undefined;
        for (let i = store.length - 1; i >= 0; i--) {
          const d = store[i];
          if (filter.userId && d.userId !== filter.userId) continue;
          if (filter.courseId && d.courseId !== filter.courseId) continue;
          if (filter.fileId !== undefined && d.fileId !== filter.fileId) continue;
          if (typeof chunkIndexFilter === "number" && d.chunkIndex !== chunkIndexFilter) continue;
          if (
            typeof chunkIndexFilter === "object" &&
            chunkIndexFilter !== null &&
            typeof chunkIndexFilter.$lt === "number" &&
            !(d.chunkIndex < chunkIndexFilter.$lt)
          )
            continue;
          store.splice(i, 1);
        }
        return { deletedCount: before - store.length };
      }),
      insertMany: vi.fn(async (docs: StoredDoc[]) => {
        store.push(...docs);
        return docs;
      }),
      find: vi.fn((filter: Record<string, unknown>) => {
        const chunkIndexFilter = filter.chunkIndex as { $lt?: number } | undefined;
        const results = store.filter((d) => {
          if (filter.userId && d.userId !== filter.userId) return false;
          if (filter.courseId && d.courseId !== filter.courseId) return false;
          if (filter.fileId !== undefined && d.fileId !== filter.fileId) return false;
          if (
            typeof chunkIndexFilter === "object" &&
            chunkIndexFilter !== null &&
            typeof chunkIndexFilter.$lt === "number" &&
            !(d.chunkIndex < chunkIndexFilter.$lt)
          )
            return false;
          return true;
        });
        return {
          sort: (sortSpec: Record<string, number>) => ({
            lean: async () => {
              const field = Object.keys(sortSpec)[0];
              const direction = sortSpec[field];
              return [...results].sort((a, b) => {
                const av = (a as unknown as Record<string, unknown>)[field] as number;
                const bv = (b as unknown as Record<string, unknown>)[field] as number;
                return direction > 0 ? av - bv : bv - av;
              });
            },
          }),
        };
      }),
    },
  };
});

// Mock token counter — vi teller ikke faktiske tokens her.
vi.mock("../../utils/tokenCounter.js", () => ({
  countTokens: (s: string) => Math.ceil(s.length / 4),
}));

const USER = "user1";
const COURSE = "course1";
const FILE = 42;

async function loadModule() {
  return import("../../services/embedding.service.js");
}

describe("upsertStoredFullText → getStoredFullDocumentForFile round-trip", () => {
  beforeEach(() => {
    store.length = 0;
  });

  it("small text (under part-size) lagres og leses uten tap", async () => {
    const { upsertStoredFullText, getStoredFullDocumentForFile } = await loadModule();
    const text = "a".repeat(10_000);
    await upsertStoredFullText({
      userId: USER,
      courseId: COURSE,
      courseName: "Kurs",
      moduleId: 1,
      moduleTitle: "Mod",
      fileName: "test.pdf",
      fileId: FILE,
      fileHash: "hash1",
      fullText: text,
    });

    const loaded = await getStoredFullDocumentForFile(USER, COURSE, FILE);
    expect(loaded).not.toBeNull();
    expect(loaded!.fullText.length).toBe(10_000);
    expect(loaded!.fullText).toBe(text);
    expect(loaded!.charCount).toBe(10_000);
    expect(loaded!.fileName).toBe("test.pdf");
  });

  it("large text (3x part-size) round-tripper uten tap", async () => {
    const { upsertStoredFullText, getStoredFullDocumentForFile, FULL_TEXT_PART_SIZE } =
      await loadModule();
    const totalLength = FULL_TEXT_PART_SIZE * 3 + 12_345;
    // Ikke bruk kun "a" — bruk ulike tegn per part-grense så vi oppdager
    // hvis partene kommer i feil rekkefølge ved lesing.
    let text = "";
    for (let i = 0; i < totalLength; i++) {
      text += String.fromCharCode(97 + (i % 26));
    }

    await upsertStoredFullText({
      userId: USER,
      courseId: COURSE,
      courseName: "Kurs",
      moduleId: 1,
      moduleTitle: "Mod",
      fileName: "big.pdf",
      fileId: FILE,
      fileHash: "hash2",
      fullText: text,
    });

    // Forvent 4 parter: 500k, 500k, 500k, 12_345
    expect(store.length).toBe(4);
    expect(store.every((d) => d.chunkIndex < 0)).toBe(true);

    const loaded = await getStoredFullDocumentForFile(USER, COURSE, FILE);
    expect(loaded).not.toBeNull();
    expect(loaded!.fullText.length).toBe(totalLength);
    expect(loaded!.fullText).toBe(text);
    expect(loaded!.charCount).toBe(totalLength);
  });

  it("re-upsert med kortere tekst sletter orphan-parter", async () => {
    const { upsertStoredFullText, getStoredFullDocumentForFile, FULL_TEXT_PART_SIZE } =
      await loadModule();

    // Første lagring: 3 parter
    await upsertStoredFullText({
      userId: USER,
      courseId: COURSE,
      courseName: "Kurs",
      moduleId: 1,
      moduleTitle: "Mod",
      fileName: "big.pdf",
      fileId: FILE,
      fileHash: "hash1",
      fullText: "x".repeat(FULL_TEXT_PART_SIZE * 2 + 1000),
    });
    expect(store.length).toBe(3);

    // Andre lagring: 1 part (ny versjon av filen er mye kortere)
    await upsertStoredFullText({
      userId: USER,
      courseId: COURSE,
      courseName: "Kurs",
      moduleId: 1,
      moduleTitle: "Mod",
      fileName: "big.pdf",
      fileId: FILE,
      fileHash: "hash2",
      fullText: "y".repeat(1000),
    });
    expect(store.length).toBe(1);

    const loaded = await getStoredFullDocumentForFile(USER, COURSE, FILE);
    expect(loaded!.fullText).toBe("y".repeat(1000));
    expect(loaded!.charCount).toBe(1000);
  });

  it("exakt part-size-grense (n * PART_SIZE) gir n parter, ikke n+1", async () => {
    const { upsertStoredFullText, FULL_TEXT_PART_SIZE } = await loadModule();

    await upsertStoredFullText({
      userId: USER,
      courseId: COURSE,
      courseName: "Kurs",
      moduleId: 1,
      moduleTitle: "Mod",
      fileName: "exact.pdf",
      fileId: FILE,
      fileHash: "hash",
      fullText: "a".repeat(FULL_TEXT_PART_SIZE * 2),
    });
    expect(store.length).toBe(2);
  });

  it("tom tekst lagrer én tom part (ikke null)", async () => {
    const { upsertStoredFullText, getStoredFullDocumentForFile } = await loadModule();
    await upsertStoredFullText({
      userId: USER,
      courseId: COURSE,
      courseName: "Kurs",
      moduleId: 1,
      moduleTitle: "Mod",
      fileName: "empty.pdf",
      fileId: FILE,
      fileHash: "hash",
      fullText: "",
    });
    expect(store.length).toBe(1);
    // Lesingen returnerer null fordi tekst er tom — getStoredFullDocumentForFile
    // filtrerer bort whitespace-only tekst som meningsløs.
    const loaded = await getStoredFullDocumentForFile(USER, COURSE, FILE);
    expect(loaded).toBeNull();
  });

  it("ingen silent truncation selv ved 5 MB tekst (eliminerer hele feilmodus)", async () => {
    const { upsertStoredFullText, getStoredFullDocumentForFile, FULL_TEXT_PART_SIZE } =
      await loadModule();
    const hugeLength = FULL_TEXT_PART_SIZE * 10; // 5 MB tekst
    const text = "z".repeat(hugeLength);

    await upsertStoredFullText({
      userId: USER,
      courseId: COURSE,
      courseName: "Kurs",
      moduleId: 1,
      moduleTitle: "Mod",
      fileName: "huge.pdf",
      fileId: FILE,
      fileHash: "hash",
      fullText: text,
    });

    const loaded = await getStoredFullDocumentForFile(USER, COURSE, FILE);
    expect(loaded!.fullText.length).toBe(hugeLength);
    expect(loaded!.charCount).toBe(hugeLength);
    expect(loaded!.fullText).toBe(text);
  });
});
