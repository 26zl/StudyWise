import { describe, it, expect } from "vitest";
import { detectSecondFactorStrategy } from "@/app/auth/mfaStrategy";

describe("detectSecondFactorStrategy", () => {
  it("returnerer null for tom input", () => {
    expect(detectSecondFactorStrategy("")).toBeNull();
    expect(detectSecondFactorStrategy("   ")).toBeNull();
    expect(detectSecondFactorStrategy("---")).toBeNull();
  });

  it("klassifiserer 6-sifret kode som TOTP", () => {
    expect(detectSecondFactorStrategy("123456")).toEqual({
      strategy: "totp",
      code: "123456",
    });
  });

  it("trimmer mellomrom og dash før klassifisering", () => {
    expect(detectSecondFactorStrategy(" 123 456 ")).toEqual({
      strategy: "totp",
      code: "123456",
    });
    expect(detectSecondFactorStrategy("123-456")).toEqual({
      strategy: "totp",
      code: "123456",
    });
  });

  it("klassifiserer alfanumerisk kode som backup_code", () => {
    expect(detectSecondFactorStrategy("abcdefghij")).toEqual({
      strategy: "backup_code",
      code: "abcdefghij",
    });
  });

  it("klassifiserer Clerk-format backup-kode (med dash) som backup_code", () => {
    expect(detectSecondFactorStrategy("abcde-fghij")).toEqual({
      strategy: "backup_code",
      code: "abcdefghij",
    });
  });

  it("klassifiserer numerisk men ikke 6-sifret som backup_code", () => {
    // 7+ digits, eller mindre enn 6 — ikke gyldig TOTP, så backup_code
    expect(detectSecondFactorStrategy("1234567")).toEqual({
      strategy: "backup_code",
      code: "1234567",
    });
    expect(detectSecondFactorStrategy("12345")).toEqual({
      strategy: "backup_code",
      code: "12345",
    });
  });

  it("klassifiserer blandet alfanumerisk som backup_code", () => {
    expect(detectSecondFactorStrategy("abc123def4")).toEqual({
      strategy: "backup_code",
      code: "abc123def4",
    });
  });
});
