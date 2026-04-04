/**
 * Tester for auth-modulen – Zod-schemas, hjelpefunksjoner og konstanter.
 */

import { describe, it, expect } from "vitest";
import {
  EmailSchema,
  StoredCanvasBaseUrlSchema,
  CanvasBaseUrlSchema,
  normalizeCanvasBaseUrl,
  isValidFirstName,
  isValidLastName,
  isProfileIncomplete,
  isValidUsernameFormat,
  RoleSchema,
  createDefaultCanvasContextPreferences,
  normalizeVarslerState,
  normalizeManuellInnleveringState,
  normalizeHiddenCourseIds,
  PreferencesUpdateSchema,
  ProfileUpdateSchema,
  AUTH_CHANNEL_NAME,
  AUTH_CSRF_HEADER_NAME,
  AUTH_CSRF_HEADER_VALUE,
  VARSLER_MAX_IDS,
  MIN_NAME_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from "../auth.js";

// ─── EmailSchema ────────────────────────────────────────────────────────────

describe("EmailSchema", () => {
  it("godtar gyldig e-post", () => {
    const resultat = EmailSchema.safeParse("bruker@example.com");
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data).toBe("bruker@example.com");
  });

  it("trimmer mellomrom", () => {
    const resultat = EmailSchema.safeParse("  bruker@example.com  ");
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data).toBe("bruker@example.com");
  });

  it("konverterer til lowercase", () => {
    const resultat = EmailSchema.safeParse("Bruker@Example.COM");
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data).toBe("bruker@example.com");
  });

  it("avviser e-post uten @", () => {
    expect(EmailSchema.safeParse("ugyldig").success).toBe(false);
  });

  it("avviser e-post uten domene", () => {
    expect(EmailSchema.safeParse("bruker@").success).toBe(false);
  });

  it("avviser e-post uten brukernavn", () => {
    expect(EmailSchema.safeParse("@example.com").success).toBe(false);
  });

  it("avviser tom streng", () => {
    expect(EmailSchema.safeParse("").success).toBe(false);
  });

  it("avviser e-post med mellomrom i midten", () => {
    expect(EmailSchema.safeParse("bru ker@example.com").success).toBe(false);
  });

  it("avviser e-post over 320 tegn", () => {
    const lang = "a".repeat(310) + "@example.com";
    expect(EmailSchema.safeParse(lang).success).toBe(false);
  });
});

// ─── StoredCanvasBaseUrlSchema / CanvasBaseUrlSchema ────────────────────────

describe("StoredCanvasBaseUrlSchema", () => {
  it("godtar gyldig https Canvas-URL", () => {
    const resultat = StoredCanvasBaseUrlSchema.safeParse("https://mitt.uib.no");
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data).toBe("https://mitt.uib.no");
  });

  it("trimmer og fjerner trailing slash", () => {
    const resultat = StoredCanvasBaseUrlSchema.safeParse("  https://mitt.uib.no/  ");
    expect(resultat.success).toBe(true);
    if (resultat.success) expect(resultat.data).toBe("https://mitt.uib.no");
  });

  it("avviser URL med sti", () => {
    expect(StoredCanvasBaseUrlSchema.safeParse("https://mitt.uib.no/courses").success).toBe(false);
  });

  it("avviser HTTP-URL (kun HTTPS)", () => {
    expect(StoredCanvasBaseUrlSchema.safeParse("http://mitt.uib.no").success).toBe(false);
  });

  it("avviser ugyldig URL", () => {
    expect(StoredCanvasBaseUrlSchema.safeParse("ikke-en-url").success).toBe(false);
  });
});

describe("CanvasBaseUrlSchema", () => {
  it("godtar kjent Canvas-instans", () => {
    const resultat = CanvasBaseUrlSchema.safeParse("https://mitt.uib.no");
    expect(resultat.success).toBe(true);
  });

  it("godtar kjent instructure-instans", () => {
    const resultat = CanvasBaseUrlSchema.safeParse("https://ntnu.instructure.com");
    expect(resultat.success).toBe(true);
  });

  it("avviser ukjent Canvas-instans", () => {
    const resultat = CanvasBaseUrlSchema.safeParse("https://ukjent.example.com");
    expect(resultat.success).toBe(false);
  });
});

