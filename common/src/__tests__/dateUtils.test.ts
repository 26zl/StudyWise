/**
 * Tester for dateUtils-modulen – ukenummer, ukeinfo og tidsstreng-parsing.
 */

import { describe, it, expect } from "vitest";
import {
  getWeekNumber,
  getIsoWeekInfo,
  parseTimerStreng,
  TWO_WEEKS_MS,
} from "../dateUtils.js";

// ─── getWeekNumber ──────────────────────────────────────────────────────────

describe("getWeekNumber", () => {
  it("returnerer uke 1 for 1. januar 2024 (mandag)", () => {
    // 1. januar 2024 er en mandag → ISO uke 1
    expect(getWeekNumber(new Date(2024, 0, 1))).toBe(1);
  });

  it("returnerer uke 27 for 1. juli 2024", () => {
    expect(getWeekNumber(new Date(2024, 6, 1))).toBe(27);
  });

  it("returnerer uke 1 for 31. desember 2024 (tirsdag, ISO-uke 1 neste år)", () => {
    // 31. desember 2024 er en tirsdag, som tilhører ISO-uke 1 i 2025
    expect(getWeekNumber(new Date(2024, 11, 31))).toBe(1);
  });

  it("returnerer uke 52 for 28. desember 2025 (søndag)", () => {
    // 28. desember 2025 er en søndag
    expect(getWeekNumber(new Date(2025, 11, 28))).toBe(52);
  });

  it("håndterer datoer i uke 53", () => {
    // 2020 har uke 53: 28. desember 2020 (mandag)
    expect(getWeekNumber(new Date(2020, 11, 28))).toBe(53);
  });
});

// ─── getIsoWeekInfo ─────────────────────────────────────────────────────────

describe("getIsoWeekInfo", () => {
  it("returnerer korrekt ukenummer og ukeår", () => {
    const info = getIsoWeekInfo(new Date(2024, 0, 1));
    expect(info.weekNumber).toBe(1);
    expect(info.weekYear).toBe(2024);
  });

  it("returnerer ukeår som kan være forskjellig fra kalenderår", () => {
    // 31. desember 2024 tilhører ISO-uke 1 i 2025
    const info = getIsoWeekInfo(new Date(2024, 11, 31));
    expect(info.weekNumber).toBe(1);
    expect(info.weekYear).toBe(2025);
  });

  it("returnerer korrekt for midtårs-dato", () => {
    const info = getIsoWeekInfo(new Date(2024, 5, 15));
    expect(info.weekNumber).toBe(24);
    expect(info.weekYear).toBe(2024);
  });
});

// ─── parseTimerStreng ───────────────────────────────────────────────────────

describe("parseTimerStreng", () => {
  it("parser '2 timer' til 2", () => {
    expect(parseTimerStreng("2 timer")).toBe(2);
  });

  it("parser '1.5h' til 1.5", () => {
    expect(parseTimerStreng("1.5h")).toBe(1.5);
  });

  it("parser '90 min' til 1.5", () => {
    expect(parseTimerStreng("90 min")).toBe(1.5);
  });

  it("parser '09:30' klokkeslett til 9.5", () => {
    expect(parseTimerStreng("09:30")).toBe(9.5);
  });

  it("parser '00:00' til 0", () => {
    expect(parseTimerStreng("00:00")).toBe(0);
  });

  it("parser '1t 30min' til 1.5", () => {
    expect(parseTimerStreng("1t 30min")).toBe(1.5);
  });

  it("parser '2 timer 15 minutter' til 2.25", () => {
    expect(parseTimerStreng("2 timer 15 minutter")).toBe(2.25);
  });

  it("returnerer 0 for tom streng", () => {
    expect(parseTimerStreng("")).toBe(0);
  });

  it("returnerer 0 for streng uten tall", () => {
    expect(parseTimerStreng("ingen tid")).toBe(0);
  });

  it("parser '3' (bare tall uten enhet) til 3", () => {
    expect(parseTimerStreng("3")).toBe(3);
  });

  it("parser komma-desimal '1,5 timer' til 1.5", () => {
    expect(parseTimerStreng("1,5 timer")).toBe(1.5);
  });

  it("parser 'hrs' som timesuffiks", () => {
    expect(parseTimerStreng("3 hrs")).toBe(3);
  });

  it("parser 'minutes'", () => {
    expect(parseTimerStreng("120 minutes")).toBe(2);
  });

  it("håndterer kun mellomrom", () => {
    expect(parseTimerStreng("   ")).toBe(0);
  });

  it("er case-insensitiv", () => {
    expect(parseTimerStreng("2 TIMER")).toBe(2);
  });
});

// ─── TWO_WEEKS_MS konstant ──────────────────────────────────────────────────

describe("TWO_WEEKS_MS", () => {
  it("er 14 dager i millisekunder", () => {
    expect(TWO_WEEKS_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});
