import { hasValidAuthTurnstileCookie } from "@/app/auth/auth-turnstile-server";
import { ForgotPasswordClient } from "./ForgotPasswordClient";

// Server-wrapper som forhåndssjekker Turnstile før client-flowet rendres.
export default async function ForgotPasswordPage() {
  const initialVerified = await hasValidAuthTurnstileCookie();
  return <ForgotPasswordClient initialVerified={initialVerified} />;
}