// ─── normalizeCanvasBaseUrl ─────────────────────────────────────────────────

describe("normalizeCanvasBaseUrl", () => {
  it("trimmer mellomrom", () => {
    expect(normalizeCanvasBaseUrl("  https://mitt.uib.no  ")).toBe("https://mitt.uib.no");
  });

  it("fjerner trailing slash", () => {
    expect(normalizeCanvasBaseUrl("https://mitt.uib.no/")).toBe("https://mitt.uib.no");
  });

  it("konverterer til lowercase", () => {
    expect(normalizeCanvasBaseUrl("HTTPS://MITT.UIB.NO")).toBe("https://mitt.uib.no");
  });

  it("returnerer tom streng uendret", () => {
    expect(normalizeCanvasBaseUrl("")).toBe("");
  });
});

// ─── isValidFirstName / isValidLastName ─────────────────────────────────────

describe("isValidFirstName", () => {
  it("godtar navn med minst 2 tegn", () => {
    expect(isValidFirstName("Ola")).toBe(true);
  });

  it("godtar navn med nøyaktig 2 tegn", () => {
    expect(isValidFirstName("Li")).toBe(true);
  });

  it("avviser enkelt tegn (initial)", () => {
    expect(isValidFirstName("O")).toBe(false);
  });

  it("avviser tom streng", () => {
    expect(isValidFirstName("")).toBe(false);
  });

  it("avviser null", () => {
    expect(isValidFirstName(null)).toBe(false);
  });

  it("avviser undefined", () => {
    expect(isValidFirstName(undefined)).toBe(false);
  });

  it("trimmer mellomrom (kun mellomrom avvises)", () => {
    expect(isValidFirstName("  O  ")).toBe(false);
  });
});

describe("isValidLastName", () => {
  it("godtar etternavn med minst 2 tegn", () => {
    expect(isValidLastName("Nordmann")).toBe(true);
  });

  it("avviser enkelt tegn", () => {
    expect(isValidLastName("N")).toBe(false);
  });

  it("avviser null", () => {
    expect(isValidLastName(null)).toBe(false);
  });
});

// ─── isProfileIncomplete ────────────────────────────────────────────────────

describe("isProfileIncomplete", () => {
  it("returnerer true for null bruker", () => {
    expect(isProfileIncomplete(null)).toBe(true);
  });

  it("returnerer true for undefined bruker", () => {
    expect(isProfileIncomplete(undefined)).toBe(true);
  });

  it("returnerer true når fornavn mangler", () => {
    expect(isProfileIncomplete({ lastName: "Nordmann" })).toBe(true);
  });

  it("returnerer true når etternavn er for kort", () => {
    expect(isProfileIncomplete({ firstName: "Ola", lastName: "N" })).toBe(true);
  });

  it("returnerer false for komplett profil", () => {
    expect(isProfileIncomplete({ firstName: "Ola", lastName: "Nordmann" })).toBe(false);
  });

  it("returnerer true når begge er for korte", () => {
    expect(isProfileIncomplete({ firstName: "O", lastName: "N" })).toBe(true);
  });
});

// ─── isValidUsernameFormat ──────────────────────────────────────────────────

