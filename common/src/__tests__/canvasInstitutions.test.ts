/**
 * Tester for canvasInstitutions-modulen – norske Canvas-institusjoner.
 */

import { describe, it, expect } from "vitest";
import { CANVAS_INSTITUSJONER_NORGE } from "../canvasInstitutions.js";

describe("CANVAS_INSTITUSJONER_NORGE", () => {
  it("er en ikke-tom array", () => {
    expect(Array.isArray(CANVAS_INSTITUSJONER_NORGE)).toBe(true);
    expect(CANVAS_INSTITUSJONER_NORGE.length).toBeGreaterThan(0);
  });

  it("alle elementer har navn og url", () => {
    for (const inst of CANVAS_INSTITUSJONER_NORGE) {
      expect(typeof inst.navn).toBe("string");
      expect(inst.navn.length).toBeGreaterThan(0);
      expect(typeof inst.url).toBe("string");
      expect(inst.url.length).toBeGreaterThan(0);
    }
  });

  it("alle URLer bruker HTTPS", () => {
    for (const inst of CANVAS_INSTITUSJONER_NORGE) {
      expect(inst.url).toMatch(/^https:\/\//);
    }
  });

  it("ingen dupliserte URLer", () => {
    const urler = CANVAS_INSTITUSJONER_NORGE.map((inst) => inst.url.toLowerCase());
    const unikeUrler = new Set(urler);
    expect(unikeUrler.size).toBe(urler.length);
  });

  it("ingen dupliserte navn", () => {
    const navn = CANVAS_INSTITUSJONER_NORGE.map((inst) => inst.navn);
    const unikeNavn = new Set(navn);
    expect(unikeNavn.size).toBe(navn.length);
  });

  it("inneholder kjente norske institusjoner", () => {
    const navn = CANVAS_INSTITUSJONER_NORGE.map((inst) => inst.navn);
    expect(navn).toContain("NTNU");
    expect(navn).toContain("Universitetet i Bergen");
    expect(navn).toContain("OsloMet");
  });

  it("alle URLer er gyldige URL-format", () => {
    for (const inst of CANVAS_INSTITUSJONER_NORGE) {
      // Verifiser at URL kan parses uten feil
      expect(() => new URL(inst.url)).not.toThrow();
    }
  });
});
