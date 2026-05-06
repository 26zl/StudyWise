import { hasValidAuthTurnstileCookie } from "@/app/auth/auth-turnstile-server";
import { SignUpClient } from "./SignUpClient";

// Server-wrapper som forhåndssjekker Turnstile før client-flowet rendres.
export default async function SignUpPage() {
  const initialVerified = await hasValidAuthTurnstileCookie();
  return <SignUpClient initialVerified={initialVerified} />;
}
