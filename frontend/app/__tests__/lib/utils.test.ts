// Tester for hjelpefunksjoner (cn og simpleHash)

import { describe, it, expect } from "vitest";
import { cn, simpleHash } from "@/app/lib/utils";

describe("cn", () => {
  it("slår sammen enkle klassenavn", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("håndterer betingede klassenavn", () => {
    const isActive = true;
    const isHidden = false;
    expect(cn("base", isActive && "active", isHidden && "hidden")).toBe("base active");
  });

  it("filtrerer bort falsy-verdier", () => {
    expect(cn("foo", null, undefined, false, 0, "", "bar")).toBe("foo bar");
  });

  it("håndterer objekt-syntaks", () => {
    expect(cn({ active: true, hidden: false, visible: true })).toBe("active visible");
  });

  it("håndterer array-syntaks", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("håndterer blanding av strenger, objekter og arrays", () => {
    expect(cn("base", ["extra"], { active: true })).toBe("base extra active");
  });

  it("returnerer tom streng uten argumenter", () => {
    expect(cn()).toBe("");
  });

  it("returnerer tom streng med bare falsy-verdier", () => {
    expect(cn(null, undefined, false)).toBe("");
  });

  it("håndterer duplikate klasser", () => {
    const resultat = cn("p-4", "p-2");
    expect(resultat).toContain("p-4");
    expect(resultat).toContain("p-2");
  });
});

describe("simpleHash", () => {
  it("returnerer konsistent hash for samme input", () => {
    const hash1 = simpleHash("test");
    const hash2 = simpleHash("test");
    expect(hash1).toBe(hash2);
  });

  it("returnerer ulik hash for ulik input", () => {
    const hash1 = simpleHash("hei");
    const hash2 = simpleHash("hade");
    expect(hash1).not.toBe(hash2);
  });

  it("håndterer tom streng", () => {
    const hash = simpleHash("");
    expect(hash).toBe("0");
  });

  it("returnerer en streng", () => {
    expect(typeof simpleHash("noe")).toBe("string");
  });

  it("returnerer base-36-representasjon", () => {
    const hash = simpleHash("teststreng");
    expect(hash).toMatch(/^-?[0-9a-z]+$/);
  });

  it("gir ulik hash for lignende strenger", () => {
    expect(simpleHash("abc")).not.toBe(simpleHash("abd"));
    expect(simpleHash("abc")).not.toBe(simpleHash("ab"));
  });

  it("håndterer lange strenger", () => {
    const lang = "a".repeat(10000);
    const hash = simpleHash(lang);
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("håndterer spesialtegn", () => {
    const hash = simpleHash("æøå 🎉 <script>");
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });
});
