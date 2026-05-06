import { hasValidAuthTurnstileCookie } from "@/app/auth/auth-turnstile-server";
import { SignInClient } from "./SignInClient";

// Server-wrapper som forhåndssjekker Turnstile før client-flowet rendres.
export default async function SignInPage() {
  const initialVerified = await hasValidAuthTurnstileCookie();
  return <SignInClient initialVerified={initialVerified} />;
}
