/*
 * Enhetstester for cross-course-guarden.
 *
 * Bakgrunn: KI-chat kunne tidligere svare en spørring om MET1020 med innhold
 * fra 6105N uten å varsle brukeren. Guarden skal oppdage at retrieval-kilder
 * kommer fra et annet kurs enn samtalens primær, og tvinge modellen til å
 * spørre i stedet for å skjule det.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateCrossCourseGuard,
  type CrossCourseSource,
} from "../../../rutere/ki/crossCourseGuard.js";

const met1020: CrossCourseSource = {
  courseId: "MET1020_ID",
  courseName: "MET1020 Metode",
};
const k6105n: CrossCourseSource = {
  courseId: "6105N_ID",
  courseName: "6105N Windows Server",
};
const algoritmer: CrossCourseSource = {
  courseId: "6124_ID",
  courseName: "6124 Algoritmer",
};

describe("evaluateCrossCourseGuard", () => {
  it("utløses ikke når primaryCourseId er null (ingen lås etablert)", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: null,
      primaryCourseHint: null,
      kilder: [met1020, k6105n],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(false);
    expect(res.promptBlock).toBeNull();
  });

  it("utløses ikke når kildelisten er tom", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: "MET1020",
      kilder: [],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(false);
  });

  it("utløses ikke når alle kilder tilhører primærkurset", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: "MET1020",
      kilder: [met1020, { ...met1020, courseName: "MET1020 Metode (forelesning 2)" }],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(false);
    expect(res.outOfScopeCount).toBe(0);
  });

  it("utløses når retrieval returnerer ren annen-kurs-innhold", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: "MET1020",
      kilder: [k6105n, k6105n],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(true);
    expect(res.outOfScopeCount).toBe(2);
    expect(res.inScopeCount).toBe(0);
    expect(res.foreignCourseIds).toEqual(["6105N_ID"]);
    expect(res.promptBlock).toBeTruthy();
    expect(res.promptBlock).toContain("Cross-Course Content Guard");
    expect(res.promptBlock).toContain("MET1020");
    expect(res.promptBlock).toContain("6105N");
    // Skal be modellen stoppe og spørre — ikke svare fra feil kurs
    expect(res.promptBlock).toContain("Jeg finner ikke innhold om dette");
    expect(res.promptBlock).toContain("MANDATORY");
  });

  it("utløses når retrieval blander primærkurs og fremmedkurs", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: "MET1020",
      kilder: [met1020, k6105n, met1020],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(true);
    expect(res.inScopeCount).toBe(2);
    expect(res.outOfScopeCount).toBe(1);
    expect(res.promptBlock).toContain("Some content from");
    expect(res.promptBlock).toContain("prefer that");
  });

  it("dedupliserer fremmedkurs i lista", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: "MET1020",
      kilder: [k6105n, algoritmer, k6105n, algoritmer],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(true);
    expect(res.foreignCourseIds.sort()).toEqual(["6105N_ID", "6124_ID"]);
    // Skal nevne begge fremmedkurs i prompt-blokken
    expect(res.promptBlock).toContain("6105N");
    expect(res.promptBlock).toContain("6124");
  });

  it("undertrykkes når brukeren eksplisitt refererer til annet kurs", () => {
    // Scenario: brukeren sier "i 6105N, kan du forklare modul 7?" — da er det
    // ok at retrieval henter fra 6105N selv om samtalens primær er MET1020.
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: "MET1020",
      kilder: [k6105n],
      userExplicitlyReferencedOtherCourse: true,
    });
    expect(res.triggered).toBe(false);
    expect(res.promptBlock).toBeNull();
  });

  it("håndterer kilder uten courseName grasjøst", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: "MET1020",
      kilder: [{ courseId: "unknownId", courseName: "" }],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(true);
    expect(res.promptBlock).toContain("(ukjent navn)");
  });

  it("ignorerer kilder uten courseId (kan ikke sammenligne mot primær)", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: "MET1020",
      kilder: [{ courseName: "ukjent kilde" }],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(false);
  });

  it("primær-label faller tilbake til kurs-id når hint mangler", () => {
    const res = evaluateCrossCourseGuard({
      primaryCourseId: "MET1020_ID",
      primaryCourseHint: null,
      kilder: [k6105n],
      userExplicitlyReferencedOtherCourse: false,
    });
    expect(res.triggered).toBe(true);
    expect(res.promptBlock).toContain("kurs-id MET1020_ID");
    expect(res.promptBlock).not.toContain("null");
  });
});
