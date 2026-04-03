/**
 * Tester for notifications-modulen – push-preferanser, abonnement og normalisering.
 */

import { describe, it, expect } from "vitest";
import {
  BrowserPushPreferencesSchema,
  WebPushSubscriptionSchema,
  createDefaultBrowserPushPreferences,
  normalizeBrowserPushPreferences,
  normalizeBrowserPushSentState,
  BROWSER_PUSH_SENT_IDS_MAX,
} from "../notifications.js";

// ─── BrowserPushPreferencesSchema ───────────────────────────────────────────

describe("BrowserPushPreferencesSchema", () => {
  it("bruker standardverdier (enabled=false, resten true)", () => {
    const resultat = BrowserPushPreferencesSchema.safeParse({});
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.enabled).toBe(false);
      expect(resultat.data.announcements).toBe(true);
      expect(resultat.data.deadlines).toBe(true);
      expect(resultat.data.events).toBe(true);
      expect(resultat.data.aiResponses).toBe(true);
    }
  });

  it("godtar eksplisitt override", () => {
    const resultat = BrowserPushPreferencesSchema.safeParse({
      enabled: true,
      announcements: false,
      deadlines: true,
      events: false,
      aiResponses: true,
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.enabled).toBe(true);
      expect(resultat.data.announcements).toBe(false);
      expect(resultat.data.events).toBe(false);
    }
  });

  it("godtar delvis override (resten bruker standardverdier)", () => {
    const resultat = BrowserPushPreferencesSchema.safeParse({ enabled: true });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.enabled).toBe(true);
      expect(resultat.data.announcements).toBe(true);
    }
  });
});

// ─── WebPushSubscriptionSchema ──────────────────────────────────────────────

describe("WebPushSubscriptionSchema", () => {
  const gyldigAbonnement = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: {
      p256dh: "BNcRdreAL...",
      auth: "tBHItJ...",
    },
  };

  it("godtar gyldig HTTPS-endpoint", () => {
    expect(WebPushSubscriptionSchema.safeParse(gyldigAbonnement).success).toBe(true);
  });

  it("avviser HTTP-endpoint", () => {
    expect(
      WebPushSubscriptionSchema.safeParse({
        ...gyldigAbonnement,
        endpoint: "http://fcm.googleapis.com/fcm/send/abc123",
      }).success,
    ).toBe(false);
  });

  it("avviser ugyldig URL som endpoint", () => {
    expect(
      WebPushSubscriptionSchema.safeParse({
        ...gyldigAbonnement,
        endpoint: "ikke-en-url",
      }).success,
    ).toBe(false);
  });

  it("avviser manglende keys", () => {
    expect(
      WebPushSubscriptionSchema.safeParse({
        endpoint: "https://example.com/push",
      }).success,
    ).toBe(false);
  });

  it("avviser tom p256dh", () => {
    expect(
      WebPushSubscriptionSchema.safeParse({
        endpoint: "https://example.com/push",
        keys: { p256dh: "", auth: "abc" },
      }).success,
    ).toBe(false);
  });

  it("avviser tom auth", () => {
    expect(
      WebPushSubscriptionSchema.safeParse({
        endpoint: "https://example.com/push",
        keys: { p256dh: "abc", auth: "" },
      }).success,
    ).toBe(false);
  });

  it("godtar valgfri expirationTime", () => {
    const resultat = WebPushSubscriptionSchema.safeParse({
      ...gyldigAbonnement,
      expirationTime: 1700000000,
    });
    expect(resultat.success).toBe(true);
  });

  it("godtar null expirationTime", () => {
    const resultat = WebPushSubscriptionSchema.safeParse({
      ...gyldigAbonnement,
      expirationTime: null,
    });
    expect(resultat.success).toBe(true);
  });
});

// ─── createDefaultBrowserPushPreferences ────────────────────────────────────

describe("createDefaultBrowserPushPreferences", () => {
  it("returnerer korrekte standardverdier", () => {
    const prefs = createDefaultBrowserPushPreferences();
    expect(prefs).toEqual({
      enabled: false,
      announcements: true,
      deadlines: true,
      events: true,
      aiResponses: true,
    });
  });

  it("returnerer ny referanse ved hvert kall", () => {
    const a = createDefaultBrowserPushPreferences();
    const b = createDefaultBrowserPushPreferences();
    expect(a).not.toBe(b);
  });
});

// ─── normalizeBrowserPushPreferences ────────────────────────────────────────

describe("normalizeBrowserPushPreferences", () => {
  it("returnerer standardverdier for null", () => {
    const prefs = normalizeBrowserPushPreferences(null);
    expect(prefs.enabled).toBe(false);
    expect(prefs.announcements).toBe(true);
  });

  it("returnerer standardverdier for undefined", () => {
    const prefs = normalizeBrowserPushPreferences(undefined);
    expect(prefs.enabled).toBe(false);
  });

  it("merges med standardverdier", () => {
    const prefs = normalizeBrowserPushPreferences({ enabled: true });
    expect(prefs.enabled).toBe(true);
    expect(prefs.announcements).toBe(true);
    expect(prefs.deadlines).toBe(true);
  });

  it("overstyrer standardverdier", () => {
    const prefs = normalizeBrowserPushPreferences({
      announcements: false,
      events: false,
    });
    expect(prefs.announcements).toBe(false);
    expect(prefs.events).toBe(false);
    expect(prefs.enabled).toBe(false);
  });
});

// ─── normalizeBrowserPushSentState ──────────────────────────────────────────

describe("normalizeBrowserPushSentState", () => {
  it("returnerer tom tilstand for null", () => {
    expect(normalizeBrowserPushSentState(null)).toEqual({ sentIds: [] });
  });

  it("returnerer tom tilstand for undefined", () => {
    expect(normalizeBrowserPushSentState(undefined)).toEqual({ sentIds: [] });
  });

  it("dedupliserer IDer", () => {
    const resultat = normalizeBrowserPushSentState({
      sentIds: ["a", "b", "a", "c", "b"],
    });
    expect(resultat.sentIds).toEqual(["a", "b", "c"]);
  });

  it("kutter til maks 500 IDer", () => {
    const mange = Array.from({ length: 600 }, (_, i) => `push-${i}`);
    const resultat = normalizeBrowserPushSentState({ sentIds: mange });
    expect(resultat.sentIds.length).toBe(BROWSER_PUSH_SENT_IDS_MAX);
  });

  it("BROWSER_PUSH_SENT_IDS_MAX er 500", () => {
    expect(BROWSER_PUSH_SENT_IDS_MAX).toBe(500);
  });
});
