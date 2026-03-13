/*
 * Dedikert Clerk registreringsside.
 * Farger matcher resten av appen (slate, blue).
 *
 * For kun e-post (uten telefon): Clerk Dashboard → User & authentication
 * → Email, Phone, Username → slå av "Phone number" for sign-up.
 */
"use client";

import { SignUp } from "@clerk/nextjs";

const clerkAppearance = {
  variables: {
    colorPrimary: "#2563eb",
    colorBackground: "var(--clerk-color-background)",
    colorForeground: "var(--clerk-color-foreground)",
    colorMutedForeground: "var(--clerk-color-muted-foreground)",
    colorInput: "var(--clerk-color-input)",
    colorInputForeground: "var(--clerk-color-input-foreground)",
    colorBorder: "var(--clerk-color-border)",
    colorMuted: "var(--clerk-color-muted)",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full max-w-md mx-auto",
    card: "bg-white dark:bg-slate-800/95 border border-slate-200 dark:border-slate-700 shadow-lg",
  },
};

export default function SignUpPage() {
  return (
    <SignUp
      appearance={clerkAppearance}
      signInUrl="/auth/sign-in"
      forceRedirectUrl="/dashboard"
    />
  );
}
