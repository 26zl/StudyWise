import { describe, expect, it } from "vitest";
import { shouldRetryTurnstileClientError } from "@/app/hooks/useTurnstileScript";

describe("shouldRetryTurnstileClientError", () => {
  it("retryer Cloudflare-koder som dokumentasjonen markerer som retrybare", () => {
    expect(shouldRetryTurnstileClientError("110600")).toBe(true);
    expect(shouldRetryTurnstileClientError("110620")).toBe(true);
    expect(shouldRetryTurnstileClientError("200500")).toBe(true);
    expect(shouldRetryTurnstileClientError("300010")).toBe(true);
    expect(shouldRetryTurnstileClientError("600010")).toBe(true);
  });

  it("retryer ikke konfigurasjonsfeil som krever dashboard-/sitekey-fiks", () => {
    expect(shouldRetryTurnstileClientError("110100")).toBe(false);
    expect(shouldRetryTurnstileClientError("110110")).toBe(false);
    expect(shouldRetryTurnstileClientError("110200")).toBe(false);
    expect(shouldRetryTurnstileClientError("400020")).toBe(false);
    expect(shouldRetryTurnstileClientError("400070")).toBe(false);
  });
});
