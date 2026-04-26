// Tester for Turnstile-feilkode-mapping (turnstileErrorHelp.ts)
// Dekker eksakte koder, prefiks-familier, og fallback til null for ukjente koder.

import { describe, it, expect } from "vitest";
import { getTurnstileErrorHelp } from "@/app/auth/turnstileErrorHelp";

describe("getTurnstileErrorHelp", () => {
  describe("ingen kode", () => {
    it("returnerer null for null", () => {
      expect(getTurnstileErrorHelp(null)).toBeNull();
    });

    it("returnerer null for tom streng", () => {
      expect(getTurnstileErrorHelp("")).toBeNull();
    });
  });

  describe("eksakte koder", () => {
    it("mapper 600010 til widget-eksekveringshjelp", () => {
      const help = getTurnstileErrorHelp("600010");
      expect(help).toEqual({
        causeKey: "auth.humanCheck.errorHelp.600010.cause",
        solutionKey: "auth.humanCheck.errorHelp.600010.solution",
      });
    });

    it("mapper 300010 til samme widget-eksekveringshjelp som 600010", () => {
      const help = getTurnstileErrorHelp("300010");
      expect(help).toEqual({
        causeKey: "auth.humanCheck.errorHelp.600010.cause",
        solutionKey: "auth.humanCheck.errorHelp.600010.solution",
      });
    });

    it("mapper 110200 til domene-feilkonfigurasjon", () => {
      const help = getTurnstileErrorHelp("110200");
      expect(help).toEqual({
        causeKey: "auth.humanCheck.errorHelp.110200.cause",
        solutionKey: "auth.humanCheck.errorHelp.110200.solution",
      });
    });
  });

  describe("prefiks-familier", () => {
    it("mapper 200xxx til nettverk", () => {
      expect(getTurnstileErrorHelp("200001")).toEqual({
        causeKey: "auth.humanCheck.errorHelp.network.cause",
        solutionKey: "auth.humanCheck.errorHelp.network.solution",
      });
      expect(getTurnstileErrorHelp("200999")).toEqual({
        causeKey: "auth.humanCheck.errorHelp.network.cause",
        solutionKey: "auth.humanCheck.errorHelp.network.solution",
      });
    });

    it("mapper 300xxx (utenom eksakt 300010) til generisk klient-feil", () => {
      expect(getTurnstileErrorHelp("300020")).toEqual({
        causeKey: "auth.humanCheck.errorHelp.client.cause",
        solutionKey: "auth.humanCheck.errorHelp.client.solution",
      });
    });

    it("mapper 600xxx (utenom eksakt 600010) til generisk klient-feil", () => {
      expect(getTurnstileErrorHelp("600020")).toEqual({
        causeKey: "auth.humanCheck.errorHelp.client.cause",
        solutionKey: "auth.humanCheck.errorHelp.client.solution",
      });
    });

    it("mapper 400xxx til utløpt token", () => {
      expect(getTurnstileErrorHelp("400010")).toEqual({
        causeKey: "auth.humanCheck.errorHelp.expired.cause",
        solutionKey: "auth.humanCheck.errorHelp.expired.solution",
      });
    });
  });

  describe("eksakte koder vinner over prefiks", () => {
    // Verifiserer at switch-statementen returnerer FØR prefiks-sjekk.
    // Hvis noen senere flytter switch-en under prefiks, vil 600010 mappes
    // til generisk client-hjelp i stedet for spesifikk 600010-hjelp.
    it("600010 returnerer 600010-hjelp, ikke generisk client", () => {
      const help = getTurnstileErrorHelp("600010");
      expect(help?.causeKey).toBe("auth.humanCheck.errorHelp.600010.cause");
      expect(help?.causeKey).not.toBe("auth.humanCheck.errorHelp.client.cause");
    });
  });

  describe("ukjente koder", () => {
    it("returnerer null for kode utenfor kjente familier", () => {
      expect(getTurnstileErrorHelp("999999")).toBeNull();
      expect(getTurnstileErrorHelp("100000")).toBeNull();
      expect(getTurnstileErrorHelp("500000")).toBeNull();
    });

    it("returnerer null for kode med ikke-numerisk innhold", () => {
      expect(getTurnstileErrorHelp("foobar")).toBeNull();
    });
  });
});