describe("isValidUsernameFormat", () => {
  it("godtar gyldig brukernavn med bokstaver og tall", () => {
    expect(isValidUsernameFormat("bruker123")).toBe(true);
  });

  it("godtar understrek", () => {
    expect(isValidUsernameFormat("bruker_123")).toBe(true);
  });

  it("avviser for kort brukernavn (under 4 tegn)", () => {
    expect(isValidUsernameFormat("ab")).toBe(false);
    expect(isValidUsernameFormat("abc")).toBe(false);
  });

  it("godtar nøyaktig 4 tegn (minimumslengde)", () => {
    expect(isValidUsernameFormat("abcd")).toBe(true);
  });

  it("godtar nøyaktig 30 tegn (maksimumslengde)", () => {
    expect(isValidUsernameFormat("a".repeat(30))).toBe(true);
  });

  it("avviser over 30 tegn", () => {
    expect(isValidUsernameFormat("a".repeat(31))).toBe(false);
  });

  it("avviser spesialtegn", () => {
    expect(isValidUsernameFormat("bruker@123")).toBe(false);
    expect(isValidUsernameFormat("bruker-123")).toBe(false);
    expect(isValidUsernameFormat("bruker.123")).toBe(false);
  });

  it("avviser mellomrom", () => {
    expect(isValidUsernameFormat("bruker 123")).toBe(false);
  });

  it("avviser tom streng", () => {
    expect(isValidUsernameFormat("")).toBe(false);
  });
});

// ─── RoleSchema ─────────────────────────────────────────────────────────────

describe("RoleSchema", () => {
  it("godtar 'user'", () => {
    expect(RoleSchema.safeParse("user").success).toBe(true);
  });

  it("godtar 'admin'", () => {
    expect(RoleSchema.safeParse("admin").success).toBe(true);
  });

  it("avviser ugyldig rolle", () => {
    expect(RoleSchema.safeParse("superadmin").success).toBe(false);
    expect(RoleSchema.safeParse("").success).toBe(false);
  });
});

// ─── createDefaultCanvasContextPreferences ──────────────────────────────────

describe("createDefaultCanvasContextPreferences", () => {
  it("returnerer objekt med alle felter satt til true", () => {
    const prefs = createDefaultCanvasContextPreferences();
    expect(prefs).toEqual({
      announcements: true,
      courses: true,
      assignments: true,
      events: true,
    });
  });

  it("returnerer ny referanse ved hvert kall", () => {
    const a = createDefaultCanvasContextPreferences();
    const b = createDefaultCanvasContextPreferences();
    expect(a).not.toBe(b);
  });
});

// ─── normalizeVarslerState ──────────────────────────────────────────────────

describe("normalizeVarslerState", () => {
  it("returnerer tom tilstand for null", () => {
    expect(normalizeVarslerState(null)).toEqual({
      lestIds: [],
      toastVistIds: [],
    });
  });

  it("returnerer tom tilstand for undefined", () => {
    expect(normalizeVarslerState(undefined)).toEqual({
      lestIds: [],
      toastVistIds: [],
    });
  });

  it("dedupliserer IDer", () => {
    const resultat = normalizeVarslerState({
      lestIds: ["a", "b", "a"],
      toastVistIds: ["x", "x"],
    });
    expect(resultat.lestIds).toEqual(["a", "b"]);
    expect(resultat.toastVistIds).toEqual(["x"]);
  });

  it("kutter til maks 500 IDer", () => {
    const mange = Array.from({ length: 600 }, (_, i) => `id-${i}`);
    const resultat = normalizeVarslerState({ lestIds: mange, toastVistIds: [] });
    expect(resultat.lestIds.length).toBe(VARSLER_MAX_IDS);
  });
});

// ─── normalizeManuellInnleveringState ───────────────────────────────────────

describe("normalizeManuellInnleveringState", () => {
  it("returnerer tom tilstand for null", () => {
    expect(normalizeManuellInnleveringState(null)).toEqual({ ferdigeIds: [] });
  });

  it("dedupliserer IDer", () => {
    const resultat = normalizeManuellInnleveringState({ ferdigeIds: [1, 2, 1, 3] });
    expect(resultat.ferdigeIds).toEqual([1, 2, 3]);
  });

  it("kutter til maks 2000 IDer", () => {
    const mange = Array.from({ length: 2500 }, (_, i) => i + 1);
    const resultat = normalizeManuellInnleveringState({ ferdigeIds: mange });
    expect(resultat.ferdigeIds.length).toBe(2000);
  });
});

