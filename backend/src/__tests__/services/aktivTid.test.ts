import { describe, it, expect } from "vitest";
import {
  beregnAktivTimer,
  beregnAktiveDager,
  CHAT_MARKER_MS,
} from "../../services/aktivTid.service.js";

const MS_I_TIME = 3_600_000;

/** 2026-04-22 12:00 UTC (litt tilfeldig dato innenfor testperioden). */
const BASE = new Date("2026-04-22T12:00:00Z").getTime();
const DAG_START = new Date("2026-04-22T00:00:00Z").getTime();

describe("beregnAktivTimer", () => {
  // F1-regresjon: gammel chat med én ny melding i dag skal ikke gi timer
  it("teller gammel chat oppdatert i dag som ~2 min, ikke hele spennet", () => {
    const chat = {
      createdAt: new Date(BASE - 10 * 24 * MS_I_TIME), // 10 dager siden
      updatedAt: new Date(BASE), // oppdatert akkurat nå
    };
    const timer = beregnAktivTimer([chat], [], DAG_START);
    // 2 min = 0.0333t → rundet til 0 ved 1 desimal (0.033 → 0)
    expect(timer).toBeLessThanOrEqual(0.1);
  });

  it("teller IKKE [createdAt, updatedAt]-spennet selv om begge ligger i vinduet", () => {
    const chat = {
      createdAt: new Date(BASE - 3 * MS_I_TIME), // 3t siden (samme dag)
      updatedAt: new Date(BASE),
    };
    // Hvis logikken var buggy ville vi fått 3t. Nå skal vi få ~2 min.
    const timer = beregnAktivTimer([chat], [], DAG_START);
    expect(timer).toBeLessThanOrEqual(0.1);
  });

  // Heartbeat-intervaller fungerer som før
  it("summerer heartbeat-intervaller korrekt", () => {
    const heartbeats = [
      { start: new Date(BASE - 2 * MS_I_TIME), end: new Date(BASE - MS_I_TIME) },
    ];
    const timer = beregnAktivTimer([], heartbeats, DAG_START);
    expect(timer).toBe(1.0);
  });

  it("slår sammen overlappende heartbeat-intervaller (unngår dobbelttelling)", () => {
    const heartbeats = [
      { start: new Date(BASE - 2 * MS_I_TIME), end: new Date(BASE - MS_I_TIME) }, // [10:00,11:00]
      { start: new Date(BASE - 1.5 * MS_I_TIME), end: new Date(BASE - 0.5 * MS_I_TIME) }, // [10:30,11:30]
    ];
    // Merged: [10:00, 11:30] = 1.5t
    const timer = beregnAktivTimer([], heartbeats, DAG_START);
    expect(timer).toBe(1.5);
  });

  it("klipper intervaller som starter før vindus-start", () => {
    // Heartbeat [23:00 i går, 01:00 i dag]
    const heartbeats = [
      { start: new Date(DAG_START - MS_I_TIME), end: new Date(DAG_START + MS_I_TIME) },
    ];
    const timer = beregnAktivTimer([], heartbeats, DAG_START);
    // Kun 01:00 i dag skal telle = 1t
    expect(timer).toBe(1.0);
  });

  it("chat-markør overlappende med heartbeat dobbelttelles ikke", () => {
    const chat = { updatedAt: new Date(BASE) };
    const heartbeats = [
      {
        // Heartbeat fra 30 sek før til 30 sek etter chat-markøren
        start: new Date(BASE - CHAT_MARKER_MS / 2 - 30_000),
        end: new Date(BASE + 30_000),
      },
    ];
    // Markør [BASE - 2 min, BASE] merges med heartbeat → sum ≤ ~2.5 min
    const timer = beregnAktivTimer([chat], heartbeats, DAG_START);
    expect(timer).toBeLessThanOrEqual(0.1);
  });

  it("håndterer tomme input", () => {
    expect(beregnAktivTimer([], [], DAG_START)).toBe(0);
  });

  it("hopper over chat uten updatedAt", () => {
    const chats = [{ updatedAt: null }, { updatedAt: undefined }, {}];
    expect(beregnAktivTimer(chats, [], DAG_START)).toBe(0);
  });

  it("hopper over heartbeat der end <= start etter klipping", () => {
    const heartbeats = [
      // Hele intervallet ligger før vindus-start
      { start: new Date(DAG_START - 2 * MS_I_TIME), end: new Date(DAG_START - MS_I_TIME) },
    ];
    expect(beregnAktivTimer([], heartbeats, DAG_START)).toBe(0);
  });

  it("runder til 1 desimal", () => {
    // 1t + 7.5 min = 1.125t → 1.1
    const heartbeats = [
      { start: new Date(BASE - MS_I_TIME - 7.5 * 60_000), end: new Date(BASE) },
    ];
    const timer = beregnAktivTimer([], heartbeats, DAG_START);
    expect(timer).toBe(1.1);
  });
});

describe("beregnAktiveDager", () => {
  it("teller unike kalenderdager", () => {
    const dag1 = new Date("2026-04-20T10:00:00Z").getTime();
    const dag2 = new Date("2026-04-21T10:00:00Z").getTime();
    const dag3 = new Date("2026-04-22T10:00:00Z").getTime();
    const vindusStart = new Date("2026-04-15T00:00:00Z").getTime();
    const heartbeats = [
      { start: new Date(dag1), end: new Date(dag1 + MS_I_TIME) },
      { start: new Date(dag2), end: new Date(dag2 + MS_I_TIME) },
      { start: new Date(dag3), end: new Date(dag3 + MS_I_TIME) },
    ];
    expect(beregnAktiveDager([], heartbeats, vindusStart)).toBe(3);
  });

  it("returnerer 0 for tom input", () => {
    expect(beregnAktiveDager([], [], DAG_START)).toBe(0);
  });

  it("intervall som krysser midnatt teller begge datoer", () => {
    // Bruker server-local tid siden beregnAktiveDager bruker getFullYear/Month/Date
    // (lokal tid). Konstruer et 1-timers intervall som garantert krysser lokal midnatt.
    const lokalMidnatt = new Date(2026, 3, 21, 0, 0, 0, 0); // 2026-04-21 00:00 local
    const vindusStart = new Date(2026, 3, 1, 0, 0, 0, 0).getTime();
    const heartbeats = [
      {
        start: new Date(lokalMidnatt.getTime() - 30 * 60_000), // 2026-04-20 23:30 local
        end: new Date(lokalMidnatt.getTime() + 30 * 60_000), // 2026-04-21 00:30 local
      },
    ];
    expect(beregnAktiveDager([], heartbeats, vindusStart)).toBe(2);
  });
});
