/*
 * Tester for AI-modellkonfigurasjon
 * Verifiserer at modeller er korrekt definert og resolveModel fungerer
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODEL,
  SUPPORTED_MODELS,
  resolveModel,
} from "../../../rutere/ki/aiModels.js";

describe("AI-modeller", () => {
  // --- DEFAULT_MODEL ---

  describe("DEFAULT_MODEL", () => {
    it("er en streng", () => {
      expect(typeof DEFAULT_MODEL).toBe("string");
    });

    it("er ikke tom", () => {
      expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
    });

    it("finnes i SUPPORTED_MODELS", () => {
      expect(SUPPORTED_MODELS).toHaveProperty(DEFAULT_MODEL);
    });
  });

  // --- SUPPORTED_MODELS ---

  describe("SUPPORTED_MODELS", () => {
    it("er ikke tomt", () => {
      expect(Object.keys(SUPPORTED_MODELS).length).toBeGreaterThan(0);
    });

    it("har name og description for hver modell", () => {
      for (const [id, info] of Object.entries(SUPPORTED_MODELS)) {
        expect(info.name, `${id} mangler name`).toBeTruthy();
        expect(typeof info.name, `${id} name er ikke streng`).toBe("string");
        expect(info.description, `${id} mangler description`).toBeTruthy();
        expect(typeof info.description, `${id} description er ikke streng`).toBe("string");
      }
    });

    it("har unike modell-IDer som nøkler", () => {
      const nøkler = Object.keys(SUPPORTED_MODELS);
      const unikeNøkler = new Set(nøkler);
      expect(unikeNøkler.size).toBe(nøkler.length);
    });
  });

  // --- resolveModel ---

  describe("resolveModel", () => {
    it("returnerer forespurt modell hvis den er støttet", () => {
      const støttetModell = Object.keys(SUPPORTED_MODELS)[0];
      expect(resolveModel(støttetModell)).toBe(støttetModell);
    });

    it("faller tilbake til DEFAULT_MODEL for ustøttet modell", () => {
      expect(resolveModel("finnes-ikke-modell")).toBe(DEFAULT_MODEL);
    });

    it("faller tilbake til DEFAULT_MODEL for null", () => {
      expect(resolveModel(null)).toBe(DEFAULT_MODEL);
    });

    it("faller tilbake til DEFAULT_MODEL for undefined", () => {
      expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    });

    it("faller tilbake til DEFAULT_MODEL for tom streng", () => {
      expect(resolveModel("")).toBe(DEFAULT_MODEL);
    });

    it("returnerer DEFAULT_MODEL når kalt uten argument", () => {
      expect(resolveModel()).toBe(DEFAULT_MODEL);
    });

    it("returnerer eksakt modell-ID (case-sensitiv)", () => {
      const modellId = Object.keys(SUPPORTED_MODELS)[0];
      // Store bokstaver bør ikke matche
      expect(resolveModel(modellId.toUpperCase())).toBe(DEFAULT_MODEL);
    });
  });
});
