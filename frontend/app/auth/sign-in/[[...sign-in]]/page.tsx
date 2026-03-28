import { hasValidAuthTurnstileCookie } from "@/app/auth/auth-turnstile-server";
import { SignInClient } from "./SignInClient";

export default async function SignInPage() {
  const initialVerified = await hasValidAuthTurnstileCookie();
  return <SignInClient initialVerified={initialVerified} />;
}
