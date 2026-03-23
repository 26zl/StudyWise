/*
 * Dedikert Clerk registreringsside.
 * Farger matcher resten av appen (slate, blue).
 *
 * StudyWise bruker kun e-postbasert innlogging i Clerk-oppsettet.
 */
"use client";

import { SignUp } from "@clerk/nextjs";
import { useLanguage } from "@/app/i18n";
import { clerkAppearance } from "@/app/auth/clerkAppearance";

export default function SignUpPage() {
  const { language } = useLanguage();

  return (
    <SignUp
      key={language}
      appearance={clerkAppearance}
      signInUrl="/auth/sign-in"
      forceRedirectUrl="/dashboard"
    />
  );
}