// ─── normalizeHiddenCourseIds ───────────────────────────────────────────────

describe("normalizeHiddenCourseIds", () => {
  it("returnerer tom tilstand for null", () => {
    expect(normalizeHiddenCourseIds(null)).toEqual({ courseIds: [] });
  });

  it("dedupliserer IDer", () => {
    const resultat = normalizeHiddenCourseIds({ courseIds: [10, 20, 10] });
    expect(resultat.courseIds).toEqual([10, 20]);
  });

  it("kutter til maks 200 IDer", () => {
    const mange = Array.from({ length: 300 }, (_, i) => i + 1);
    const resultat = normalizeHiddenCourseIds({ courseIds: mange });
    expect(resultat.courseIds.length).toBe(200);
  });
});

// ─── PreferencesUpdateSchema ────────────────────────────────────────────────

describe("PreferencesUpdateSchema", () => {
  it("godtar gyldig oppdatering med canvasContextPreferences", () => {
    const resultat = PreferencesUpdateSchema.safeParse({
      canvasContextPreferences: {
        announcements: true,
        courses: false,
        assignments: true,
        events: true,
      },
    });
    expect(resultat.success).toBe(true);
  });

  it("avviser tomt objekt (ingen preferanser)", () => {
    expect(PreferencesUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("avviser uiPreferences uten gyldige felter", () => {
    expect(PreferencesUpdateSchema.safeParse({ uiPreferences: {} }).success).toBe(false);
  });

  it("godtar uiPreferences med minst ett felt", () => {
    const resultat = PreferencesUpdateSchema.safeParse({
      uiPreferences: { theme: "dark" },
    });
    expect(resultat.success).toBe(true);
  });
});

// ─── ProfileUpdateSchema ────────────────────────────────────────────────────

describe("ProfileUpdateSchema", () => {
  it("godtar fornavn med minst 2 tegn", () => {
    const resultat = ProfileUpdateSchema.safeParse({ firstName: "Ola" });
    expect(resultat.success).toBe(true);
  });

  it("avviser fornavn under 2 tegn", () => {
    expect(ProfileUpdateSchema.safeParse({ firstName: "O" }).success).toBe(false);
  });

  it("krever minst ett felt", () => {
    expect(ProfileUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("godtar kun etternavn", () => {
    const resultat = ProfileUpdateSchema.safeParse({ lastName: "Nordmann" });
    expect(resultat.success).toBe(true);
  });

  it("godtar begge navn", () => {
    const resultat = ProfileUpdateSchema.safeParse({ firstName: "Ola", lastName: "Nordmann" });
    expect(resultat.success).toBe(true);
  });
});

// ─── Konstanter ─────────────────────────────────────────────────────────────

describe("Konstanter", () => {
  it("AUTH_CHANNEL_NAME er definert", () => {
    expect(AUTH_CHANNEL_NAME).toBe("studywise_auth_sync");
  });

  it("AUTH_CSRF_HEADER_NAME er definert", () => {
    expect(AUTH_CSRF_HEADER_NAME).toBe("x-studywise-csrf");
  });

  it("AUTH_CSRF_HEADER_VALUE er '1'", () => {
    expect(AUTH_CSRF_HEADER_VALUE).toBe("1");
  });

  it("VARSLER_MAX_IDS er 500", () => {
    expect(VARSLER_MAX_IDS).toBe(500);
  });

  it("MIN_NAME_LENGTH er 2", () => {
    expect(MIN_NAME_LENGTH).toBe(2);
  });

  it("USERNAME_MIN_LENGTH er 4", () => {
    expect(USERNAME_MIN_LENGTH).toBe(4);
  });

  it("USERNAME_MAX_LENGTH er 30", () => {
    expect(USERNAME_MAX_LENGTH).toBe(30);
  });
});
