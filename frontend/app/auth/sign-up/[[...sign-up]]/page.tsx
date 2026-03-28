import { hasValidAuthTurnstileCookie } from "@/app/auth/auth-turnstile-server";
import { SignUpClient } from "./SignUpClient";

export default async function SignUpPage() {
  const initialVerified = await hasValidAuthTurnstileCookie();
  return <SignUpClient initialVerified={initialVerified} />;
}
