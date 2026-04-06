import { describe, expect, it } from "vitest";
import { mergeUIPreferences } from "@/app/lib/preferences";

describe("mergeUIPreferences", () => {
  it("beholder eksisterende felter nar oppdateringen kun inneholder et delfelt", () => {
    expect(
      mergeUIPreferences(
        {
          language: "nb",
          theme: "dark",
          cookieConsent: "accepted",
          hasSeenOnboarding: true,
        },
        {
          theme: "light",
        },
      ),
    ).toEqual({
      language: "nb",
      theme: "light",
      cookieConsent: "accepted",
      hasSeenOnboarding: true,
    });
  });

  it("returnerer eksisterende verdi nar det ikke kommer noen oppdatering", () => {
    expect(
      mergeUIPreferences(
        {
          cookieConsent: "declined",
        },
        undefined,
      ),
    ).toEqual({
      cookieConsent: "declined",
    });
  });
});
