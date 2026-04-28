import { describe, expect, it } from "vitest";
import {
  classifyClerkSignInError,
  classifyClerkSignUpError,
  parseClerkError,
} from "@/app/auth/authUI";

function clerkError(code: string, message = "Clerk error") {
  return {
    errors: [
      {
        code,
        message,
        longMessage: message,
      },
    ],
  };
}

describe("parseClerkError", () => {
  it("bruker oversatt kode når kalleren tilbyr en mapping", () => {
    const message = parseClerkError(
      clerkError("form_password_incorrect", "Password is incorrect."),
      "Fallback",
      (code) => (code === "form_password_incorrect" ? "Brukervennlig melding" : undefined),
    );

    expect(message).toBe("Brukervennlig melding");
  });
});

describe("classifyClerkSignInError", () => {
  it("klassifiserer feil passord eller ukjent identifikator som credentials", () => {
    expect(classifyClerkSignInError(clerkError("form_password_incorrect"))).toBe("credentials");
    expect(classifyClerkSignInError(clerkError("form_identifier_not_found"))).toBe("credentials");
  });

  it("klassifiserer konto med annen innloggingsmetode", () => {
    expect(classifyClerkSignInError(clerkError("strategy_for_user_invalid"))).toBe("method");
  });

  it("klassifiserer rate limiting", () => {
    expect(classifyClerkSignInError(clerkError("too_many_requests"))).toBe("rateLimited");
  });

  it("klassifiserer melding-only passordfeil fra Clerk", () => {
    expect(
      classifyClerkSignInError(
        clerkError("unknown", "Password is incorrect. Try again, or use another method."),
      ),
    ).toBe("credentials");
  });

  it("returnerer null for ukjente feil", () => {
    expect(classifyClerkSignInError(new Error("Noe annet"))).toBeNull();
  });
});

describe("classifyClerkSignUpError", () => {
  it("klassifiserer vanlige registreringsfeil", () => {
    expect(classifyClerkSignUpError(clerkError("form_identifier_exists"))).toBe("emailTaken");
    expect(classifyClerkSignUpError(clerkError("form_email_address_invalid"))).toBe("invalidEmail");
    expect(classifyClerkSignUpError(clerkError("form_username_exists"))).toBe("usernameTaken");
    expect(classifyClerkSignUpError(clerkError("form_username_invalid"))).toBe("usernameInvalid");
    expect(classifyClerkSignUpError(clerkError("too_many_requests"))).toBe("rateLimited");
  });

  it("klassifiserer passordfeil fra Clerk", () => {
    expect(classifyClerkSignUpError(clerkError("form_password_pwned"))).toBe("passwordPwned");
    expect(classifyClerkSignUpError(clerkError("form_password_not_strong_enough"))).toBe(
      "passwordWeak",
    );
    expect(classifyClerkSignUpError(clerkError("form_password_length_too_short"))).toBe(
      "passwordTooShort",
    );
  });
});
