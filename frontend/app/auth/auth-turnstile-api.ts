import {
  AuthTurnstileVerifyResponseSchema,
  type AuthTurnstileVerifyResponse,
} from "common/auth";
import { fetchApi } from "@/app/lib/apiClient";
import { createApiError, parseApiJson } from "@/app/lib/errorUtils";

export async function verifyAuthTurnstile(
  turnstileToken: string,
): Promise<AuthTurnstileVerifyResponse> {
  const res = await fetchApi(
    "/api/auth-turnstile/verify",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnstileToken }),
    },
    { auth: false },
  );
  const json = await parseApiJson(res);

  if (!res.ok) {
    throw createApiError(json, "Kunne ikke verifisere Cloudflare Turnstile");
  }

  return AuthTurnstileVerifyResponseSchema.parse(json);
}
