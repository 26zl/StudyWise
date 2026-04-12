import { describe, expect, it } from "vitest";
import { isPublicApiPath } from "../../utils/publicApiPaths.js";

describe("isPublicApiPath", () => {
  it("tillater offentlig GET-rute for delte chatter", () => {
    expect(isPublicApiPath("/api/ki/share/abc123", "GET")).toBe(true);
  });

  it("tillater offentlig POST-rute for brukernavnssjekk", () => {
    expect(isPublicApiPath("/api/user/username/check", "POST")).toBe(true);
  });

  it("tillater ikke GET for brukernavnssjekk", () => {
    expect(isPublicApiPath("/api/user/username/check", "GET")).toBe(false);
  });

  it("gjenkjenner offentlig GET-rute når metode mangler", () => {
    expect(isPublicApiPath("/api/ki/share/abc123")).toBe(true);
  });

  it("gjenkjenner offentlig POST-rute når metode mangler", () => {
    expect(isPublicApiPath("/api/user/username/check")).toBe(true);
  });

  it("blokkerer beskyttede bruker-ruter", () => {
    expect(isPublicApiPath("/api/user/me", "GET")).toBe(false);
  });

  it("blokkerer beskyttet rute når metode mangler", () => {
    expect(isPublicApiPath("/api/user/me")).toBe(false);
  });
});
