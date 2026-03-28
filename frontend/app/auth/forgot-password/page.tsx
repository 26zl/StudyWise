import { hasValidAuthTurnstileCookie } from "@/app/auth/auth-turnstile-server";
import { ForgotPasswordClient } from "./ForgotPasswordClient";

export default async function ForgotPasswordPage() {
  const initialVerified = await hasValidAuthTurnstileCookie();
  return <ForgotPasswordClient initialVerified={initialVerified} />;
}
